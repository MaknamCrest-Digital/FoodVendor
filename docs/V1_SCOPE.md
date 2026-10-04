# Maknam POS Version 1 — food vendor pilot scope

Scope locked on **2 October 2026** from the owner's product and Settings briefs.

- V1 target: food vendors.
- First pilot: Adonai Pork, Dansoman, Ghana.
- Second tenant isolation scenario: Chics & Chips.
- Feature-complete pilot candidate target: before November 2026.
- November: controlled parallel pilot, staff training, offline/printer/reconciliation
  tests, deployment validation and fixes.
- Production target: December 2026, conditional on acceptance evidence.
- Release remains 1.0.0. API, device schema and sync protocol have independent versions.

## Required cashier flow

Login → open own shift → choose configured menu item/variation → take Cash/MoMo/Card
payment → commit order/items/payment/stock/audit/outbox locally → attempt receipt
print → continue. Normal counter sales cannot depend on the cloud. Print failure
does not cancel a committed payment. Reprint does not post another sale.

Financial integrity, offline reliability, accurate reconciliation and cashier speed
take priority over new features. Historical prices and receipts are snapshots.
Corrections are explicit records; completed sales and stock history are not deleted.

## Pilot scope

Real FastAPI authentication; tenant/location/device boundaries; tenant-owned roles,
permissions and user overrides; configurable menu/categories/free-form variations;
touch POS; tender/change and payment references; native persistent SQLite;
Android/Capacitor receipt printing; sales/corrections; own shifts/cash in-out;
expenses; countable menu stock; financial dashboard; operational reports; retry-safe
sync; audit; scoped Settings; device configuration.

The **2 October RBAC requirement supersedes the earlier Admin-only/no-RBAC decision**.
Owner has default full access; the final active Owner cannot lose access management.
Cashier permissions must not disclose unrestricted business financial information.
UI visibility is secondary to authoritative FastAPI permission checks.

Menu defines what is sold. Inventory shows the same menu records with `trackStock`
enabled. Ingredient recipes and automatic meal ingredient deductions are deferred.

Settings contains General, Appearance, Payments, Receipts, POS, Team & Access,
Account, Sync & Data, and About. Business/location/user/device scopes are separate.
Operational configuration is cached locally. Menu/stock/sales remain their own modules.

Keep the existing Next.js App Router/React/TypeScript/Tailwind frontend, FastAPI,
PostgreSQL/SQLAlchemy/Alembic backend and current visual system. No Vite or second
backend. Tenant identity comes from authenticated server context, never a trusted
frontend business ID. Adonai names and receipt messages belong in tenant fixture data.

## Out of scope before the pilot

Customer storefront, online payments/gateway integration, delivery, loyalty,
ingredient BOM/recipes, payroll, advanced accounting/BI, AI features, multi-branch
management and specialized non-food retail flows. Preserve clean extension points.
Kitchen display and online ordering must not block the cashier pilot.

## Release gate

Do not declare pilot readiness from screen presence or mocks. Use
[PILOT_READINESS.md](PILOT_READINESS.md) and
[ADONAI_PILOT_CHECKLIST.md](ADONAI_PILOT_CHECKLIST.md). Resolve P0 data/money/security
loss and P1 operation blockers before production; address major P2 workflow issues.
Never reset local databases or discard unsynced records for updates.
