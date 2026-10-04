# Maknam POS login — Version 1.0.0

The login screen is available at `/login/`. It uses the existing mint/teal design
tokens, a Lucide restaurant mark, labelled inputs, password visibility control,
inline validation, and a guarded submit button. Its CSS module is scoped to the
authentication pages. `/forgot-password/` explains that self-service reset is
planned and directs the user to their account setup contact; it sends no email.
There is no public registration or Google sign-in.

## Local use

- Development: http://localhost:5173/login/
- Built preview: http://localhost:5174/login/
- API: http://localhost:8000/api/v1
- The controlled development account credentials are in `.local-admin.json` at
  the repository root. This file is ignored, is not bundled into the application,
  and must not be committed or used as production credentials.
- Local API `.env` now selects `sqlite:///./maknam_local.db`, a separate development
  database for login testing.

Restart the API from `services/api` with
`.\.venv312\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
Restart the frontend from `apps/pos` with `npm.cmd run dev` or `npm.cmd run preview`.

For controlled onboarding to an existing tenant, run `python -m app.create_admin`
with `--email`, `--name`, `--business-id`, and `--location-id`. Enter the password
at its hidden prompt. Schema and tenant records must already exist; the command
does not replace an existing account or reset its password.

## Session behavior

`src/lib/auth.ts` sends credentials to FastAPI `/api/v1/auth/login` and stores
only the returned opaque token, expiry, and user profile. Passwords are not saved
in browser storage. FastAPI stores a password hash and a hash of each session
token. Successful sign-in opens `/`. Invalid credentials, disabled accounts,
rate limits, server errors, and connection failures display safe messages.

The existing seven-day authenticated session can remain available on a trusted
browser while offline. This is session persistence, not offline password login.
The frontend checks expiry and checks `/auth/me` on load/reconnect; revoked or
disabled sessions are rejected by FastAPI. Online logout revokes the server
session; offline logout clears only this browser's session. Local sales are
retained through logout. Production deployment must use HTTPS and a reviewed
device/session storage policy.

Admin is the only operational user model. No permission engine or role-based
module filtering has been added. The larger Admin module implementation remains
unfinished; the latest login-only request paused that work.

## Validation

From `apps/pos`: `npm.cmd run lint`, `npm.cmd run build`.

`npm.cmd run test:e2e -- e2e/login.spec.ts` checks responsive layout, keyboard and
visibility controls, validation, safe errors, password help, and duplicate
submission protection. Set `E2E_LOGIN_EMAIL` and `E2E_LOGIN_PASSWORD` to enable
its real FastAPI sign-in/reload/logout check. The live check passed locally.

From `services/api`: `.\.venv312\Scripts\python.exe -m pytest -q` checks real
session creation, revocation, expiry, disabled accounts, rate limits, and
authenticated tenant-scoped sale sync. All test databases are now in memory.

## Development data incident — 28 September 2026

During this work, a test import-order mistake caused an earlier API test run to
reset `services/api/food_vendor_os.db`. No database backup was found in the
workspace, so its previous contents have not been restored. Browser IndexedDB
sales were not touched. Keep the original browser origin and site storage intact
for recovery; the development and preview origins have separate storage.

The test setup now sets an in-memory database before importing application code
and overrides the database session per test. A subsequent full API test run was
verified against the development database's SHA-256 hash: it did not change.
The application now uses the separate `maknam_local.db` development database.
