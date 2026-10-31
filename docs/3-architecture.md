# Architecture — ועד הבית

**Role (BMAD Architect)**

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Runtime | Node, zero web framework (`http`) | one dependency (`xlsx`), easy to run on the treasurer's PC |
| Storage | `data/db.json` (+ `data/backups/`) | 26 apartments, ~2k rows; no DB needed; human-inspectable |
| Admin UI | single static page `web/index.html`, vanilla JS | no build step |
| Tenant sharing | `npm run publish` / button → `site/` static folder | host free anywhere (Netlify Drop, GitHub Pages, Google Drive hosting); no server, no logins, no PII |
| Bank parsing | `xlsx` library | bank export is `.xlsx` |

## Modules
```
lib/db.js       load/save/backup db.json
lib/seed.js     workbook -> db.json
lib/calc.js     dues, paid map, status grid, debts
lib/bank.js     parse bank export
lib/match.js    payer -> apartment matching + allocation
lib/publish.js  build site/
server.js       REST API + static admin UI
web/index.html  admin SPA
```

## Data model (db.json)
`apartments[{apt,floor,rooms,sqm}]`, `residents[{apt,first,last,first2,last2,phone1,phone2,role,status,account,...}]`,
`owners[...]`, `tariffs[{year,month,apt,amount,note}]`,
`payments[{id,apt,y,m,amount,method,date,note,ref,src,txKey}]`, `expenses[...]`,
`bankSeen[txKey]`, `refSeen["year|ref"]`, `aliases{payerKey:apt}`, `ignored[txKey]`, `settings{title,showNames,showDebt}`.

## API
`GET /api/grid?year` · `GET /api/apartments` · `PUT /api/resident` · `POST /api/payment` · `DELETE /api/payment/:id` ·
`POST /api/import/preview` · `POST /api/import/commit` · `GET/PUT /api/settings` · `POST /api/publish`

## Risks
- Free-text matching errors → always reviewed before commit; learned aliases.
- Duplicate import → ref+year and bank-key dedup.
- Privacy → public JSON is generated from an allow-list of fields.

---
## Revision 2 — shared hosting and roles (replaces local-only storage)
- **Hosting:** static app on GitHub Pages (`app/`), logic in the browser (`lib/*` bundled into `app/vaad-lib.js` by `scripts/build-app.js`).
- **Database:** Supabase Postgres. Tables in `supabase/schema.sql`; legacy `data/db.json` is only the migration source (`scripts/make-seed.js`).
- **Auth:** Supabase email magic links. `members(email, role, apt)` maps a verified email to `owner | admin | tenant`.
- **Authorization:** Postgres row-level security via `app_role()`. owner = read/write; admin = read; tenant = read `snapshot` only. Verified by `scripts/test-rls.mjs` (43 checks).
- **Tenant data path:** the owner's app writes an allow-listed `snapshot` row after every change; tenants can read nothing else, so phones, accounts and bank descriptions cannot leak.
- **Module changes:** `server.js` and `lib/publish.js` removed; `lib/service.js` holds the former API routes, `app/common.js` the Supabase store and a demo store.

## Revision 3 — multi-building
- `buildings` table; every data table has `building_id`; `members` is keyed by `(building_id, email)` so a person can have a different role in each building.
- `app_role(building_id)` drives all row-level-security policies; tenants read only their building's `snapshot` row.
- The app stores the chosen building in the browser, scopes every query by it, and offers a switcher for people with several memberships.
- Verified by `scripts/test-rls.mjs` (136 checks: 7 kinds of user x 2 buildings, escalation and cross-building attempts) and `scripts/test-seed.mjs`.
- Not yet built: onboarding UI for an empty building; moving matching/allocation to server functions; native store wrappers (Capacitor).

## Revision 4 — five roles (2026-10-29)
- **Platform tables:** `super_users` (unique index on a constant: one row at most; no policy, no grant: only the SQL editor writes it), `managers`, `manager_buildings` (written only by the super user).
- **Building roles:** `members(id, building_id, email, role, apt, name)` with role `committee | tenant | apt_owner`; one email may hold several rows (unique on building, email, role, apartment).
- **Permission functions** (security definer, search_path fixed): `is_super`, `is_manager_of`, `has_role`, `can_manage`, `can_see_board`, `is_member_any`. Policies call these only; the old `app_role()` is gone.
- **Narrow functions for people without table access:** `my_snapshot` (the board, filtered to owned apartments for an apartment owner), `apt_payments`, `apt_tenants`, `create_building`.
- **Grant hierarchy** is a single `members` policy: super (any) or manager of the building (any role) or committee of the building (tenant / apt_owner only).
- **Client:** `whoami` builds one object per building with the person's roles, linked apartments and what they may grant; the compact view and the console read it. The app only shapes the UI; the database refuses everything else.
- **Migration:** `supabase/migrate-roles.sql` then `schema.sql` (idempotent). `scripts/test-migration.mjs` runs it on the previous schema and proves the result equals a fresh install (policies, functions, grants, constraints).
- **Known gaps:** a new building is empty (no in-app entry of apartments and tenants yet); helper functions are callable through the API but only reveal the caller's own roles (Supabase linter warnings, accepted).

## Revision 5 — one table for people, one for roles (2026-10-31)
- **`users(id, email unique nullable, first_name, last_name, phone, bank_account)`** is the master list of people. A numeric id (not the email) so tenants without an email are users too; the email is the login identity (`my_uid()` = the users row whose email is the JWT email).
- **`members(id, building_id, user_id, role, apt)`** are the roles; the email and name columns are gone. `residents.user_id / user2_id` and `owners.user_id` replace the name, phone and account columns.
- **Read/write:** the super user writes users; staff read users that hold a role in, or are tenants/owners of, a building they manage (policy `staff_read`); everyone reads their own row. `user_for_email(e)` (super, managers, committee) finds or creates an email-only user so roles can be granted by email. `apt_tenants()` joins users so apartment owners still see only their tenants' name and phone.
- **App shape unchanged:** `supabaseStore.load()` joins users into the flat resident/owner objects (`first`, `phone1`, `account`...), so calc, bank matching and the snapshot are untouched. Editing personal fields goes through `updateResident`/`updateUser` and is refused by RLS for anyone but the super user.
- **Backups** carry the referenced users; restore inserts them first (`on conflict (id) do nothing`).
- **Migration:** `supabase/migrate-users.sql` (users from members/managers/super, one user per tenant, second person or phone, owner; drops the old columns) then `schema.sql`. Tested on both older schemas and compared with a fresh install; the live database was migrated with a copy of the three tables kept in a private `bak` schema.
