# Pilot environment — cloud database runbook

Operator guide for the TEST/PILOT environment (Adonai Pork — Dansoman).
Tester instructions: [PILOT_TESTING.md](PILOT_TESTING.md).

## Architecture

```
POS (Next.js static export / Capacitor Android)
  │  local transaction: order + payment + stock movement + shift + audit + outbox
  │  └─ IndexedDB (browser) or SQLite (Android)  ← sells with no internet
  │
  ├── sign-in only ──────────────► Supabase Auth (publishable key)
  │
  └── HTTPS + Bearer JWT ─────────► FastAPI  (auth check, tenant scope, RBAC,
                                      │       business rules, idempotent sync)
                                      ▼
                               SQLAlchemy ──► Supabase PostgreSQL (pilot)
                                         └──► SQLite (local API development)
```

- The browser never receives database credentials or the service-role key.
- Supabase's auto-generated REST API **cannot** read or write API tables:
  migration `0005_supabase_lockdown` enables RLS (no policies) on every table and
  revokes `anon`/`authenticated` grants, including for future tables.
  FastAPI connects as the table owner and is unaffected.
- Tenant context (business, location, terminal, role, permissions) comes from the
  verified JWT subject → `users` row. IDs sent by the client are only checked
  against it, never trusted.

## Environments

| | LOCAL | TEST / PILOT | PRODUCTION |
|---|---|---|---|
| `ENVIRONMENT` | `development` | `pilot` | `production` |
| API env source | `.env`, `.env.local` | `MAKNAM_ENV_FILE=.env.pilot` or host secrets | host secrets only |
| Database | SQLite `maknam_local.db` | Supabase pilot project | separate Supabase project |
| Frontend `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` | `https://<pilot-api>/api/v1` | `https://<prod-api>/api/v1` |

Guards in `app/core/config.py`:

- `development` refuses any Supabase `DATABASE_URL`, so a dev shell cannot touch the cloud.
- `pilot` and `production` refuse SQLite and `CORS_ORIGINS=*`.
- `create_all()` runs only for local SQLite; cloud schema changes use Alembic only.

## Connection settings

- **Use the Supavisor session pooler (IPv4), port 5432:**
  `postgresql+psycopg://postgres.<ref>:<url-encoded-password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`.
  The direct host `db.<ref>.supabase.co` is IPv6-only and is unreachable from
  IPv4-only networks and many hosting providers.
- URL-encode special characters in the password (`@` → `%40`).
- `postgres://` and `postgresql://` URLs are normalized to psycopg 3.
- TLS is `sslmode=require` for any non-local host. Pool settings: `pool_pre_ping`,
  size 5 + overflow 5, recycle 30 min, connect timeout 10 s (tunable via
  `DB_*` variables). If you use the transaction pooler (port 6543), prepared
  statements are disabled automatically.

## Commands (PowerShell, from `services/api`)

```powershell
$env:MAKNAM_ENV_FILE = '.env.pilot'
.\.venv312\Scripts\python.exe -m alembic upgrade head      # schema (non-destructive)
.\.venv312\Scripts\python.exe -m app.seed_pilot            # idempotent tenant/catalog/logins
.\.venv312\Scripts\python.exe scripts\verify_pilot.py      # read-only report, exit 1 on failure
.\.venv312\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Remove-Item Env:MAKNAM_ENV_FILE                            # back to local SQLite
```

Health checks: `GET /health` (API up) and `GET /health/db` (database connected,
HTTP 503 if not). Neither returns hosts, users or error text.

### Pilot logins

Login identities live in Supabase Auth. `seed_pilot` creates them with the
**server-only** `SUPABASE_SERVICE_ROLE_KEY` set in `.env.pilot`
(Supabase dashboard → Project Settings → API keys → secret/service_role).

- Passwords come from `PILOT_ADMIN_PASSWORD` / `PILOT_CASHIER_PASSWORD`, or are
  generated. Either way they are printed **once** in the seed output. Send them
  to testers privately; never put them in Git or in `PILOT_TESTING.md`.
- Re-running never rotates passwords. Use `--reset-passwords` to rotate.
- If the emails were already created by hand in Supabase Auth, add
  `--adopt-existing-auth-users` to link them.
