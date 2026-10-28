# Product Brief — ועד הבית (Vaad)

**Role (BMAD Analyst):** Mary-style discovery, condensed.

## Problem
A 26-apartment building's committee treasurer tracks monthly dues in an Excel workbook
(`הכנסות_הוצאות.xlsx`: apartments, owners, residents, tariffs, payments, expenses).
Every month he reads the bank statement (`עובר ושב`) by eye, finds who paid and types it in.
Tenants have no visibility into who paid.

## Users
| User | Need |
|---|---|
| Treasurer (admin, 1 person) | Upload the bank export → see who paid / who didn't, with minimal typing |
| Tenants (26 households, read-only) | See the payment status at a glance, on a phone, without logging in |

## Goals
1. Import a bank statement and auto-match each credit to an apartment (by account no., apartment hint, name).
2. Show a clear apartment × month grid: paid / partial / unpaid, plus outstanding debt.
3. Publish a read-only, privacy-safe status page for tenants.
4. Keep all history from the existing Excel (2022–2026).

## Non-goals (v1)
Online payments, tenant logins, reminders by SMS/WhatsApp, expense management UI (expenses are imported and kept, not edited).

## Success
Monthly update takes < 5 minutes; tenants stop asking "did X pay?".

## Key constraints
- Hebrew, right-to-left, mobile-friendly public page.
- Bank descriptions are free text; matching must be reviewable and learn from corrections.
- Bank file overlaps with the Excel (Jan–Oct 2026 already recorded) → must not double count.
- Tenants' phones and bank accounts must never be published.
