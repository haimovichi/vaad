# ועד הבית — building committee payments

A static web app (GitHub Pages) + a Supabase database with three roles:

| Role | Who | Can |
|---|---|---|
| owner | you | everything: import bank files, edit, manage users, control what tenants see |
| admin | the other building administrator | read-only, sees all data including phones |
| tenant | each household | read-only payment status (apartment, month status; no phones, accounts or bank rows) |

Roles are enforced by the database (`supabase/schema.sql`, 136 checks in `npm run test:rls`), not just hidden in the UI.

**Multi-building:** every row belongs to a building, and roles are per building. One email can be owner of one building and a tenant of another; the app asks which to open. A building's people can never read or write another building's data.

Everyone logs in with an emailed link (no passwords). Only emails listed in the app's "משתמשים" tab get access.

## One-time setup

**1. Supabase (free)** — https://supabase.com → New project.
1. SQL Editor → paste `supabase/schema.sql` → Run.
2. Load your data: `npm run seed:sql -- your@email.com` (the email you will log in with; it becomes the owner of building 1), then paste `supabase/seed.sql` → Run.
   (Data comes from `data/db.json`, built from your Excel by `npm run seed:excel`. `seed.sql` has personal data and is git-ignored.)
3. Authentication → Providers: Email on, **Confirm email on**.
4. Authentication → URL Configuration: Site URL = your GitHub Pages address (step 2), and add the same address under Redirect URLs.
5. Authentication → SMTP: **set up custom SMTP** (e.g. Resend or Gmail). Supabase's built-in email allows only a few messages per hour, which is not enough for 26 households logging in.
6. Project settings → API: copy *Project URL* and the *anon public* key into `app/config.js`.

**2. GitHub Pages**
1. Create a GitHub repo and push this folder (the repo holds code only; `data/`, `seed.sql`, `*.xlsx` are ignored). Use a public repo — Pages on private repos needs a paid plan. The anon key is public by design.
2. Settings → Pages → Source: **GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes `app/` on every push to `main`.

**3. Invite people** — log in as owner, open "משתמשים", add each tenant's email with their apartment number, and the other administrator as "מנהל (צפייה)".

## Adding another building
The platform operator (you) creates buildings in the Supabase SQL editor. Either load an Excel-based workbook as building 2:
```
npm run seed:excel                                   # after pointing data/source.xlsx at the other workbook
npm run seed:sql -- other-owner@email.com 2 "Building name"
```
or create it empty and assign its owner:
```sql
insert into buildings (name) values ('Building name') returning id;
insert into members (building_id, email, role) values (<id>, 'owner@email.com', 'owner');
```
That owner then manages their own tenants and administrators in "משתמשים". An in-app screen for entering apartments and tenants of an empty building is not built yet.

## The compact view (everyone's home screen)
Three buttons: **הדירה שלי** (your apartment's card and its payments with dates for the selected year), **חייבים** (who owes), **הכל** (all apartments). Tenants see statuses for everyone and payment details only for their own apartment (served by the `apt_payments` database function, which returns just month, amount, method and date). Owners and the view-only administrator tap any card to see that tenant's payments, and get links to the admin console tabs (table, bank import, apartments, what tenants see, users). Which apartment is "mine" is decided only by the owner, in the "משתמשים" tab (the apartment field next to each email; empty = not linked). Only the owner can link, change or remove an apartment link, for tenants, apartment owners and the administrator alike; this is enforced by the database and covered by tests.
Payments recorded in the old Excel have no payment date, only the month they were for; payments imported from the bank or added in the app from now on carry the date.

## Monthly routine
Log in → "ייבוא מהבנק" → choose the bank `.xlsx` → review yellow rows → save. Tenants see the update immediately.

## Try it locally without Supabase
```
npm run dev     # http://localhost:3000/index.html?demo=owner   (also demo=admin, demo=tenant)
```
Demo mode keeps changes in memory only.

## Notes
- Free Supabase projects pause after a week of no activity; resume from the dashboard if that happens.
- `docs/` has the brief, PRD and architecture notes.