- Without the key, the seed still creates the tenant, catalog, stock and the two
  user records. A later run with the key links them.

### Seeded data

Business **Adonai Pork**, location **Dansoman**, terminal **AD-01** (stable
UUIDv5 IDs). Settings: GHS, Africa/Accra, Cash and MoMo enabled, receipt footer
"PILOT TEST RECEIPT". Categories Pork/Yam/Drinks. Pork + Yam and Fried Yam with
Small/Medium/Large variations. Coke, Malt and Water stock-tracked with an opening
stock of 48. No demo sales are created: the tenant starts clean.

Roles: Admin → Owner template (full access). Cashier → POS, own sales,
orders and customers view, open and close own shift, receipt reprint. Cashiers
have no team, roles, business settings, audit, refund/void or stock-adjust
access. All of this is enforced by FastAPI.

## Deploying for remote testers

**The chosen host is Vercel. Follow [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).** The generic
notes below apply to other hosts.

The API and the frontend must be reachable over HTTPS from the testers' networks.

1. **API host**: any container host (Render, Railway, Fly.io, Cloud Run, etc.) can
   build `services/api/Dockerfile`. Use root directory `services/api`.
   - Set these as secrets: `ENVIRONMENT=pilot`, the pooler `DATABASE_URL`,
     `SUPABASE_URL`, and `CORS_ORIGINS=https://<pilot-frontend>`.
   - Release/pre-deploy command: `alembic upgrade head`.
   - The container listens on `$PORT` and trusts the host's proxy headers.
   - Health check path: `/health/db`.
   - Do not set the service-role key on the API host; it is only needed for seeding.
2. **Frontend**: any static HTTPS host (Netlify, Cloudflare Pages, Vercel static, S3+CDN):
   - Base directory `apps/pos`, build command `npm ci && npm run build`, publish directory `out`.
   - Build environment: `MAKNAM_DEPLOY=pilot`, `NEXT_PUBLIC_API_URL=https://<pilot-api>/api/v1`,
     `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
     `MAKNAM_DEPLOY` makes the build fail on a localhost, `http://` or secret-key configuration.
   - `public/_headers` (Netlify/Cloudflare format) serves `sw.js` and the manifest
     uncached. On other hosts, set `Cache-Control: no-cache` for `/sw.js`.
   - HTTPS is required for the service worker and installation.
3. In Supabase Auth → URL configuration, add the pilot frontend URL.
4. Check: `curl https://<pilot-api>/health/db`, then run `verify_pilot.py`, then the
   smoke test in `PILOT_TESTING.md`.

## Offline and sync guarantees (verified by tests)

- The checkout commits order, payment, stock movement, audit and outbox entries in
  one local transaction, with no network needed (`checkout.test.ts`,
  `menu-stock.test.ts`, `sqlite-storage.test.ts`).
- A failed or offline sync keeps every local record; retries resend the same
  event ID and `Idempotency-Key`.
- The server stores the sale, its sync marker and its stock movements atomically.
  A replay returns `already_processed` with no duplicate order, payment, stock
  movement or audit entry (`test_pilot.py`, `test_sync.py`, `test_menu_stock.py`).
- Full stack (real FastAPI, real signed JWTs, real PWA): `e2e/fullstack.spec.ts` checks
  an offline sale, an offline restart, reconnecting with a lost acknowledgement, and
  exactly one server sale, payment and stock deduction. Run it with:

  ```powershell
  # terminal 1 (services/api) — isolated SQLite + local JWKS, never the pilot DB
  .\.venv312\Scripts\python.exe scripts\e2e_server.py $env:TEMP\maknam-e2e 8020
  # terminal 2 (apps/pos), after npm run build
  $env:FULLSTACK_TOKENS="$env:TEMP\maknam-e2e\tokens.json"; npx playwright test e2e/fullstack.spec.ts
  ```

  Restart the e2e server before each run; it starts with a fresh database.

## Never run against the cloud database

`DROP DATABASE`, `DROP SCHEMA ... CASCADE`, `alembic downgrade` (migrations refuse
it), `Base.metadata.drop_all/create_all`, or the test suite with
`MAKNAM_ENV_FILE` set (tests force in-memory SQLite, but don't rely on that).
