# Food Vendor OS Version 1 Roadmap

Application version: **1.0.0**. All modules below remain in Version 1 scope.
The framework migration changes technology, not product scope.

## Existing browser foundation
Offline POS, menu/cart, Cash/MoMo/Card recording, durable outbox, idempotent cloud sync,
printer boundary, sales history/reprint, device/version tracking and offline app-shell loading.
Next.js App Router + React + TypeScript + Tailwind replace the previous frontend toolchain.

## Version 1 module scope
Dashboard; POS; Orders; Kitchen; Sales; Inventory; Purchases; Expenses; Customers;
Shifts; Reports; Staff & Roles; Devices & Printers; Settings; Audit Log.

POS and Sales were implemented in the supplied repository. The other modules did not
have screens or backend workflows to migrate; they now have explicit planned route pages.
The migration does not claim that these workflows have been implemented.

## Version 1 delivery work still required
- Operations: staff roles, shifts, cash reconciliation, order lifecycle and kitchen workflow/KDS.
- Control: inventory/stock movements, supplier purchases, expenses, customers and reporting.
- Administration: device registration, settings and privileged-action audit history.
- POS extensions: Dine In/Takeaway, Hold/Resume and authorized refund/void requests.
- Food costing: recipes/BOM, ingredients, purchasing and wastage.
- Native device foundation: Capacitor, local SQLite, Bluetooth ESC/POS and real hardware validation.
- Security: authenticated tenant/device scope, staff authorization and financial audit records.

## Feature flags and later integrations
Retain customer_web_ordering, kitchen_display, inventory, recipes, delivery and qr_ordering
as configuration concepts. Flags do not implement missing workflows or replace authorization.
Migrate/refactor the existing Chics & Chips customer ordering UI into the shared order engine
when ready; preserve proven UX. Multi-location, QR/table ordering, delivery and advanced
analytics remain in the platform plan.
