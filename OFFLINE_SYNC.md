# Offline Sync Protocol v1

## Local sale transaction
1. Begin a local read/write transaction (SQLite in Capacitor; IndexedDB in browser).
2. Revalidate menu, stock and shift state while holding the write boundary.
3. Create the order snapshot, payment journal, applicable stock movements, sale audit
   journal entry and sync outbox event with UUID idempotency key.
4. Commit locally.
5. Open/print the saved receipt independently; print failure never rolls back the sale.
6. Background worker attempts sync.

## Event envelope
```json
{
  "event_id": "uuid",
  "event_type": "order.completed",
  "entity_id": "uuid",
  "business_id": "uuid",
  "location_id": "uuid",
  "terminal_id": "uuid",
  "app_version": "1.0.0",
  "local_schema_version": 1,
  "sync_protocol_version": 1,
  "occurred_at": "ISO-8601",
  "payload": {}
}
```

## Idempotency
`event_id` is unique server-side. Receiving the same event twice returns the existing acknowledgement and MUST NOT recreate the order/payment.

## Version 1 conflict policy
Completed sales are append-only, so server accepts unique events. Menu changes use server `updated_at` and are refreshed separately. Future mutable inventory/config entities require explicit conflict strategies rather than silent last-write-wins.

## Failure behavior
Exponential retry with jitter is recommended. Pending events survive app/process restart. UI shows pending count but does not block sales.

## Framework migration compatibility
The envelope and protocol remain version 1. Current clients also send `Idempotency-Key`
equal to `event_id`. FastAPI rejects mismatches but accepts older clients without that
header. Database uniqueness still uses the event UUID; no separate idempotency store is added.
The browser IndexedDB database name, schema 1 and store keys remain unchanged. Native
SQLite uses the same local storage contract and serializes transactions on its connection.
Same-origin legacy IndexedDB records are copied once without deleting the source. For
Chrome-to-Android transfers across separate origins, use Devices & Printers' scoped JSON
export/import; imports validate business/location, add atomically, and never overwrite
conflicts. Printer profiles and device settings are intentionally not transferred.
