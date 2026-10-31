-- Moves people into the main users table. Run once on a database that has the five-role model but still keeps
-- names, phones and accounts on residents / owners and emails on members. Then run schema.sql.
-- Safe to re-run: it does nothing once members.email is gone.
--
-- Before running on real data, copy the tables you are about to change, e.g.
--   create schema bak; create table bak.residents as table public.residents; (same for owners, members)
--
-- What happens:
--   * a users row for every email in members, managers and super_users (name split on the first space)
--   * one users row per tenant (first/last name, phone1, account) and, when there is a second person or a second
--     phone, a second users row (first2/last2, phone2) — residents.user_id / user2_id point at them
--   * one users row per owner; owners.user_id points at it
--   * members.email / name are replaced by members.user_id; the old personal columns are dropped

create table if not exists public.users (
  id bigint generated always as identity primary key,
  email text unique check (email is null or email = lower(email)),
  first_name text, last_name text,
  phone text,
  bank_account text,
  created_at timestamptz not null default now()
);
-- personal data: locked from the first second (schema.sql adds the policies)
alter table public.users enable row level security;
revoke all on public.users from anon;

do $$
declare r record; uid bigint; uid2 bigint;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'email') then
    return;
  end if;

  -- the old policies reference members.email; schema.sql (run right after this) recreates every policy
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  -- people with a login
  insert into public.users (email, first_name, last_name)
  select e.email, nullif(split_part(trim(e.name), ' ', 1), ''), nullif(trim(substr(trim(e.name), length(split_part(trim(e.name), ' ', 1)) + 1)), '')
  from (select email, max(name) as name from public.members group by email) e
  on conflict (email) do nothing;
  if to_regclass('public.managers') is not null then
    insert into public.users (email) select email from public.managers on conflict (email) do nothing;
  end if;
  if to_regclass('public.super_users') is not null then
    insert into public.users (email) select email from public.super_users on conflict (email) do nothing;
  end if;

  alter table public.members add column if not exists user_id bigint references public.users(id) on delete cascade;
  update public.members m set user_id = u.id from public.users u where u.email = m.email;
  alter table public.members alter column user_id set not null;
  drop index if exists public.members_unique;
  drop index if exists public.members_email_idx;
  alter table public.members drop column email;
  alter table public.members drop column name;
  create unique index if not exists members_unique on public.members (building_id, user_id, role, coalesce(apt, 0));
  create index if not exists members_user_idx on public.members(user_id);

  -- tenants
  alter table public.residents add column if not exists user_id bigint references public.users(id);
  alter table public.residents add column if not exists user2_id bigint references public.users(id);
  for r in select * from public.residents order by id loop
    uid := null; uid2 := null;
    if coalesce(r.first_name, '') <> '' or coalesce(r.last_name, '') <> '' or coalesce(r.phone1, '') <> '' or coalesce(r.account, '') <> '' then
      insert into public.users (first_name, last_name, phone, bank_account)
      values (nullif(r.first_name, ''), nullif(r.last_name, ''), nullif(r.phone1, ''), nullif(r.account, '')) returning id into uid;
    end if;
    if coalesce(r.first2, '') <> '' or coalesce(r.last2, '') <> '' or coalesce(r.phone2, '') <> '' then
      insert into public.users (first_name, last_name, phone)
      values (nullif(r.first2, ''), nullif(r.last2, ''), nullif(r.phone2, '')) returning id into uid2;
    end if;
    update public.residents set user_id = uid, user2_id = uid2 where id = r.id;
  end loop;
  alter table public.residents drop column first_name, drop column last_name, drop column first2, drop column last2,
    drop column phone1, drop column phone2, drop column account;

  -- owners
  alter table public.owners add column if not exists user_id bigint references public.users(id);
  for r in select * from public.owners order by id loop
    uid := null;
    if coalesce(r.first_name, '') <> '' or coalesce(r.last_name, '') <> '' or coalesce(r.phone, '') <> '' or coalesce(r.account, '') <> '' then
      insert into public.users (first_name, last_name, phone, bank_account)
      values (nullif(r.first_name, ''), nullif(r.last_name, ''), nullif(r.phone, ''), nullif(r.account, '')) returning id into uid;
    end if;
    update public.owners set user_id = uid where id = r.id;
  end loop;
  alter table public.owners drop column first_name, drop column last_name, drop column phone, drop column account;
end $$;
