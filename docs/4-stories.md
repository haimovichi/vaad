# Stories and status (2026-10-29)

**Role (BMAD Scrum Master / QA), written after the fact** from the work done. Status: Done = built and verified as noted; Backlog = not built. Requirement numbers refer to `2-prd.md`.

## E1 Data foundation
| Story | Acceptance | Status |
|---|---|---|
| S1.1 Migrate the Excel workbook | 26 apartments, 33 tenancies, 848 payments, 269 expenses; payments total 739,560 ₪; 2026 total 164,520 ₪ (FR1) | Done, verified in the live database |
| S1.2 Dues per tenancy | Base + apartment override + one-off surcharges; no gaps or overlaps in tenancy dates (FR2, FR3) | Done, verified on the real data |
| S1.3 Status grid and debts | Pooled oldest-first coverage; apartment 3 owes 1,710 ₪, apartment 8's 70 ₪ sits on the previous tenant (FR4) | Done, verified |
| S1.4 Workbook typo guard | A payment "for 2029" is read as 2026 | Done |

## E2 Bank import
| Story | Acceptance | Status |
|---|---|---|
| S2.1 Parse the bank export in the browser | 232 rows read; dates correct in any timezone (FR5) | Done |
| S2.2 Skip what is already recorded | 0 new rows for the supplied file; suggested cut-off date; no double counting (FR6) | Done |
| S2.3 Match payers | Account no. / apartment hint / name; uncertain rows flagged; learned aliases (FR7) | Done, 119 real rows reviewed in testing |
| S2.4 Split over months and save | Sums must match; re-saving the same row adds nothing (FR8) | Done, verified in demo mode |
| S2.5 Cheque deposits and manual payments | Assign or ignore; add and delete from a cell (FR9, FR10) | Done |
| S2.6 Import against the live database with a real new bank file | New month's file saves and tenants see it | Backlog: first real monthly run |

## E3 Access and roles
| Story | Acceptance | Status |
|---|---|---|
| S3.1 Login by emailed link | Email arrives from the configured sender and opens the app (FR11) | Done, verified by owner |
| S3.2 Roles enforced by the database | owner / admin / tenant / stranger / logged-out behave as the matrix says (FR12) | Done, `test:rls` |
| S3.3 Owner-only user management | Add, remove, change role, inline apartment link (FR13) | Done, verified in demo mode and by tests |
| S3.4 Owner-only apartment linking | Admin, tenants, strangers and other buildings' owners are blocked (FR13, FR18) | Done, 13 tests |
| S3.5 Own-payments function | Tenant sees only own apartment's current tenancy; columns limited to month, amount, method, date (FR14) | Done, tested and checked live |

## E4 Compact view
| Story | Acceptance | Status |
|---|---|---|
| S4.1 Phone-first cards with a 12-month strip | No horizontal scroll at 375 px (FR15) | Done |
| S4.2 Three buttons and own payments with dates | Default "הדירה שלי"; year selector; yearly total (FR15) | Done, verified in demo mode |
| S4.3 Debtors and all, search, former tenants collapsed | (FR15) | Done |
| S4.4 Admin drill-down and console links | Tap a card for payments with dates; links open the right console tab (FR16) | Done, verified in demo mode |
| S4.5 Tenant-safe snapshot and owner settings | Names and debt amounts optional; no phones or accounts (FR17) | Done, verified in the database seed test |
| S4.6 Real-login check of the live compact view | Owner login opens on apartment 18 with real payments | Done 2026-10-30: owner confirmed on the phone (after the fix that opens the compact view for a bare console address) |

## E5 Hosting and operations
| Story | Acceptance | Status |
|---|---|---|
| S5.1 GitHub Pages deploy | Push to `main` redeploys; data files not served | Done, verified |
| S5.2 Supabase project and email sending | Region Frankfurt; Gmail SMTP | Done |
| S5.3 Multi-building schema | Isolation tested across two buildings (FR19) | Done, 162 checks |
| S5.4 Backup / export (FR20) | Owner-only one-click download of every table of the building; restore script rebuilds it exactly, refuses a second run, and `--replace` leaves other buildings alone | Done: `test:backup` (8 checks), owner download and admin refusal verified in demo mode, export queries checked on the live database. Backlog: first real download from the live site |

## E6 Five-role model (2026-10-29)
| Story | Acceptance | Status |
|---|---|---|
| S6.1 One super user, only from the SQL editor | A second row cannot be added, even by the SQL editor; no app user can read, add or delete it | Done, tested |
| S6.2 Buildings manager | Manages assigned buildings only; creates buildings and becomes their manager; cannot appoint managers | Done, tested; create flow verified in demo mode |
| S6.3 Building committee | Full management of one building; cannot give the committee role; cannot touch other buildings | Done, tested |
| S6.4 Multi-role people | Roles combine across and within buildings (e.g. committee + tenant + apartment owner) | Done, tested and verified in demo mode |
| S6.5 Apartment owner | Sees only their apartments: status, current tenant's payments with dates, tenant name and phones; cannot read the whole board | Done: database functions tested (`my_snapshot`, `apt_payments`, `apt_tenants`), screen verified in demo mode |
| S6.6 Grant hierarchy | Super > manager > committee as in the PRD; escalation attempts fail | Done, tested |
| S6.7 Migration of the live database | Old owner -> committee (+ apartment owner for their apartment); old view-only admin rows block the migration; result identical to a fresh install | Done: `test:migration`; applied to the live database and verified by impersonation |
| S6.8 Console: buildings and managers tabs, role-aware users tab | Only offers what the person may do | Done, verified in demo mode |
| S6.9 Real-login check of the new roles on the live site | Owner login opens correctly; add a test tenant and a test apartment owner and look at their screens | Partly done: the owner/super-user login works on the live site; tenant and apartment-owner logins with spare emails still to check |
| S6.10 People overview | Super user: everyone with every role in every building; a manager: the people in their buildings; committee, tenants and apartment owners: no access. Filter by email, by building, and only people with several roles; a role opens that building's users tab | Done, verified in demo mode for super user, manager and committee |

## Backlog (from the PRD)
Empty-building onboarding screen · server-side matching and allocation · Capacitor wrapper for Google Play and the App Store with push notifications · payment reminders · expense screens · dates for historic Excel payments.
