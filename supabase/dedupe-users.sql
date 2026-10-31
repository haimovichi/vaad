-- Merges duplicate people in the users table so that every person is ONE user record, however many apartments
-- they own, rent or hold roles in. Run once after migrate-users.sql (which creates one user per tenancy and per
-- owner record, so a person who owns two apartments, or owns one and rents another, appears several times).
-- Safe to re-run. Copy users, residents, owners and members to a backup schema first. Works whether bank accounts
-- are still the users.bank_account column (run it before migrate-bank-accounts.sql) or already the bank_accounts table.
--
-- Two records are the same person when
--   * they have the same full name and the same phone (or one of them has no phone), and no two different emails; or
--   * one has no name and its phone is the phone of exactly one named person; or
--   * both have no name and the same phone.
-- Same name with two different phones (could be two people, or one person with two phones) is left alone.
-- Everything points at the surviving record: tenancies, owner records, roles and bank accounts (one person may pay
-- from several accounts, so all of them are kept). Phone and email are kept when only one record had them.

create or replace function pg_temp.merge_user(keep bigint, gone bigint) returns void
language plpgsql as $$
declare d public.users%rowtype;
begin
  select * into d from public.users where id = gone;
  if not found or keep = gone then return; end if;
  update public.residents set user_id = keep where user_id = gone;
  update public.residents set user2_id = keep where user2_id = gone;
  update public.residents set user2_id = null where user2_id = user_id;      -- a couple that turned out to be one person
  update public.owners set user_id = keep where user_id = gone;
  delete from public.members m where m.user_id = gone and exists (
    select 1 from public.members k where k.user_id = keep and k.building_id = m.building_id and k.role = m.role and coalesce(k.apt, 0) = coalesce(m.apt, 0));
  update public.members set user_id = keep where user_id = gone;
  if to_regclass('public.bank_accounts') is not null then
    delete from public.bank_accounts b where b.user_id = gone and exists (select 1 from public.bank_accounts k where k.user_id = keep and k.account = b.account);
    update public.bank_accounts set user_id = keep where user_id = gone;
  end if;
  delete from public.users where id = gone;
  update public.users k set email = coalesce(k.email, d.email), phone = coalesce(k.phone, d.phone) where k.id = keep;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'bank_account') then
    execute $q$ update public.users k set bank_account = (select nullif(string_agg(a, ', ' order by ord), '') from (
        select distinct on (a) a, ord from unnest(string_to_array(regexp_replace(coalesce(k.bank_account, '') || ',' || coalesce($2, ''), '[\s;]+', '', 'g'), ',')) with ordinality as t(a, ord)
        where a <> '' order by a, ord) z) where k.id = $1 $q$ using keep, to_jsonb(d) ->> 'bank_account';
  end if;
end $$;

do $$
declare nm record; u record; heads bigint[]; h bigint; cnt int;
begin
  -- 1) named people: same name, compatible phone and email
  for nm in
    select s.name from (select trim(regexp_replace(coalesce(first_name, '') || ' ' || coalesce(last_name, ''), '\s+', ' ', 'g')) as name from public.users) s
    where s.name <> '' group by s.name having count(*) > 1
  loop
    heads := '{}';
    for u in select * from public.users
             where trim(regexp_replace(coalesce(first_name, '') || ' ' || coalesce(last_name, ''), '\s+', ' ', 'g')) = nm.name order by id loop
      select k.id into h from public.users k
       where k.id = any(heads) and (k.phone is null or u.phone is null or k.phone = u.phone) and (k.email is null or u.email is null or k.email = u.email)
       order by k.id limit 1;
      if h is null then heads := heads || u.id; else perform pg_temp.merge_user(h, u.id); end if;
    end loop;
  end loop;

  -- 2) a record with only a phone belongs to the one named person who has that phone
  for u in select * from public.users where coalesce(first_name, '') = '' and coalesce(last_name, '') = '' and phone is not null and email is null order by id loop
    select count(*), min(k.id) into cnt, h from public.users k
     where k.phone = u.phone and k.id <> u.id and (coalesce(k.first_name, '') <> '' or coalesce(k.last_name, '') <> '');
    if cnt = 1 then perform pg_temp.merge_user(h, u.id); end if;
  end loop;

  -- 3) phone-only records with the same phone are one contact
  for u in select * from public.users where coalesce(first_name, '') = '' and coalesce(last_name, '') = '' and phone is not null and email is null order by id loop
    select min(k.id) into h from public.users k
     where k.phone = u.phone and k.id < u.id and coalesce(k.first_name, '') = '' and coalesce(k.last_name, '') = '' and k.email is null;
    if h is not null then perform pg_temp.merge_user(h, u.id); end if;
  end loop;
end $$;
