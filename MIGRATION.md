# Food Vendor OS Version 1 — framework migration report

Application release: **1.0.0**. This is an in-place update of `apps/pos`.

## Current foundation status

The original framework migration report below records what the checkout contained at
migration time. Subsequent V1 foundation work keeps that application/UI and adds:

- A storage interface selected lazily by `src/lib/db.ts`: browser IndexedDB remains
  schema 1; Capacitor native builds use serialized SQLite transactions for the same
  order/outbox contract.
- A generated `apps/pos/android` Capacitor project and the community SQLite plugin.
- A one-time, non-destructive copy when the native WebView can access the old IndexedDB
  origin, plus an explicit tenant/location-scoped export/import flow for Chrome-to-Android
  transfers across origins. Import is atomic and rejects conflicting records; source data
  is never deleted. Settings and printer profiles are not included in transfer bundles.
- The cashier receipt dialog opens immediately after local sale commit. Printing is
  separate from the financial transaction, supports a browser/system print dialog, and
  never routes checkout to Sales.
- Device-scoped printer profiles and capability reporting. Bluetooth, USB, network and
  native printer adapters are not implemented; unsupported routes remain unavailable
  instead of implying a working hardware connection.

The Android project can be synchronized with `npm run cap:sync`. Native Android
compilation and printer validation still require a configured JDK/Android SDK and
physical hardware.

Latest verification: POS typecheck, lint, production build and Capacitor sync pass;
all 17 POS unit tests pass; Playwright reports 15 passed and one live-credential test
skipped; FastAPI reports 21 passed. The API test run emits existing FastAPI/Starlette
deprecation warnings. Android Gradle compilation was not run because this machine has
no configured JDK/Android SDK.

## 1. Existing architecture discovered

The supplied checkout contained a React/TypeScript POS with two state-selected screens:
POS and Sales History. Its browser database was IndexedDB (`food-vendor-os-pos`, schema 1),
with atomic order snapshots and outbox inserts. The printer was a browser console mock.
The API was Python/FastAPI + SQLAlchemy, with PostgreSQL as the production target,
SQLite for development, and Alembic configuration. Sync uses UUID event IDs and
backend terminal/business/location ownership validation. Capacitor and native SQLite/
Bluetooth were architectural targets, not implemented integrations.

No operational Dashboard, Orders, Kitchen, Inventory, Purchases, Expenses, Customers,
Shifts, Reports, Staff, Devices, Settings or Audit screens existed. The corresponding
backend workflows were also absent. They remain in Version 1 scope and now have route
boundaries explicitly marked planned. The migration does not claim to implement them.

All requested engineering documents and the five `.agents/skills/**/SKILL.md` files
were read. No `.git` directory existed in this checkout. A rollback archive of the
original source and static build was saved at `../migration-backups/before-next-migration.zip`.
Financial databases were neither archived into that package nor modified by the migration.

## 2. Files migrated

| Previous location | Current location / change |
| --- | --- |
| `apps/pos/src/App.tsx` | `components/pos/{PosProvider,PosScreen,SalesScreen,ReceiptDialog}.tsx`, `components/layout/{Header,Notice,WorkspaceNav}.tsx` |
| `apps/pos/src/styles.css` | `app/globals.css`; original styles retained, Tailwind theme/utilities added without a resetting stylesheet |
| `src/main.tsx` and `index.html` | Server `app/layout.tsx`, metadata, route pages and client offline registration |
| `src/lib/db.ts` | Same schema/stores, lazy browser-only initialization for prerender compatibility |
| `src/services/{checkout,sync,printer}.ts` | Checkout/printer behavior retained; configurable terminal/API, app version 1.0.0, matching idempotency header |
| `src/services/checkout.test.ts` | Same storage/sync assertions moved from Vitest to Node test runner + tsx |
| `scripts/build-sw.mjs` | Precaches the complete Next.js export, including route navigation payloads |
| `package.json`, lockfile, `tsconfig.json`, `.env.example` | Next.js scripts, dependencies, types and `NEXT_PUBLIC_*` configuration |
| Playwright config and browser tests | Actual routes, offline navigation, retained state and legacy data coverage |
| Python API version/CORS/routes/tests | App release 1.0.0; configurable origins; optional matching Idempotency-Key, older clients retained |
| CI and engineering docs | Next.js validation, artifact export, Version 1 scope and rollback instructions |

## 3. Files removed

- `apps/pos/src/App.tsx` (split into existing-functionality components).
- `apps/pos/src/main.tsx`.
- `apps/pos/src/vite-env.d.ts`.
- `apps/pos/src/styles.css` (moved, styles preserved).
- `apps/pos/index.html`.
- Obsolete generated `apps/pos/dist/` build.
- Direct and transitive Vite/Vitest/plugin dependency tree and old scripts.

There was no `vite.config.*` file to remove. No business module, financial record,
Python service, database migration, or printer interface was deleted.

## 4. Files created

- `app/layout.tsx`, `app/globals.css`, and the 15 `app/**/page.tsx` route files.
- `components/layout/{Header,Sidebar,WorkspaceNav,Notice,ModuleBoundary,OfflineRegistration}.tsx`.
- `components/pos/{PosProvider,PosScreen,SalesScreen,ReceiptDialog}.tsx` and `display.ts`.
- `hooks/useConnectivity.ts`.
- `src/lib/{config,version,modules}.ts`.
- `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`.
- `apps/pos/AGENTS.md` and `CLAUDE.md`, generated by Next.js development tooling; root engineering guardrails are preserved.
- `scripts/serve.mjs` (static asset preview only; not a business API).
- `public/manifest.webmanifest`.
- This report. Next generates `next-env.d.ts`, `.next/` and `out/` as build artifacts.

