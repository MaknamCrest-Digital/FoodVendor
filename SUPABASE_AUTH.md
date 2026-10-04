# Supabase Auth setup

Maknam POS uses Supabase Auth for sign-in and password recovery. FastAPI remains
the authoritative business API and verifies Supabase access-token signatures
against the project's public JWKS endpoint before resolving a local user.

## Configuration

The static Next.js/Capacitor client requires these build-time public values in
`apps/pos/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

The API needs the project URL to discover its signing keys. Set
`SUPABASE_URL=https://your-project.supabase.co` in `services/api/.env.local` or
the server environment. Do not configure the Supabase service-role key or JWT
signing secret in the POS client. FastAPI expects the `authenticated` token
audience; override `SUPABASE_JWT_AUDIENCE` only if the project is deliberately
configured with a different audience.

The app is a static export for browser and Capacitor use. Supabase sessions are
persisted/refreshed by the browser SDK; Next server components and middleware
are not used for refresh. Recovery links must allowlist the app's
`/update-password/` URL in Supabase Auth redirect settings.

## Provisioning and identity mapping

User records in the Maknam database are local authorization records. A verified
Supabase `sub` UUID must be explicitly mapped to the corresponding local user
record through the unique nullable `users.supabase_user_id` field. FastAPI
never links accounts using an email address and never trusts a client-supplied
business or location ID.

For a new user:

1. Create/invite the user in Supabase Authentication and complete any required
   email confirmation.
2. Copy that user's Auth UUID.
3. In Maknam POS Team & Access, create the local user using the same display
   email, paste the Supabase Auth UUID, and assign its tenant-scoped role.
4. Confirm the user can sign in and receives only the local record's business,
   location, and permissions.

For an existing local user, edit the user in Team & Access and paste the
explicit Supabase Auth UUID. Do not infer or automatically match it from email.
The first tenant owner can be created by running the API command with the
existing Supabase UUID:

```powershell
cd services/api
.\.venv312\Scripts\python.exe -m app.create_admin `
  --email owner@example.com `
  --name "Restaurant Owner" `
  --business-id <business-uuid> `
  --location-id <location-uuid> `
  --supabase-user-id <supabase-auth-uuid>
```

Existing local password hashes and opaque login-session rows are retained by
the additive database migration for data compatibility, but are no longer an
authentication mechanism. An unmapped account fails closed until provisioned.
Disabled local users are rejected even if their Supabase identity is valid.

## Database migration

Back up the database, then apply the Alembic migration before deploying the API:

```powershell
cd services/api
.\.venv312\Scripts\python.exe -m alembic upgrade head
```

The forward-only Alembic chain now also contains a guarded `0000_foundation`
revision for the six core business/order/sync tables that the previous auth
revisions referenced but did not create on a fresh database. It creates only
missing tables/indexes; existing core tables are left untouched. The existing
admin/access revisions follow it, and `0003_supabase_auth` adds the optional
unique subject mapping and makes the legacy password hash nullable;
`0004_canonical_indexes` adds tenant, user and event indexes missing from the
prior migration chain. The
identity migration tolerates the current development `create_all` schema. No
users are deleted or automatically linked. Restrict management of Supabase Auth users and tenant role assignments
to trusted administrators.


## Isolated beta demo accounts

The explicit demo seed command creates (or verifies) a separate tenant named
**Maknam POS Demo (Fictional)** with its own location and terminal, two Supabase
Auth users, local RBAC users, and a small fictional menu. The reserved login
addresses use the non-routable `demo.maknam.invalid` domain; testers can enter
`demo-admin` or `demo-cashier` in the existing username/email field. Passwords
are random, unique per user, and are never included in the client bundle. Demo
users have no access to Adonai Pork or any other tenant. Cashier permissions
come from the existing `CASHIER` role template, enforced by FastAPI.

Demo seeding is off by default. For a deliberate local seed or controlled
release operation, configure these variables in the API process/secret manager:

- `DATABASE_URL`: the intended SQLite or PostgreSQL database. PostgreSQL URLs
  must use the project's SQLAlchemy driver form, for example
  `postgresql+psycopg://...`; keep its credentials in the deployment secret store.
