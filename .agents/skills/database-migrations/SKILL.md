# Database Migration Skill
Use Alembic and expand → migrate → contract. Never edit applied migrations. Keep N-1 app compatibility through staged rollouts. Prefer nullable/new columns and new tables before backfill; enforce stricter constraints only after data and clients are ready.
