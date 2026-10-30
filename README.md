# ועד הבית — building committee payments

A static web app (GitHub Pages) + a Supabase database with five roles.

| Role | Who | Can |
|---|---|---|
| **Super user** | exactly one person (the platform owner) | everything, in every building. Set only in the SQL editor; nobody can grant it from the app |
| **Buildings manager** | someone who looks after several buildings | manages the buildings assigned to them; can create new buildings (and becomes their manager); gives out committee, tenant and apartment-owner roles there |
| **Building committee** | the committee of one building | manages that building: bank import, payments, tenants, backup, what tenants see; gives out tenant and apartment-owner roles there |
| **Tenant** | each household | the whole building board (statuses), and payment details with dates for their own apartment |
| **Apartment owner** | a landlord | only their apartments: status, the current tenant's payments with dates, and the tenant's name and phones |

One email can hold any mix of roles, in one or several buildings; the roles combine. Roles are enforced by the database (`supabase/schema.sql`, over 400 checks in `npm run test:rls`), not just hidden in the UI. Only the people above the role in the list can give it out, and only inside their own buildings.

Everyone logs in with an emailed link (no passwords). Only emails that have a role get access.

## One-time setup

**1. Supabase (free)** — https://supabase.com → New project.
1. SQL Editor → paste `supabase/schema.sql` → Run. (Re-runnable. If you are upgrading a database from the earlier owner/admin/tenant version, run `supabase/migrate-roles.sql` first, then `schema.sql`.)
2. Make yourself the super user (once, in the SQL editor; your email is deliberately not in the repository):
   ```sql
   insert into public.super_users (email) values ('you@example.com');
   ```
3. Load your data: `npm run seed:sql -- committee-member@email.com` (this email becomes a committee member of building 1), then paste `supabase/seed.sql` → Run.
   (Data comes from `data/db.json`, built from your Excel by `npm run seed:excel`. `seed.sql` has personal data and is git-ignored.)
4. Authentication → Providers: Email on, **Confirm email on**.
5. Authentication → URL Configuration: Site URL = your GitHub Pages address, and add the same address under Redirect URLs.
6. Authentication → SMTP: **set up custom SMTP** (e.g. Gmail with an app password, or Resend). Supabase's built-in email allows only a few messages per hour.
7. Project settings → API: copy *Project URL* and the *anon public* key into `app/config.js`.

**2. GitHub Pages** — push this folder to a public repo (code only; `data/`, `seed.sql`, `*.xlsx`, backups are ignored). Settings → Pages → Source: **GitHub Actions**. `.github/workflows/pages.yml` publishes `app/` on every push to `main`.

**3. Invite people** — in **אנשים → משתמשים** add each email with a role and, for tenants and apartment owners, the apartment number. The super user appoints buildings managers in **בניינים → מנהלי בניינים**. **אנשים → כל האנשים** (super user and managers) lists every person with their roles in all buildings.

## Who can give out which role
| | committee | tenant | apartment owner | buildings manager |
|---|---|---|---|---|
| Super user | any building | any building | any building | yes |
| Buildings manager | their buildings | their buildings | their buildings | no |
| Building committee | no | own building | own building | no |

## Adding buildings
The super user and buildings managers can create a building in **בניינים**. A new building is empty: entering its apartments and tenants in the app is not built yet, so for now load it from a workbook:
```
npm run seed:excel                                   # after pointing data/source.xlsx at the other workbook
npm run seed:sql -- committee@email.com 2 "Building name"
```

## One page, one menu
Everyone uses the same page (`app.html`). A menu (bottom bar on a phone, panel on the right on a computer) shows only what the person's roles allow: **בית** (all roles), **ייבוא**, **אנשים**, **עוד** (whoever manages a building), **בניינים** (super user and managers). Tenants and apartment owners see just the home screen.

**Home** has the buttons **הדירה שלי / הדירות שלי** (each apartment linked to you, with your payments with dates for the selected year; apartment owners also see the current tenant's name and phones), **חייבים** and **הכל**. Tenants and managers see the whole board; an apartment owner who is not also a tenant sees only their own apartments.

**Drill-down (committee, managers, super user):** tap any apartment card to see that tenant's balance (debt or credit), the exact paid and due amount for every month, their payments with dates, and buttons to **add a cash/cheque/transfer payment** or **delete** one. This replaces the old month-by-month table screen. Which apartment is "mine" comes only from the links set in **אנשים → משתמשים**.
Payments recorded in the old Excel have no payment date, only the month they were for; payments imported from the bank or added in the app from now on carry the date.

Old addresses (`admin.html#users`, `tenant.html`) still work: they redirect to the matching place in the new page.

## Monthly routine
Log in → **ייבוא** → choose the bank `.xlsx` → review yellow rows → save. Tenants see the update immediately.

## Backup and restore
The free Supabase plan has no downloadable backups, so whoever manages a building has **עוד → גיבוי**: one click downloads a JSON file with every table of that building. Do it monthly after the bank update. The file contains phones and account numbers; keep it private (these file names are git-ignored).

To restore, turn the file into SQL and paste it into the Supabase SQL editor:
```
npm run restore -- vaad-backup-b1-2026-10-29.json            # into a database that lacks this building (refuses if rows exist)
npm run restore -- vaad-backup-b1-2026-10-29.json --replace   # replace this building's current data (other buildings untouched)
```
The SQL is written to `supabase/restore.sql` (git-ignored). Backups taken before the five-role model cannot be restored as they are. `npm run test:backup` proves a backup restores every row exactly.

## Try it locally without Supabase
```
npm run dev     # http://localhost:3000/index.html?demo=committee
```
Other demos: `demo=super`, `manager`, `tenant`, `apt_owner`, `multi` (committee + tenant + apartment owner). Demo mode keeps changes in memory only.

## Tests
`npm test` runs the role tests, the migration test and the backup test (in-process Postgres, no Supabase needed). `npm run test:seed` checks the generated seed.

## Notes
- Free Supabase projects pause after a week of no activity; resume from the dashboard if that happens.
- `docs/` has the brief, PRD, architecture notes and the stories list.
