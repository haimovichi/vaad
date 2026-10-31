-- Moves bank accounts out of the users table into their own table, linked to the user. Run once on a database that
-- still has users.bank_account (one text field, several accounts separated by commas), then run schema.sql.
-- Safe to re-run: it does nothing once users.bank_account is gone.
-- Before running on real data, copy the table: create table bak.users_x as table public.users;

create table if not exists public.bank_accounts (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  account text not null check (length(trim(account)) > 0),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, account)
);
-- personal data: locked from the first second (schema.sql adds the policies)
alter table public.bank_accounts enable row level security;
revoke all on public.bank_accounts from anon;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'bank_account') then
    insert into public.bank_accounts (user_id, account)
    select u.id, trim(t.a) from public.users u, unnest(regexp_split_to_array(u.bank_account, '[,;]+')) with ordinality as t(a, ord)
    where u.bank_account is not null and trim(t.a) <> ''
    order by u.id, t.ord
    on conflict (user_id, account) do nothing;
    alter table public.users drop column bank_account;
  end if;
end $$;
