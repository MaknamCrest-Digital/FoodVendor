# Pilot readiness — Maknam POS Version 1

Audit baseline: **2 October 2026**, before implementing the new Settings/RBAC brief.
**NOT PILOT READY.** This report distinguishes source code from verified acceptance.

Status vocabulary: IMPLEMENTED = working behavior with relevant evidence; PARTIAL =
some behavior exists but required paths remain; MOCKED = fixture/simulated behavior;
MISSING = no functional implementation; BLOCKED = external evidence/access required.

| Capability | Baseline status | Evidence / gap |
|---|---|---|
| FastAPI login/logout/session | IMPLEMENTED | Scrypt password hashes, opaque revocable sessions, expiry, real login UI; prior login browser/API tests passed. Offline session policy needs pilot device review. |
| Tenant/location authorization | PARTIAL | Auth context gates sale/admin writes and snapshots; second-tenant permission/settings scenarios still required. |
| RBAC and final Owner protection | MISSING | Single ADMIN model; no tenant role tables, effective permissions, overrides or backend action checks. |
| Menu/categories/variations | PARTIAL | New durable menu/category repository and UI under construction; not yet acceptance-tested. |
| Historical prices | PARTIAL | Order item name/price snapshots persist; variation snapshot and stale-price checks newly added, awaiting tests. |
| POS checkout | PARTIAL | Local atomic IndexedDB order/payment/audit/outbox; stock transaction newly integrated. Needs new acceptance suite. |
| Payments/tender/change/reference | PARTIAL | Cash/MoMo/Card method recording exists; tenant methods, tender/change and required references missing. No gateway is claimed. |
| Native SQLite persistence | MISSING | Browser implementation is IndexedDB schema 1. No Capacitor/native SQLite adapter or Android project is present. |
| Browser offline restart | PARTIAL | Static export/service-worker and durable IndexedDB exist; new menu/stock/shift restart suite not yet run. |
| Bluetooth ESC/POS printing | MOCKED | `BrowserMockPrinter` logs a receipt; it is not a connected hardware printer. |
| Native printer acceptance | BLOCKED | Requires Android pilot terminal and actual receipt printer pairing, disconnect/retry and paper-width evidence. |
| Configurable receipt snapshots | MISSING | Current receipt uses deployment fixture details; settings, cashier, tender/change and shared preview renderer required. |
| Sales ledger | PARTIAL | Saved sales/receipts and sync indicators work; corrections UI, operator data and failed-sync visibility incomplete. |
| Refund/void rules | PARTIAL | Append-only correction validation exists server/client; full cashier authorization, UI and reconciliation tests missing. |
| Shifts | PARTIAL | Open/close/cash movement service and UI exist; operator/device scope, required-sale rule and variance note incomplete. |
| Expenses | PARTIAL | Persistence/record form exist but route still presents fixture content; drawer-expense linkage missing. |
| Simple menu stock | PARTIAL | Opening/restock/adjust/wastage history and local sale deduction added; cloud atomic protocol 2 and tests underway. |
| Dashboard | PARTIAL | Replacing fixture totals with ledger/stock/shift data; granular permissions and regional business-day handling missing. |
| Reports | MOCKED | Fixture report rows and controls; no real operational report calculations/export. |
| Sync/idempotency | PARTIAL | Durable retries/ack matching and protocol 1 exist; protocol 2 stock envelope added but unverified. Cross-terminal conflicts need operator review. |
| Audit | PARTIAL | Immutable operational journal exists; route uses fixtures and auth/settings/print event coverage incomplete. |
| Settings | MOCKED | Existing route uses fixture rows; no functional scoped repositories or behavioral configuration. |
| Team & Access | MISSING | Staff records are not login accounts or permission management. |
| Devices | PARTIAL | Terminal model exists; device screen is fixture content; pairing/native identity absent. |
| Updates | PARTIAL | Worker waits for old tabs; version constants exist. Native migration/rollback with pending sales untested. |
| PostgreSQL production deployment | PARTIAL | SQLAlchemy/Alembic infrastructure exists; deployed migration and concurrent-terminal evidence missing. |

## Required implementation sequence

1. Finish and test the current menu/stock/local checkout work without introducing a
   second product list.
2. Implement scoped Settings and authoritative tenant permissions together; add
   Owner protection and a cashier acceptance account.
3. Apply cached configuration/permissions to payments, receipts, shifts, sync and
   dashboard; complete ledger corrections/expenses/audit/reports needed for pilot.
4. Add native SQLite/Capacitor/ESC-POS integration and validate on real hardware.
5. Execute all pilot acceptance scenarios, including 20 offline sales and restart.

## Known safety issue from earlier development

An API test import-order error reset the earlier local `food_vendor_os.db` on
28 September. No workspace backup was available. Browser sales were not touched.
Tests now force in-memory databases before imports and override sessions; a later
test run verified the development database hash was unchanged. The local login
preview uses `maknam_local.db`. Do not treat the reset database as reconciled data.

## Migration and validation record

- Existing expand-only `0001_admin.py`: authentication/admin journal tables.
- Current menu/stock work reuses the journal and browser schema 1; no destructive
  schema reset. Sync protocol 2 is separate from app version 1.0.0 and retains v1.
- New Settings/RBAC migrations and final test results will be recorded here after
  implementation. Current tests are being updated for configured menus; no green
  build or pilot completion is claimed for this in-progress baseline.

Recommended next implementation task: finish atomic menu-stock acceptance, then
scoped Settings plus server-enforced RBAC. Native hardware remains a release blocker.
