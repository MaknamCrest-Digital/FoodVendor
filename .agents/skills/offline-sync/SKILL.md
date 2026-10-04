# Offline Sync Skill
Always write locally first. Pair business mutation and outbox insertion in one SQLite transaction. Sync asynchronously. Every event has a UUID idempotency key; server uniqueness makes retries safe. Never mark synced before server acknowledgement. Pending events survive restarts.
