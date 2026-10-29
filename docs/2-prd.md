# PRD — ועד הבית (v2, updated 2026-10-29)

**Role (BMAD PM).** Replaces the v1 PRD, which described a local-only app. Stories and status: `4-stories.md`.

## Product in one line
A phone-first payment tracker for building committees: the owner imports the bank statement, everyone in the building sees who paid, and each person sees only what their role allows.

## Roles (per building)
| Role | Who | Can |
|---|---|---|
| owner | building committee treasurer | everything: bank import, payments, tenants, apartment links, what tenants see, users |
| admin | second building administrator | read-only, sees all data including phones |
| tenant | each household or landlord | statuses of all apartments; payment details only for the apartment linked to their login |
| (none) | unlisted email | nothing |

A person can hold a different role in each building. Only the owner links an apartment to a person.

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
- FR13 Owner-only management of users, roles and apartment links ("משתמשים" tab); the apartment number is editable inline.
- FR14 A tenant reads their own apartment's payments (month, amount, method, date) through one narrow database function; never notes, bank descriptions, references, phones or accounts, and never the previous tenant's payments.

**Compact view (home screen for everyone)**
- FR15 Three buttons: **הדירה שלי** (default; your apartment card and your payments with dates for the selected year), **חייבים** (who owes, largest first), **הכל** (all apartments, searchable, former tenants collapsed). Year selector. Summary: paid this month, apartments with debt.
- FR16 Owner and admin: tap any card to see that tenant's payments for the year with dates; links to the admin console tabs (table, bank import, apartments, what tenants see, users); the console links back.
- FR17 What tenants see about others is an allow-listed snapshot: apartment number, tag (current/former tenant), monthly status, and optionally last name and debt amount (owner setting). Rewritten after every change.
- FR18 "הדירה שלי" is decided only by the owner's link; no link means the button says so.

**Multi-building**
- FR19 Every row belongs to a building; one email may belong to several buildings (a building switcher appears). New buildings are created by the platform operator in the SQL editor.

## Non-functional
- Hebrew, right-to-left, usable at 360 px without horizontal scroll; dark mode.
- Hosting: static app on GitHub Pages, Supabase Postgres (EU region), no custom backend servers.
- Personal data never committed to the public repository; seeds and demo data are git-ignored.
- Verification: `npm run test:rls` (162 checks: roles x 2 buildings, escalation, cross-building, own-payments function, apartment linking) and `npm run test:seed`.

## Out of scope for now / backlog
- Onboarding screen to enter apartments and tenants for an empty building (today: load from a workbook).
- Moving matching and allocation to server functions before many buildings use it.
- Wrapping the app for Google Play and the App Store (planned route: Capacitor), with push notifications.
- Payment reminders, online payments, expense management screens.
- Data export / backup button (free Supabase plan has no downloadable backups).
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
