# Food Vendor OS — Engineering Instructions

## Mission
Build an offline-first, multi-tenant restaurant operating system for Ghanaian food vendors.
Initial pilot: Adonai Pork. Customer-ordering pilot: Chics & Chips.
Reliability and data integrity take priority over UI novelty.

## Non-negotiables
- POS continues selling without internet.
- Local-first writes: SQLite before cloud sync.
- Cloud DB: PostgreSQL; backend: Python FastAPI.
- Offline entities use UUIDs.
- Sync is idempotent; retries never duplicate sales.
- Bluetooth ESC/POS printing works without internet.
- Food Vendor OS Version 1; application release 1.0.0.
- Android-first POS using Next.js App Router + React + TypeScript + Tailwind; static export for planned Capacitor packaging.
- All Version 1 module routes belong to the existing apps/pos Next.js frontend. Do not scaffold another frontend.
- Preserve existing UI and functionality during framework changes. Planned module routes must not imply unimplemented workflows are available.
- API is versioned under `/api/v1`.
- Multi-tenant from day one; tenant authorization is server-enforced.
- Completed sales are immutable. Corrections use void/refund/reversal records.
- App rollback must not require database rollback under normal releases.
- Database migrations use expand → migrate → contract.

## Required engineering checks before a feature
1. Domain behavior.
2. Offline behavior.
3. Sync behavior and idempotency.
4. Authorization/tenant isolation.
5. Migration/backward compatibility.
6. Tests.
7. Implementation.

## Release safety
Track app_version, api_version, local_schema_version and sync_protocol_version independently. Keep historical release artifacts and Git tags. Prefer feature flags and staged rollouts. Never force updates during an active shift unless a genuine security/incompatibility emergency exists.

## POS UX
Tablet/touch-first, large targets, minimal typing, clear total, printer/connectivity/sync state. Do not turn the cashier UI into an ERP.

## Printing
Payment recording is independent of print success. Failed prints can be retried without recreating the sale. Receipt and kitchen printing are distinct.

## Critical tests
Offline sale; offline print; reconnect/sync; duplicate retry; restart with pending sync; upgrade without data loss; API rollback compatibility; tenant isolation; refund authorization; concurrent offline terminals.
