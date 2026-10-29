# Printing

Receipts are immutable snapshots of the committed local sale. Checkout commits the
order, payment, audit/stock journal entries and sync outbox **before** it attempts any
printing, so printing can never cancel, repeat or change a sale.

## Rules

- Printing does not require internet.
- Sale completion does not depend on print success.
- Checkout opens the saved receipt immediately and never routes to Sales.
- A missing printer or print failure leaves the sale committed and the receipt preview
  open with Print again and Done actions.
- Reprint uses the stored order snapshot and does not create a new sale. If the
  configured printer fails, Print again offers the browser print dialog instead.
- A browser's `afterprint` event is not proof of physical output, and neither is a
  Bluetooth write being accepted; the UI asks the cashier to check the printer.
- Test prints are marked **TEST PRINT / NOT A SALE** and never create an order,
  payment, stock movement, shift change, receipt number or outbox event.
- The Bluetooth device chooser opens only from a tap on **Find Bluetooth printer** or
  **Connect**. Checkout, reprint and test print never prompt for Bluetooth permission.
- **Auto-print after payment** (Settings → POS, also on Devices & Printers) is
  independent of how the printer was set up. On: the sale is saved, then printed.
  Off: the sale is saved and the receipt dialog offers **Print receipt**; after the
  dialog is closed, later prints are reprints (**Print again**).
- Kitchen ticket printing is a separate future adapter/workflow.

## Audit records

Printing a sale records one audit event; it never changes the order, payment, stock or
shift. The action names are the existing backend contract and are accepted for cashiers:

| Action | Recorded when | Server permission |
|---|---|---|
| `PRINT_COMPLETED` | First print of a sale (auto-print or **Print receipt**) finished at software level | `pos.sale.create` |
| `PRINT_FAILED` | First print could not be sent or no adapter was available | `pos.sale.create` |
| `RECEIPT_REPRINTED` | **Print again** finished at software level | `pos.receipt.reprint` |

**`PRINT_COMPLETED` means software-level completion only**: the print dialog closed or
the Bluetooth write was accepted. It does **not** confirm that paper came out; the event
message states which of the two happened. Test prints, printer setup and Connect record
no audit or sync events.

## Device and tenant scope

Printer profiles are saved in the device settings for the signed-in business and
terminal (`setting:{businessId}:device:{terminalId}`). The last test-print result is kept
in this browser under `maknam-printer-test:{businessId}:{terminalId}:{printerId}` and is
rejected if its contents name another business, terminal or printer. Bluetooth
connections held in memory are keyed the same way. Signing in to another business on the
same tablet therefore never shows or reuses another business's printers, connections or
test results.

## Setup modes and permissions

| Who | Can |
|---|---|
| Owner / technician (`devices.manage`) | Automatic detection, Manual configuration, set default, remove, Connect (remembered), Test print |
| Cashier (`devices.view`) | See printer status, Connect for this session only, Test print an existing printer |
| `settings.pos` | Turn Auto-print after payment on or off |

**Automatic detection (recommended).** Shows what this device supports (print dialog,
direct Bluetooth Low Energy) and explains what does not work in a browser (Bluetooth
Classic). **Find Bluetooth printer** opens Chrome's chooser; the chosen printer is
configured for direct printing **only if it matches a model in
`apps/pos/src/services/verifiedPrinters.ts`**. That list is empty until a model is
verified on real hardware; otherwise detection says the printer needs Manual
configuration or the print dialog route. **Use print dialog printer** adds a
system-printer profile (for Android, with a print service app).

**Manual configuration (advanced).** Device print dialog, browser print, or direct
Bluetooth Low Energy with the verified service and characteristic UUIDs. Direct
Bluetooth is saved only when both UUIDs are present and valid.

Printer status: **Connected** (ready; for print-dialog printers, ready to open the
dialog), **Disconnected** (Bluetooth configured but not connected in this session; it
reconnects silently where the browser remembers the printer, otherwise tap Connect),
**Unsupported** (browser, page or printer type cannot be used) and **Setup required**
(Bluetooth Low Energy without verified UUIDs).

## Test print workflow

1. Devices & Printers → the printer → **Test print**. A sample receipt is built in
   memory: Maknam POS, the vendor name, TEST PRINT - NOT A SALE, date and time, a
   sample item and amount, a width ruler, character and alignment rows and an
   end-of-test marker.
2. The result says what software can know: **print dialog closed**, **data sent to
   printer**, **unsupported**, or **connection or write failure**.
3. After a dialog or a send, answer **Printed correctly**, **Printed incorrectly** or
   **Nothing printed**, or **Retry test**.
4. The last result is kept only on this device (browser storage, not synced). The
   transport result and the person's answer are kept separately: "data sent" is
   never shown as a confirmed print.

## Architecture

| Piece | File | Role |
|---|---|---|
| Receipt document | `apps/pos/src/lib/receipt.ts` | Builds the receipt from the sale snapshot; HTML for browser printing |
| ESC/POS encoder | `apps/pos/src/services/escpos.ts` | Plain-ASCII thermal layout (32 chars on 58 mm, 48 on 80 mm), no code page selection, control characters removed |
| Configuration | `apps/pos/src/services/printerConfig.ts` | Validates printer `configuration`; Bluetooth stays unavailable until verified UUIDs are entered |
| Browser adapter | `BrowserPrintAdapter` in `printer.ts` | System print dialog (`SYSTEM_PRINTER`, `BROWSER_PRINT`) |
| Bluetooth adapter | `apps/pos/src/services/bluetoothPrinter.ts` | Web Bluetooth **BLE GATT** ESC/POS, chunked writes, one job at a time |
| Print service | `DefaultPrintService` in `printer.ts` | Chooses the adapter, explains unavailability, reprint fallback |

