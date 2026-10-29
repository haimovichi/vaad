-- Migrate a database from the earlier roles (owner / admin / tenant) to the five-role model.
-- Run this FIRST, then run supabase/schema.sql (it installs the new functions and policies and replaces the old ones).
-- Everything happens in one transaction: if anything fails, nothing changes.
--
--   owner  -> committee   (full rights in that building, as before)
--            an owner row that had an apartment number also becomes an apartment-owner row for that apartment
--   tenant -> tenant      (unchanged)
--   admin  -> NOT converted: the view-only role no longer exists, and turning it into committee would silently give
--            write access. The migration stops if any admin rows exist; remove or re-add those people first.
--
-- The super user is NOT set here (keeps your email out of the repository). After running schema.sql, run once:
--   insert into public.super_users (email) values ('you@example.com');

begin;

do $$
begin
  if exists (select 1 from public.members where role = 'admin') then
    raise exception 'members with role admin exist: remove them (or add them as committee on purpose) before migrating';
  end if;
end $$;

-- the platform-level tables are created by schema.sql; only the members table has to change shape first
alter table public.members drop constraint if exists members_role_check;
alter table public.members drop constraint if exists members_pkey;
alter table public.members add column if not exists id bigint generated always as identity;

-- owner with an apartment: keep that apartment as an apartment-owner row
insert into public.members (building_id, email, role, apt, name)
  select building_id, email, 'apt_owner', apt, name from public.members where role = 'owner' and apt is not null;
update public.members set apt = null where role = 'owner';
update public.members set role = 'committee' where role = 'owner';

alter table public.members add primary key (id);
alter table public.members add constraint members_role_check check (role in ('committee','tenant','apt_owner'));
alter table public.members add constraint members_apt_owner_apt check (role <> 'apt_owner' or apt is not null);
alter table public.members add constraint members_committee_no_apt check (role <> 'committee' or apt is null);
create unique index if not exists members_unique on public.members (building_id, email, role, coalesce(apt, 0));

commit;
