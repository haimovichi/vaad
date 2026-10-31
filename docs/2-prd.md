# PRD — ועד הבית (v2, updated 2026-10-29)

**Role (BMAD PM).** Replaces the v1 PRD, which described a local-only app. Stories and status: `4-stories.md`.

## Product in one line
A phone-first payment tracker for building committees: the owner imports the bank statement, everyone in the building sees who paid, and each person sees only what their role allows.

## Roles (v3, replaces owner / admin / tenant)
| Role | Who | Can |
|---|---|---|
| Super user | exactly one person (platform owner) | everything in every building; set only in the SQL editor, never from the app |
| Buildings manager | looks after several buildings | manages the buildings assigned to them; creates buildings (and becomes their manager); gives out committee, tenant, apartment-owner roles in them |
| Building committee | the committee of one building | manages that building (bank import, payments, tenants, backup, what tenants see); gives out tenant and apartment-owner roles in it |
| Tenant | each household | the whole board (statuses); payment details with dates for their own apartment |
| Apartment owner | a landlord | only their apartments: status, the current tenant's payments with dates, the tenant's name and phones |
| (none) | unlisted email | nothing |

A person can hold any mix of roles, in several buildings; the roles combine. The view-only "admin" of v2 no longer exists: the other administrator is a committee member with full rights in that building.

Who gives which role: super user: any role, any building, and buildings managers. Manager: committee / tenant / apartment owner in their buildings. Committee: tenant / apartment owner in their own building.

## Functional requirements
**Data and dues**
- FR1 One-time migration of the existing Excel workbook (apartments, owners, residents, tariffs, payments, expenses) into the database.
- FR2 Amount due per apartment per month = yearly base tariff, replaced by an apartment-specific tariff when present, plus one-off month surcharges.
- FR3 The unit of account is a **tenancy** (a resident row: apartment + entry..exit month). Debts stay with the tenant who incurred them; a new tenant starts clean; the status grid shows one row per tenancy.
- FR4 A tenancy's payments form one pool applied to its oldest unpaid month first (catch-up lump sums cover arrears, surplus covers upcoming months). Statuses: paid, partial, unpaid, current-month pending, prepaid, future.

**Bank import (owner)**
- FR5 Upload the bank export (`.xlsx`); parsed in the browser. Credits are listed, debits ignored.
- FR6 Already-recorded rows are skipped: by bank reference number + year, by bank key once imported, and by a suggested "recorded up to" date (rows before the last provably recorded one are presumed in the workbook; the owner can override).
- FR7 Payer matching in order: learned alias, account number in the description, "דירה N" hint, full name, last name only (flagged). Ambiguous or unknown rows are chosen by hand; "remember" saves the link.
- FR8 Each credit is split over months: transaction month, then oldest unpaid in the last 6 months, then upcoming months. Editable before saving; sums must match.
- FR9 Cheque deposits and other unnamed credits are assigned by hand or ignored.
- FR10 Manual payments (cash, cheque) can be added or deleted from a month cell.

**Access**
- FR11 Login by emailed link, no passwords. Only emails listed for a building get access.
- FR12 Roles and building isolation are enforced by the database (row-level security), not just the UI.
- FR13 Role management in the "משתמשים" tab by whoever may give the role (see the hierarchy above); tenants' and apartment owners' apartment numbers are editable inline. Buildings managers are appointed by the super user only ("מנהלי בניינים" tab). The one super user cannot be added or changed even through the app's database access.
- FR14 A tenant or apartment owner reads their own apartment's payments (month, amount, method, date) through one narrow database function: current tenancy only, never notes, bank descriptions, references or accounts. An apartment owner additionally reads the current tenant's names and phones, again only for their own apartments.

**Compact view (home screen for everyone)**
- FR15 Three buttons: **הדירה שלי** (default; your apartment card and your payments with dates for the selected year), **חייבים** (who owes, largest first), **הכל** (all apartments, searchable, former tenants collapsed). Year selector. Summary: paid this month, apartments with debt.
- FR16 Owner and admin: tap any card to see that tenant's payments for the year with dates; links to the admin console tabs (table, bank import, apartments, what tenants see, users); the console links back.
- FR17 What tenants see about others is an allow-listed snapshot: apartment number, tag (current/former tenant), monthly status, and optionally last name and debt amount (owner setting). Rewritten after every change.
- FR18 "הדירה שלי / הדירות שלי" comes only from the links set in the users tab (tenant or apartment-owner rows); no link means the button says so. An apartment owner who is not also a tenant sees only their own apartments, enforced by the database (a filtered view of the board), not by the screen.

- FR21 People overview (super user and buildings managers): one list of every person with all their roles in every building they can see, with filters, so the same person can be committee in one building and tenant in another and it is visible in one place.

- FR23 People are one main table (first name, last name, email, full phone, bank account if any; the email is optional, so tenants without one are still people who just can't log in). Roles are a separate table: a person may hold many roles, even in the same building (owner of three apartments, tenant in one, committee) and in other buildings. Only the super user edits people; the staff of a building read the people of that building.
- FR22 One page, one menu for everyone (one flat ☰ menu on phones, side menu on computers, ← בית on every screen but Home), showing only the sections a person's roles allow. No separate detailed table screen: whoever manages the building gets the full detail (balance, exact paid/due per month, payments with dates, add and delete a payment) when drilling into an apartment card.

**Backup**
- FR20 One-click backup for whoever manages a building of the whole building (every table, as stored) from the admin console, and a restore tool that turns the file into SQL for the Supabase editor (fresh restore, or `--replace` for this building only).

**Multi-building**
- FR19 Every row belongs to a building; one email may belong to several buildings (a building switcher appears). The super user, buildings managers and committee members create buildings in the app; the name is the address, picked from the official city/street list plus a house number (a new building is empty; entering its apartments and tenants in the app is still backlog).

## Non-functional
- Hebrew, right-to-left, usable at 360 px without horizontal scroll; dark mode.
- Hosting: static app on GitHub Pages, Supabase Postgres (EU region), no custom backend servers.
- Personal data never committed to the public repository; seeds and demo data are git-ignored.
- Verification: `npm test` (401 role checks across 3 buildings and 10 kinds of person incl. multi-role, hierarchy and escalation attempts; the migration from v2; backup round trip) and `npm run test:seed`.

## Out of scope for now / backlog
- Onboarding screen to enter apartments and tenants for an empty building (today: load from a workbook).
- Moving matching and allocation to server functions before many buildings use it.
- Wrapping the app for Google Play and the App Store (planned route: Capacitor), with push notifications.
- Payment reminders, online payments, expense management screens.
- Payment dates for the history recorded in Excel (only the month is known).

## Key acceptance (current state)
| Check | Result |
|---|---|
| 2026 collected total after migration equals the workbook (164,520 ₪); all-time 739,560 ₪ | verified |
| Importing the supplied bank file creates no duplicates | verified (demo and API) |
| Apartment 8's 70 ₪ debt stays on the previous tenant; the current tenant owes nothing | verified |
| A tenant cannot read other apartments' payments, other buildings, or bank descriptions | verified (database tests) |
| Only the owner can link or change an apartment link | verified (database tests) |
| Login email arrives and opens the app | verified by owner |
| Compact view "הדירה שלי" opens on apartment 18 with the real login | pending owner check on the live site |