Printer profiles live in the device settings (`connectionType`, `paperProfile`,
`configuration`). Bluetooth configuration keys: `transport` (`BLE_GATT` or
`CLASSIC_SPP`), `serviceUuid`, `characteristicUuid`, optional `namePrefix`,
`chunkSize` (20–512 bytes, default 20) and `charsPerLine` (24–64), plus `deviceId`
and `deviceName` saved after Connect. No backend change is needed.

USB, network and native Android adapters are not implemented; those profiles show
as unavailable with the reason.

## Android tablets: the two routes

### Route A: Android print dialog (browser printing)

Chrome on Android prints through the Android print framework. A printer appears in
the print dialog **only if an installed Android print service supports it**. Pairing a
printer in Android Bluetooth settings does **not** add it to the print dialog. This is
the usual reason a printer "pairs but does not print".

Most generic 58 mm Bluetooth printers need a third-party print service app (for
example RawBT) to appear in the dialog. Evaluate any such app before use: it receives
the receipt content. Configure the Maknam printer as **System printer**, Thermal 58 mm.

### Route B: direct Bluetooth Low Energy (Web Bluetooth)

Chrome (Android and desktop) can send ESC/POS bytes directly to a printer that exposes
a **Bluetooth Low Energy GATT** service with a writable characteristic.

Limits:
- **Bluetooth Classic (SPP) printers cannot be reached from any browser.** Many cheap
  58 mm printers are Classic-only; they need Route A or a future native app.
- Web Bluetooth can only open the GATT services named when the printer is chosen,
  so the service and characteristic UUIDs must be known. They differ between printer
  models and are **never guessed** by Maknam POS.
- It needs the https app address, a user tap to choose the printer, and Chrome
  (not Firefox or Safari).
- After a browser restart, some Chrome versions remember the permitted printer and
  others require tapping **Connect** again before the first print.

## Verifying a printer (before choosing a route)

Record the printer brand, model and any label text, the tablet model, the Android
version and the Chrome version.

1. Install the free **nRF Connect for Mobile** app (Nordic Semiconductor) on the tablet.
2. Turn the printer on. If it is paired in Android settings and connected elsewhere,
   disconnect it there first.
3. In nRF Connect, **Scan**. If the printer does not appear, it is probably Bluetooth
   Classic only: use Route A.
4. If it appears, **Connect**, then open each unknown service and look for a
   characteristic whose properties include **WRITE** or **WRITE NO RESPONSE**.
5. Write this hex value to that characteristic: `1B 40 54 45 53 54 0A 0A 0A`
   (ESC/POS initialise, "TEST", three line feeds). If paper prints `TEST`, the route is
   verified. Record the **service UUID** and **characteristic UUID** exactly.
6. If nothing prints, try the next writable characteristic. If none works, use Route A.

## Configuring Maknam POS (Route B)

1. Devices & Printers → Add a printer → **Manual configuration (advanced)**: method
   **Direct Bluetooth Low Energy**, paper **Thermal · 58 mm**, then enter the recorded
   service and characteristic UUIDs. Optional: device name prefix, characters per
   line (if the test page ruler wraps), bytes per write (only if printing stalls).
2. Tap **Connect** and choose the printer.
3. Tap **Test print**. Check that the ruler line `1234…` fits on one line and that
   the page says TEST PRINT - NOT A SALE, then answer whether it printed correctly.
4. **Set as default**, and set **Auto-print after payment** as required.
5. Once confirmed on real hardware, the model can be added to
   `verifiedPrinters.ts` (with the verification details) so Automatic detection can
   configure the same model on other tablets.

## Remote hardware acceptance procedure

Run it on the actual tablet and printer, and keep photos of each printed result.

1. Verify the printer (above) and record which route it uses.
2. Test print. Confirm the ruler fits and nothing else is printed.
3. Online sale with Cash, tender and change. Confirm the receipt shows the business,
   receipt number, date/time (Africa/Accra), cashier, terminal, items with
   variations, total, `GHS` amounts, tendered, change and footer.
4. MoMo sale with reference: the reference is printed.
5. Long item name and variation: the text wraps and amounts stay right-aligned.
6. Printer off, then a sale: the sale is saved, the status explains the failure, and
   Print again offers the browser fallback. Turn the printer on and reprint: one
   receipt, no new sale, unchanged stock and shift totals.
7. Out of paper during a print: the sale is saved; reprint after reloading paper.
8. Offline (airplane mode, Bluetooth on): sell and print 5 receipts; reconnect; the
   sales sync once.
9. Close and reopen the app: Connect again if required, then print.
10. Two quick sales (tap Print again while printing): receipts are not mixed.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Paired in Android settings but nothing prints | No print service (Route A) or Classic-only printer | Verify the printer; install a print service app or use Route B if it is BLE |
| "This browser cannot use Bluetooth printers" | Not Chrome, or Bluetooth disabled for the site | Use Chrome on Android; allow Bluetooth in the site settings |
| "needs the secure (https) app address" | App opened over http | Open the https address |
| "Bluetooth printing is not set up" | UUIDs missing or invalid | Enter the verified UUIDs |
| "…not connected. Open Devices & Printers and tap Connect" | Printer not chosen in this browser session | Tap Connect, then print again |
| "Could not connect to the printer" | Printer off, out of range, or connected to another phone | Turn it on, move closer, disconnect other devices |
| "…does not accept data" | Wrong characteristic | Re-check the writable characteristic in nRF Connect |
| Garbled or missing lines | Printer drops large writes | Set bytes per write to 20 |
| Lines wrap unexpectedly | Printer font is narrower than assumed | Set characters per line from the test page ruler |
| `?` in place of a character | Character not in the printer's built-in set | Expected; receipts use plain ASCII and `GHS` for cedis |
