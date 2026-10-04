# Food Vendor OS Version 1

Application release **1.0.0**. Offline-first restaurant operating system for Ghanaian
food vendors. Adonai Pork is the demo tenant; Chics & Chips remains a planned tenant.

## Architecture
- Frontend: Next.js App Router + React + TypeScript + Tailwind, in the existing `apps/pos`.
- Backend: Python + FastAPI under `/api/v1`; no Next.js business API replacement.
- Cloud: PostgreSQL + SQLAlchemy + Alembic; SQLite development fallback.
- Device foundation: Capacitor Android project, native SQLite adapter and offline local
  transactions. Native printing adapters still require target-device validation.
- Browser development: existing IndexedDB order/outbox storage and system print dialog.
- Versions: app 1.0.0, API v1, local schema 1, sync protocol 1.

## Version 1 product scope
Dashboard, POS, Orders, Kitchen, Sales, Inventory, Purchases, Expenses, Customers,
Shifts, Reports, Staff & Roles, Devices & Printers, Settings, and Audit Log.

The supplied repository implemented POS and Sales only. Both retain the existing UI,
product prices, cart/quantity/search, Cash/MoMo/Card selection, explicit checkout,
sales filters, stored receipts, receipt reprinting, durable outbox and retry-safe sync.
Cashier checkout now opens the committed receipt immediately; it does not navigate to
Sales. Devices & Printers exposes scoped printer profiles and safe local-data transfer.
The remaining modules retain Version 1 routes and clearly show planned status. They
were not removed or falsely presented as operational during this framework migration.
See `MIGRATION.md` for the complete inventory and limits.

## Backend quick start
Use Python 3.12 with the existing pinned dependencies:
```bash
cd services/api
python -m venv .venv
# Activate .venv using your shell
pip install -r requirements.txt
cp .env.example .env
python -m app.seed_demo
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Demo setup is repeatable and only accepts a development SQLite database.
On this Windows checkout, `.venv312` is already available:
```powershell
cd services/api
.\.venv312\Scripts\python.exe -m pytest -q
.\.venv312\Scripts\python.exe -m app.seed_demo
.\.venv312\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Frontend quick start
Use Node.js 22 or newer:
```bash
cd apps/pos
npm install
cp .env.example .env.local
npm run lint
npm test
npm run build
npm run dev
```
On Windows use `npm.cmd` and `Copy-Item .env.example .env.local` when PowerShell script
execution is restricted. Open http://localhost:5173/pos/ for the existing cashier UI,
http://localhost:5173/sales/ for history, or `/` for Dashboard. Use the Modules menu
for all Version 1 routes. `next/link` navigation preserves the in-progress cart.

`NEXT_PUBLIC_API_URL` is a build-time configuration value. The example points to the local
FastAPI service; production/native exports need the appropriate HTTPS API URL. If omitted,
`/api/v1` assumes the hosting layer proxies that path to FastAPI. CORS allowed origins are
configured in the Python service through `CORS_ORIGINS` (JSON array). Public tenant/terminal
settings in `.env.example` are identifiers, never authentication credentials.

Sign-in and password recovery use Supabase Auth. Configure the two public Supabase
environment values in `apps/pos/.env.local`, configure `SUPABASE_URL` for FastAPI, and
apply the Alembic migration before rollout. Local users must be explicitly mapped to
Supabase Auth UUIDs; see [SUPABASE_AUTH.md](./SUPABASE_AUTH.md).

For controlled beta testing, seed the isolated fictional demo tenant after applying
migrations: from `services/api`, run `python -m alembic upgrade head` then
`python -m app.seed_demo_accounts` with server-side `SUPABASE_SERVICE_ROLE_KEY` and
`DEMO_SEED_ENABLED=true` supplied only through a secret manager/local environment. The
seed prints newly generated passwords once; store them securely. Setup, PostgreSQL
release steps, resets, and limitations are in [SUPABASE_AUTH.md](./SUPABASE_AUTH.md).

## Offline production preview
```bash
npm run build
npm run preview
```
Open http://localhost:5174/pos/ online once and let the offline worker finish installing.
The `out/` export contains every route plus JavaScript/CSS/navigation payloads. It can
then reopen offline. New releases activate after open POS tabs close, never mid-sale.
The development server does not install an offline worker. Preview and development
ports have separate browser storage; keep the original origin to preserve existing data.
Use Devices & Printers to export a tenant/location-scoped JSON copy before moving local
browser data to an Android WebView. Import adds records atomically and does not delete
the source or overwrite a conflicting sale/event.
For another preview address, set `HOST` and `PORT` environment variables.

Add products, select a payment method, confirm payment was received, and click **Complete
sale**. The saved receipt appears immediately; it can be printed again or closed to start
a fresh order. Check Sales for Synced. Stop the API, complete another sale and reload: it
should remain Pending. Restart the API and click Sync now. Reprinting must not create a
new sale.
Cash/MoMo/Card record received payments; they do not charge customers through a gateway.

## Validation
```bash
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```
Run `python -m pytest` in `services/api`. See `TESTING.md` for coverage and remaining
hardware/security release gates. CI checks both stacks and archives the static export.

## Production rule
Never point development or migration experiments at the restaurant production database.
Read `AGENTS.md`, `ARCHITECTURE.md`, `OFFLINE_SYNC.md`, `DATABASE.md`, and `RELEASES.md`.
The native SQLite adapter and Capacitor Android project are in place, and browser-origin
data can be transferred explicitly without deleting the source. Android compilation,
real Bluetooth/USB/network printer adapters, hardware validation, and complete
authenticated device provisioning remain release gates. The terminal ownership check
is not authentication; keep the demo API bound to localhost.
