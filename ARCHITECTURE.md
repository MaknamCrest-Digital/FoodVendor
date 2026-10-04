# Architecture

```text
Android Tablet
Next.js App Router + React + TypeScript + Tailwind
Static export packaged with Capacitor Android
        |
        +-- Native SQLite adapter (orders/outbox JSON records)
        +-- Browser IndexedDB adapter and tenant-scoped transfer bundle
        +-- Browser/system print adapter; physical printer adapters are platform-specific
        |
   background sync
        v
FastAPI /api/v1
        |
PostgreSQL
        |
Version 1 module routes in apps/pos; customer ordering integration planned
```

## Boundaries
The POS owns immediate operational continuity. The cloud owns cross-device aggregation, management reporting and canonical synchronized records. A cloud outage must not stop a normal sale.

## Monorepo
- `apps/pos`: the single Version 1 frontend, Next.js App Router static export (`out/`)
- `apps/dashboard`: historical documentation reservation only; dashboard route is `/` in `apps/pos`
- `apps/customer-web`: reserved for Chics & Chips ordering
- `services/api`: Python FastAPI service
- `packages`: shared contracts/docs
- `database`: migration notes and schema policy
- `infrastructure`: deployment examples

## Compatibility
A release may add data/schema, but must preserve compatibility with the previous deployed client during staged rollout. Destructive contraction happens only after old clients are retired.

## Framework migration boundaries (1.0.0)
App Router layouts/pages are Server Components rendered at build time. The POS provider,
cart, sales table, connectivity, receipt dialog and printer interactions are Client Components.
A persistent layout provider keeps cart/payment state across `next/link` navigation.
There are no Next.js API routes, Server Actions, or server-dependent counter-sale operations.
FastAPI remains authoritative for cloud writes and tenant checks under `/api/v1`.

Existing layers remain in `src`: `lib/db.ts` lazily selects a `LocalDatabase` adapter.
Browser builds retain the IndexedDB database `food-vendor-os-pos`, schema 1 and its
existing stores; native Capacitor builds use a serialized SQLite transaction adapter.
`services/sync.ts` owns acknowledged retries; `services/printer.ts` separates receipt
rendering from available print adapters. The browser/system print dialog is supported;
Bluetooth, USB, network and native printer discovery/printing still require platform
adapters and hardware validation.

Service-worker generation precaches exported HTML, JS, CSS and App Router navigation
payloads for every route. API requests are never cached by the app-shell worker. Updates
wait for tabs to close. Native startup safely copies same-origin legacy IndexedDB rows
into SQLite without deleting the source. Because Chrome and Android WebView origins do
not share IndexedDB, Devices & Printers also provides an explicit tenant/location-scoped
JSON export/import flow. Imports are atomic, preserve conflicting data, and exclude
device settings/printer profiles.

`NEXT_PUBLIC_API_URL` selects the FastAPI endpoint at build time (default `/api/v1` for
same-origin deployments). Absolute HTTPS endpoints are needed for native/static hosts
without a reverse proxy. Public terminal identifiers are deployment configuration, not
credentials. Existing backend authentication gaps are not hidden by this migration.

All 15 Version 1 routes are retained in scope. Only POS and Sales had operational code
in the supplied checkout; other pages explicitly show planned status. See MIGRATION.md.

`apps/pos/android` is the generated Capacitor Android project. Android compilation and
native hardware validation require a configured JDK/Android SDK and target devices.
