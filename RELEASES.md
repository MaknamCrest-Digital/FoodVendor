# Releases & Rollback

Use semantic versions and immutable Git tags/artifacts (application release `1.0.0`; separate API/schema/sync versions).

## Pipeline
PR → lint/test → build → staging → physical tablet/printer smoke test → pilot terminal → staged production rollout.

## Rollback principle
Rollback code, not live business history. Database migrations must be backward-compatible so the prior API/POS release can operate against a newer compatible schema during the rollback window.

## Update classes
- Optional: feature improvements.
- Recommended: fixes; persistent prompt, no active-sale interruption.
- Required: rare security/protocol incompatibility; must account for offline terminals.

Keep N-1 client/API compatibility during staged deployment where feasible.

## Version 1 framework migration
Application version is 1.0.0; `/api/v1`, local schema 1 and sync protocol 1 are unchanged.
The minimum compatible POS version remains 0.1.0 intentionally: older protocol-1 clients
and queued events must not be rejected solely because the frontend framework changed.

Archive the complete Next.js `out/` folder and its lockfile/configuration with each release.
Deploy all route payloads and hashed assets atomically; retain the prior complete artifact.
The offline worker does not call `skipWaiting`, so a release activates after all POS tabs
close. Schedule activation outside active sales/shifts. Rollback replaces application assets
only; do not clear IndexedDB, reset SQLite, restore the cloud database, or change UUIDs.

Keep the same scheme/host/port (origin) when migrating an installed browser POS. A new
origin has different IndexedDB storage and cannot see pending transactions on the old origin.
The local scripts retain ports 5173 (development) and 5174 (static preview) for this reason.
Development and preview are separate origins; do not mistake their separate data for loss.
Close all old preview tabs once to activate the new cached application; never instruct a
cashier to clear site data. Validate upgrade and rollback using isolated test profiles first.

The pre-migration source/static build archive is stored outside the repository in
`../migration-backups/before-next-migration.zip`. This checkout had no `.git` metadata,
so a Git tag/branch could not be created here. CI uploads the new static release artifact.
