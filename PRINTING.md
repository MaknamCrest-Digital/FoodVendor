# Printing

Receipts are immutable snapshots of the committed local sale. The shared renderer
supports thermal 58/80 mm, A4 and Letter paper profiles. Checkout commits the order,
payment, audit/stock journal entries and sync outbox before it attempts any printing.

The browser adapter can open a system print dialog for `SYSTEM_PRINTER` and
`BROWSER_PRINT` profiles. It cannot discover installed hardware, select a named printer,
or confirm that physical paper was produced. Bluetooth, USB, network and native
ESC/POS routes remain unavailable until their Capacitor platform adapters are
implemented and validated with the target printer models. The Devices & Printers page
marks those configured profiles unavailable instead of reporting a false connection.

Rules:
- Printing does not require internet.
- Sale completion does not depend on print success.
- Checkout opens the saved receipt immediately and never routes to Sales.
- A missing printer or print failure leaves the sale committed and the receipt preview
  open with Print again and Done actions.
- Reprint uses the stored order snapshot and does not create a new sale.
- A browser's `afterprint` event is not proof of physical output; the UI says to check
  the printer rather than claiming that paper definitely printed.
- Kitchen ticket printing is a separate future adapter/workflow.
