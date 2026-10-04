# Domain

- **Business**: tenant, e.g. Adonai Pork or Chics & Chips.
- **Location**: branch/site owned by a business.
- **Terminal**: registered POS tablet.
- **User**: staff identity with role.
- **Shift**: cashier working session.
- **MenuItem**: sellable item.
- **Order**: immutable commercial event after completion.
- **OrderItem**: item snapshot (name, quantity, unit price) at sale time.
- **Payment**: money tendered against an order.
- **Refund/Void**: compensating event; never delete the original sale.
- **OutboxEvent**: local durable event waiting for cloud acknowledgement.
- **SyncReceipt**: server acknowledgement of an idempotent event.

Money is represented as integer pesewas in storage/contracts, never binary floating point.