## 5. Modules preserved

Operational code preserved: POS and Sales, including search, quantities, prices,
Cash/MoMo/Card selection, explicit checkout, double-click protection, local persistence,
sync retry, pending filters, saved receipts, and demo reprinting. The shared provider
retains an unfinished cart and payment selection across route navigation.

All other named modules retain Version 1 scope and explicit planned pages. The supplied
category sidebar remains intact; a compact `next/link` module drawer provides the required
route access without replacing the cashier layout with a new product design.

## 6. Next.js routes

| Route | Module | Supplied implementation preserved |
| --- | --- | --- |
| `/` | Dashboard | Planned; no existing dashboard code |
| `/pos` | POS | Yes |
| `/orders` | Orders | Planned |
| `/kitchen` | Kitchen | Planned |
| `/sales` | Sales | Yes |
| `/inventory` | Inventory | Planned |
| `/purchases` | Purchases | Planned |
| `/expenses` | Expenses | Planned |
| `/customers` | Customers | Planned |
| `/shifts` | Shifts | Planned |
| `/reports` | Reports | Planned |
| `/staff` | Staff & Roles | Planned |
| `/devices` | Devices & Printers | Planned |
| `/settings` | Settings | Planned |
| `/audit` | Audit Log | Planned |

Static export uses trailing slashes. Route pages and the root layout are Server Components;
only interactive/browser state is in Client Components. No Next.js API routes or
server-dependent checkout path were introduced.

## 7. Frontend validation at initial migration

- `npm install`: completed at migration time.
- `npm run lint`: passes with zero warnings.
- `npm test`: five storage/sync tests pass.
- `npm run build`: Next.js 16.3.6 production export succeeds for all 15 module routes.
- `npm run test:e2e`: four browser scenarios pass, including widths 320–1440px,
  checkout, payment selection, no-reload navigation, retained cart, offline reload,
  offline route navigation, legacy schema-1 order/outbox data and printer failure.

Browser sync responses are mocked in these tests; Python tests exercise the real API.
The TypeScript/ESLint versions are pinned to versions compatible with Next's lint plugins.

## 8. Python validation at initial migration

`python -m pytest -q`: six tests pass. Coverage includes duplicate-event uniqueness,
tenant/location ownership rejection, unsupported protocols, Version 1 header retries,
and header mismatch rejection. The original 0.1.0 client fixture and compatibility
minimum remain intentionally to exercise older protocol-1 clients. Existing deprecation
warnings in FastAPI/Starlette remain; there are no failing tests.

## 9. Mocked or incomplete functionality

- Browser/system printing opens a print dialog but cannot confirm paper output.
- Browser persistence is IndexedDB; Capacitor uses the native SQLite adapter. Native
  SQLite has unit coverage against a transaction fake, but has not been built or run on
  an Android device in this environment.
- Demo menu and default tenant/terminal remain; public build configuration can select
  another provisioned identity but is not authentication.
- Payment buttons record already-received money, not gateway charges.
- Operational modules, staff authorization, refund/void requests, order types, Hold/Resume,
  separate payment/audit persistence and real device settings were absent before migration.
- Feature-flag keys are retained as configuration concepts, not completed capabilities.

## 10. Native Android work required

Build and run the generated Capacitor project on a configured Android toolchain. Validate
offline sale, persistence across process restart, concurrent transaction handling, import,
sync and safe app upgrades/rollback on the target tablets. Implement pairing/test/receipt
ESC/POS adapters for the actual printer models through `PrinterService`; provision and
authenticate terminals and configure HTTPS API/origins. No native Bluetooth adapter is
claimed by this work.

## 11. Risks and rollback

- This migration preserves a partial product, not a complete restaurant-ready implementation.
  Backend authentication is still missing; ownership checks alone are not identity verification.
- Keep the same browser origin. Moving scheme/host/port creates a separate IndexedDB namespace.
- Existing cached installs require all old tabs to close before activating the new worker.
  Do not clear site data: it may contain unsynced sales. Updates do not force reloads mid-sale.
- `NEXT_PUBLIC_*` values are compiled into the export; rebuild for deployment changes.
  Runtime client code defaults to same-origin `/api/v1`; only local examples/scripts/tests
  intentionally refer to localhost. Static hosts must serve every exported route/payload.
- Browser schema 1, sync protocol 1 and `/api/v1` remain unchanged. Native SQLite
  creates local JSON-record tables and never deletes the IndexedDB source; transfer
  imports add records atomically. Rollback restores application assets only.
- ESLint 9 is retained because Next's bundled React plugin failed with ESLint 10;
  its package deprecation should be revisited when the plugin supports the newer API.
- Native hardware and full prior-artifact upgrade/rollback have not been certified by
  browser tests. The legacy-storage test covers persisted schema compatibility only.

Framework references used: [Next.js static export](https://nextjs.org/docs/app/guides/static-exports),
[official migration guide](https://nextjs.org/docs/app/guides/migrating/from-vite),
[Tailwind for Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs).
