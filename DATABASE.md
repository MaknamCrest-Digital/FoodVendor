# Database & Migration Policy

Production uses PostgreSQL. POS uses SQLite locally. Alembic manages cloud schema migrations.

## Rules
- UUID primary keys for offline-originating entities.
- `business_id` on tenant-owned records; `location_id` where relevant.
- Foreign keys and uniqueness constraints enforce integrity.
- Financial history is append-only after completion.
- Never edit an applied production migration.
- Use expand → migrate/backfill → contract.
- Application rollback normally keeps the newer compatible DB schema.
- Backups/PITR are disaster recovery, not normal release rollback.

## Example safe evolution
An earlier release uses `orders.payment_type`. A subsequent release needs multiple payments. Add `payments` first while retaining old compatibility, migrate/backfill, deploy clients, then remove obsolete fields in a later release.
