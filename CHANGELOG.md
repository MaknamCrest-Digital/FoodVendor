# Changelog

## 1.0.0 - Version 1 development
- Connected the TEST/PILOT environment to Supabase PostgreSQL through the IPv4 session pooler, with TLS, pooling and pre-ping. Development refuses cloud URLs; `MAKNAM_ENV_FILE=.env.pilot` selects the pilot environment.
- Added migration `0005_supabase_lockdown` (RLS on, no `anon`/`authenticated` grants), `/health` and `/health/db`, the idempotent `app.seed_pilot` (Adonai Pork — Dansoman), `scripts/verify_pilot.py` and pilot/config tests. Cashiers can now view orders and customers.
- Applied the mint/teal Tailwind brand theme, reusable UI primitives, consistent sales-table styling, touch targets and semantic system statuses without changing workflows.
- Migrated POS frontend from Vite to Next.js App Router with React, TypeScript and Tailwind.
- Preserved existing Version 1 POS/Sales modules and all 15 intended module routes; unimplemented modules are explicitly marked planned.
- Preserved Python FastAPI backend and `/api/v1`.
- Preserved offline-first architecture and the existing local database schema/data.
- Preserved Bluetooth printer abstraction (browser mock remains).
- Preserved multi-tenant identifiers and backend ownership validation.
- Preserved safe sync and rollback architecture; optional matching Idempotency-Key header retains protocol-1 compatibility.
- Added prerender-safe storage, route-aware offline export caching, lint and migration browser checks.

### Foundation carried forward
- Responsive forest-green POS with menu search, editable cart, explicit checkout, sales filters and receipt details.
- Immutable local inserts, UUID receipt references, shared sync worker and acknowledgement validation.
- Offline production app shell with deferred updates; local data schema remains at version 1.
- Automated storage, sync, browser checkout and API ownership checks.
- Initial offline-first POS foundation.
- FastAPI v1 sync API.
- Multi-tenant domain baseline.
- Printer abstraction and release guardrails.
