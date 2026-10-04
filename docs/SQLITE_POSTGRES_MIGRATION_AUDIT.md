# SQLite / PostgreSQL migration audit

> **Update, 4 October 2026:** the Supabase pilot database is migrated to `0005_supabase_lockdown` and seeded.
> See [PILOT_ENVIRONMENT.md](PILOT_ENVIRONMENT.md) for current status. The blockers below are historical.

## Scope and audit result

This audit inspected the checked-out Maknam POS application, the configured API
SQLite files without reading or printing record contents, the SQLAlchemy models,
Alembic history, and the API/local POS synchronization code. The effective API
configuration is SQLite (`maknam_local.db`). Supabase Auth is configured, but a
PostgreSQL `DATABASE_URL` and Supabase service-role key are not configured. The
Supabase project URL is an Auth/JWKS endpoint, not a database connection string.
No remote PostgreSQL schema or data could therefore be inspected or changed.

| SQLite file | Alembic revision | Row counts observed (counts only) | Finding |
| --- | --- | --- | --- |
| `services/api/maknam_local.db` | `0002_settings_access` | 2 users, 1 business, 1 location, 1 terminal, 7 orders, 0 menu items, 59 admin events, 57 admin records, 7 sync events, 5 roles, 63 permissions, 158 role-permission links, 2 user-role links, 0 user-permission overrides, 3 settings, 9 security-audit events, 10 login sessions | Effective `.env` database. Missing the new Supabase subject column and newest index migration. |
| `services/api/food_vendor_os.db` | Untracked | 1 user, 1 order, 1 login session; no RBAC tables | Separate legacy/development database. Do not merge it automatically. |
| `services/api/test_food_vendor.db` | Untracked | No users or orders | Test/fixture database, not a migration source. |

Counts are an audit-time snapshot and are not a substitute for a fresh preflight.
No user names, emails, password hashes, JWTs or sale contents were emitted. No
live data was migrated, reset or altered during this audit. Existing Supabase
user mappings in the source were not reported or assumed.

## Architecture and what is already implemented

- The POS uses browser IndexedDB or Capacitor SQLite locally. Its version-1
  local journal stores durable local orders and an outbox; checkout commits
  before printing and sales continue offline.
- The POS sends retryable, UUID-keyed sales and admin journal operations to
  FastAPI when online. FastAPI owns tenant-scoped authorization and writes to
  its configured SQLAlchemy database. Stock writes are checked/serialized on
  the server; duplicate sync requests are idempotent, and conflicting catalog
  revisions are rejected instead of overwriting newer server data.
- The API cloud relational schema is defined by SQLAlchemy models and Alembic.
  It contains 17 modeled tables. POS orders/payments/items are represented by
  the order payload and local receipt snapshot rather than identical local and
  remote table layouts; mutable catalog and settings state uses the admin
  operation journal. The two databases are logically connected by the sync
  protocol, not by a shared live SQLAlchemy connection.
- JWT verification, explicit Supabase subject-to-local-user mapping, tenant
  checks and Admin/Cashier server-side permission enforcement already exist.
  Demo users are provisioned by a separate, opt-in seeder into a fictional
  tenant; it does not reset business data.
- Money is stored as integer minor units, identifiers are stable strings/UUIDs,
  and the sync protocol has idempotency and revision checks. Alembic migrations
  can now build a fresh schema; the new full migration chain was tested on an
  isolated SQLite database.

## Gaps found and addressed in code

1. **Current API SQLite is behind code:** active local DB is at revision 0002;
   current model adds a nullable unique `supabase_user_id`. The migration command
   `0003_supabase_auth` supports the prior SQLite shape without deleting users.
2. **Fresh cloud schema omitted foundational tables:** older auth revisions
   referenced `businesses`/`locations` but there was no initial migration for
   all core API tables. Added guarded `0000_foundation`; it creates missing
   tables only.
3. **Alembic indexes did not fully match ORM metadata:** parity testing found
   missing tenant/user/event indexes in `users`, `login_sessions`,
   `admin_events` and `admin_records`. Added `0004_canonical_indexes`.
4. **No safe API-SQLite-to-PostgreSQL import utility existed:** added a
   read-only-by-default, backup-before-write migration command. It requires the
   target to be at Alembic head and explicit target-database confirmation;
   checks table/column/type/PK/FK/unique/index compatibility; preserves IDs;
   inserts in FK dependency order; skips ephemeral legacy login sessions and does not copy obsolete local password hashes; 
   counts existing identical records as already migrated; and rolls back on
   conflicting IDs, unique keys or foreign keys. Source SQLite timestamps are
   interpreted as UTC and inserted as UTC-aware PostgreSQL timestamps.
5. **Device SQLite is not a second API database:** local device orders/outbox
   are not included in the API database import. They must be synchronized via
   the supported POS sync flow after the FastAPI PostgreSQL service is deployed.
   This prevents copying device implementation tables into an unrelated cloud
   schema or bypassing stock/idempotency rules.

The canonical check compares the API model tables, columns, keys, constraints
and indexes; a freshly Alembic-migrated SQLite schema passes it. An isolated
backup copy of the active database also upgraded from revision 0002 to 0004,
retained all 7 orders, and passed canonical parity. The original database stayed
at 0002 with the same 7 orders. The active
`maknam_local.db` also passes the compatible-source check. Its older Alembic
revision leaves the nullable `supabase_user_id` mapping column absent; the
importer supplies `NULL` for that optional field. A read-only transfer test copied
the active data into an in-memory isolated target: 385 source rows were assessed,
375 inserted, 10 ephemeral login-session rows skipped, and an identical second
pass inserted zero rows. No legacy password hashes were copied. This is **not** a
PostgreSQL or Supabase import test.

