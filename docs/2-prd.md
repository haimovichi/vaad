# PRD — ועד הבית

**Role (BMAD PM)**

## Functional requirements
- **FR1 Seed:** one-time import of the existing workbook (apartments, owners, residents, tariffs, payments, expenses).
- **FR2 Dues:** amount due per apartment per month = base tariff of the year, replaced by an apartment-specific tariff when present, plus one-off month surcharges (e.g. Jan 2026 +130).
- **FR3 Bank import:** upload the bank `.xlsx`; credits are parsed; already-recorded ones are skipped (by reference number + year, and by bank key once imported).
- **FR4 Matching:** order — learned alias → account number in description → "דירה N" hint → full name → last name only (flagged for review). Ambiguous / unknown rows are left for manual choice.
- **FR5 Allocation:** each credit is split over months: transaction month first, then oldest unpaid month within the last 6 months, then future months. Editable before commit.
- **FR6 Review & commit:** treasurer confirms, changes apartment, edits allocations, or ignores a row. Corrections are remembered as aliases.
- **FR7 Status grid:** apartment × 12 months for a chosen year; cell states paid / partial / unpaid / current-month pending / future / prepaid; per-apartment debt.
- **FR8 Manual payment** (cash, cheque) add and delete, from a grid cell.
- **FR9 Publish:** generate a static folder `site/` (HTML + data) with apartment numbers and statuses only (names/debt amounts optional via settings) that can be hosted anywhere.

## Non-functional
- Runs locally with `npm start` (Node ≥ 18), data in one JSON file `data/db.json` (backed up on every write).
- No login on the admin app (localhost only). Public site is static.
- Hebrew RTL, works at 360 px width.

## Epics → stories
1. **E1 Data foundation** — S1.1 seed from Excel, S1.2 dues calculation, S1.3 status grid API.
2. **E2 Bank import** — S2.1 parse bank file, S2.2 matcher, S2.3 allocation, S2.4 preview/commit with dedup, S2.5 alias learning.
3. **E3 Admin UI** — S3.1 grid, S3.2 import screen, S3.3 manual payment, S3.4 apartments & settings.
4. **E4 Tenant sharing** — S4.1 static publish, S4.2 privacy settings.

## Acceptance (key)
- After seed, 2026 collected total equals the workbook dashboard (164,520 ₪).
- Importing the supplied bank file creates **no duplicate** of payments already in the workbook.
- A transfer whose description contains a known tenant's last and first name (for example "העברה מ<last> <first> … 570") is matched to that tenant's apartment automatically.