- `SUPABASE_URL`: the same Supabase project configured in the POS.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase admin credential. Never set
  it in `apps/pos`, a `NEXT_PUBLIC_*` variable, or a checked-in file.
- `DEMO_SEED_ENABLED=true`: explicit one-command opt-in. Leave false/unset
  during ordinary API startup.

After setting those values, from `services/api` run the migration and seed as
separate controlled commands (PowerShell):

```powershell
.\.venv312\Scripts\python.exe -m alembic upgrade head
.\.venv312\Scripts\python.exe -m app.seed_demo_accounts
```

For a new production deployment, provision the hosting platform's PostgreSQL
`DATABASE_URL`, `SUPABASE_URL`, and service-role key through its secret manager
first. Run `alembic upgrade head` as a release step against that same database;
set `DEMO_SEED_ENABLED=true` only for the one-off seed process, then unset it.
Run the API with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. For Docker
Compose, pass the service-role key only to the one-off seeder process (for
example, `docker compose exec -e SUPABASE_SERVICE_ROLE_KEY -e DEMO_SEED_ENABLED api
python -m app.seed_demo_accounts` after exporting the two variables in the
operator shell); it is intentionally not part of the long-lived API service
environment. The same commands work against SQLite; they do not replace the
configured database or create schema implicitly. Never run the seed against a restaurant tenant's
production data unless the separately named fictional tenant is intended there.

The seed is idempotent: a normal rerun does not make duplicate users, change
existing passwords, reactivate a deliberately disabled local demo account, or
overwrite existing catalog records. On first creation it prints the generated
credentials to the command's standard output once. Capture that output only in
a secure terminal, transfer it to the test organizer's password manager, and
do not paste it into chat, CI logs, tickets, Git, or screenshots. The API does
not provide a password retrieval endpoint. If credentials are lost, an operator
can explicitly rotate them from Supabase Auth administration or run
`python -m app.seed_demo_accounts --reset-passwords` with the same protected
environment; that command changes both demo passwords and prints the new ones
once. The `--reset-passwords` option is deliberately separate from normal seed.

The public demo-login hint is gated by the static build-time
`NEXT_PUBLIC_DEMO_ACCOUNTS_ENABLED=true` flag in `apps/pos/.env.local`; rebuild
the static app when changing it. It reveals usernames only, never passwords.
Do not enable the hint unless the isolated demo users have been seeded and the
shared-password distribution is controlled. No reset link is available for the
`.invalid` demo email addresses; reset/rotation is operator-managed.

## Beta safety and offline limits

The demo accounts share one Admin identity and one Cashier identity across
testers, so audit attribution is by shared role account, not person. Demo sales
are real stored transactions within the demo tenant and must be treated as
fictional test records; no payment gateway is connected. Do not add customer
PII, live payment details, or real restaurant data to this tenant. Resetting
demo users/passwords does not erase tenant data. Data deletion/reset requires
a separately reviewed, explicit database operation and is intentionally not
part of seeding.

First-time Supabase login requires connectivity. A device that has already
authenticated can reopen its cached local profile/session and continue the
existing local SQLite/IndexedDB POS workflow offline; sales remain in the
existing durable outbox and sync when connectivity returns. An offline user
may not be able to refresh an expired Supabase token or revalidate server-side
permissions; keep the device's current authenticated session, use one assigned
terminal per cashier during beta, and reconnect before permissions/account
changes. The current local cached profile lifetime is limited, and this is not
a substitute for multi-device offline revocation or conflict testing.

Before inviting external testers, validate the selected cloud database's
PostgreSQL migrations, seed once against that database, verify both sign-ins,
check the cashier/admin role boundaries, and confirm the public static build
contains only the Supabase URL/publishable key (never database/service-role
secrets). The real hosted Supabase Auth create/login and the deployed Postgres
seed must be exercised with deployment credentials; local tests mock the Supabase
Admin API and must not be represented as a live cloud provisioning test.