## Safe deployment and transfer procedure

Schedule a migration window and stop API writes/synchronization to the source
SQLite database for the apply and cutover; offline devices can queue sales and
sync after the cloud API is live. First take an independent protected backup and
confirm the PostgreSQL project, connection and database name in the hosting secret manager. Never put the
connection URL or key in the static POS environment. The API's server-only
`DATABASE_URL` must use the existing SQLAlchemy driver form, e.g.
`postgresql+psycopg://...`; for Supabase use the provider's supported direct or
pooler connection and TLS settings.

Run these commands from the repository root in PowerShell. The API virtual
environment and source SQLite database are under `food-vendor-os\services\api`,
not in the starter directory itself:

```powershell
Set-Location "$HOME\Documents\New folder\food-vendor-os-starter\food-vendor-os\services\api"
Test-Path .\.venv312\Scripts\python.exe
Test-Path .\maknam_local.db
```

Both checks should return `True`. Before continuing, configure the intended
PostgreSQL `DATABASE_URL` in `services/api/.env.local` (or the hosting provider's
server-side secret manager). This API reads `.env` and `.env.local` from its current
working directory. Do not post the URL in chat or put it in the POS frontend.
There is currently no PostgreSQL URL configured in this checkout, so do not run
the migration until the verified target URL has been set.

Apply schema migrations only after verifying the Supabase project and database:

```powershell
& .\.venv312\Scripts\python.exe -m alembic upgrade head
```

Get the database name from the configured server-side URL without displaying
the URL or its credentials. This rejects a SQLite configuration and stores only
the database name in PowerShell:

```powershell
$targetDatabase = (& .\.venv312\Scripts\python.exe -c "from sqlalchemy.engine import make_url; from app.core.config import settings; url = make_url(settings.database_url); assert url.drivername in ('postgresql', 'postgresql+psycopg'), 'DATABASE_URL is not PostgreSQL'; print(url.database)")
$targetDatabase
```

Compare the printed name with the database shown in your provider console. For
example, Supabase projects often use the database name `postgres`; use that only
if the console and configured URL confirm it. Do not use a project display name
or include angle brackets. The following is a dry run (no records are committed):

```powershell
& .\.venv312\Scripts\python.exe -m app.migrate_sqlite_to_postgres `
  --source sqlite:///./maknam_local.db `
  --confirm-target $targetDatabase
```

Review the per-table `source_rows`, `target_rows_before`, `target_rows_after`,
`copied`, `unchanged` and `skipped` report. Stop for manual review if the
source/target schema differs, a unique/foreign-key conflict occurs, the target
is not at Alembic head, or the target database confirmation does not match.
The importer never deletes or overwrites destination records.

Only after reviewing the dry-run and separately verifying the Supabase project
and database in the hosting console, run apply with a **new, secure backup path
outside the repository**. Its parent directory must already exist and be
access-controlled; existing backup files are never overwritten. Replace the
example path below with a real, private backup location (do not type angle
brackets):

```powershell
$backupPath = Join-Path $HOME 'maknam-backups\maknam_local-pre-cloud.db'
& .\.venv312\Scripts\python.exe -m app.migrate_sqlite_to_postgres `
  --source sqlite:///./maknam_local.db `
  --confirm-target $targetDatabase `
  --apply `
  --backup-path $backupPath
```

Create the `maknam-backups` directory yourself before applying, and ensure it is
access-controlled. The command deliberately refuses to overwrite an existing
backup file.
Then independently compare the generated JSON counts and financial totals with
the source/target using approved, non-PII reconciliation queries. The importer
reports row counts but does not claim business-total reconciliation. Do not
switch the production deployment until counts, foreign keys, sale totals,
permissions and an online/offline/reconnect pilot are verified.

To seed the separate beta tenant, set `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `DEMO_SEED_ENABLED=true` only in a protected,
one-off API command environment after migrations. From `services/api`:

```powershell
$env:DEMO_SEED_ENABLED = 'true'
.\.venv312\Scripts\python.exe -m app.seed_demo_accounts
```

The command prints newly generated credentials once. Transfer them directly to
the test coordinator's password manager; they are not recoverable via the POS.
Demo seeding is separate from schema/data migration and does not empty the
fictional tenant on rerun.

## Remaining blockers and beta gates

- A PostgreSQL/Supabase database URL, database name/project verification, and
  protected service-role key were unavailable during this work. No live cloud
  migration, seeding, counts, or Postgres-driver test has run.
- The active local `maknam_local.db` remains at revision 0002; this work did not
  alter it. Back it up, then apply the current Alembic head as a separate,
  controlled local/deployment step before it is used with code expecting the
  Supabase mapping.
- The separate legacy `food_vendor_os.db` is untracked and structurally older;
  it fails the canonical table-set preflight. It must not be selected as a
  migration source without its own reviewed data mapping.
- The app does not expose business tables directly to the browser; FastAPI is
  the authorization boundary. PostgreSQL `DATABASE_URL` should use a restricted
  server role. Supabase PostgREST exposure and RLS grants/policies were not
  verified; do not expose these tables to `anon`/`authenticated` until policies
  have been designed and tested for the server-side tenant context.
- Real-device SQLite extraction is a distinct process. Keep each device's
  outbox intact and reconnect through API sync; do not delete a device database
  until pending count is zero and server acknowledgement/reconciliation is
  verified.
- Cross-terminal live concurrency, real PostgreSQL migrations, Supabase Auth
  account creation, customer-data reconciliation and native Android restart
  behavior require deployment/hardware tests before a multi-device beta.
- Demo accounts are shared per role and provide audit attribution by account,
  not by tester. Use fictional data only; no real payment gateway is connected.

