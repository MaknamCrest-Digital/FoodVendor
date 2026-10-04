# Adonai Pork — November 2026 pilot checklist

First pilot: Dansoman. December production is conditional on evidence below.
Run in controlled parallel operation before replacing the existing system.
Record device, build, tenant, operator, date, expected totals and actual totals.
An unchecked box is **not validated**, even when a screen exists.

## Setup, identity and access

- [ ] Provision Adonai tenant/location and real pilot device AD-01 as data.
- [ ] Owner and Cashier can sign in and sign out through FastAPI.
- [ ] Final Owner cannot be deactivated or lose access administration.
- [ ] Cashier can open/view/close own shift, sell and print.
- [ ] Cashier cannot see restricted revenue/payment/expense/dashboard widgets.
- [ ] Direct unauthorized refund, settings, role and audit requests return 403.
- [ ] Owner role customization and INHERIT/ALLOW/DENY overrides work.
- [ ] Chics & Chips settings/roles/data remain isolated from Adonai.

## Settings

- [ ] GHS, Africa/Accra and unambiguous local date/time presentation.
- [ ] Currency change warns, is audited and does not convert past amounts.
- [ ] Cash/MoMo/Card configurable; at least one method remains enabled.
- [ ] Default payment and required MoMo reference affect checkout offline.
- [ ] Require shift/opening/count/variance-note rules affect checkout and close.
- [ ] Auto-print and confirmation settings affect checkout.
- [ ] Receipt fields, 58/80mm, collection wording/footer use tenant data.
- [ ] Live receipt preview creates no sale/payment/receipt number/stock movement.
- [ ] Light/Dark/System preference belongs only to that user and survives restart.
- [ ] Device printer preferences do not change other devices.
- [ ] Settings sections save independently; errors preserve input.
- [ ] Account change/password change use FastAPI.
- [ ] Sync details/retry never expose a transaction reset/delete control.

## Menu, stock and cashier service

- [ ] Owner creates, reorders, edits and deactivates restaurant categories.
- [ ] Single-price product adds in one tap; free-form variation uses configured price.
- [ ] Menu price change does not alter historical item/variation/price snapshots.
- [ ] Meals can be sold without ingredient stock; sold-out blocks further checkout.
- [ ] Opening Coke 24 → offline sale of 2 → quantity 22 → sync still 22.
- [ ] Opening/restock/sale/adjustment/wastage/return movements retain actor/reason.
- [ ] Stock reduces only on commit; failed checkout rolls back all changes.
- [ ] Out-of-stock and insufficient-stock checks work; negative stock defaults off.
- [ ] Dashboard low/out stock agrees with menu stock.
- [ ] Busy-period landscape touch targets and variation selection are usable.

## Payments, ledger and cash accountability

- [ ] Cash sale 105, tender 120, change 15 records sale value 105.
- [ ] MoMo and Card record received payments and optional/required references.
- [ ] Every receipt identifies operator, terminal and shift.
- [ ] Refund/void requires permission and reason; original financial data remains.
- [ ] Over-refunds and duplicate corrections are rejected.
- [ ] Drawer expense creates one linked cash out; totals are not double counted.
- [ ] Expected cash = opening + cash sales + cash in − cash refunds − cash out.
- [ ] MoMo/Card are excluded from drawer cash.
- [ ] Close shift with balanced/short/over counts and required variance notes.
- [ ] Sales/payment/expense/stock/shift reports reconcile to underlying records.
- [ ] Audit includes login, sale, reprint, stock, correction, settings and access changes.

## Offline, printing and restart — real pilot device

- [ ] Open shift and disconnect internet.
- [ ] Complete 20 consecutive sales with varied methods and drink stock.
- [ ] Print receipts on the actual Bluetooth ESC/POS printer.
- [ ] Restart app/device offline during the sequence; continue selling.
- [ ] Retain 20 unique sales, payments, correct totals, shift and stock movements.
- [ ] Reconnect; all synchronize without duplicate financial or stock records.
- [ ] Lose connection after server commit but before ACK; retry stays idempotent.
- [ ] Disconnect printer: payment stays committed; Retry Print creates no new sale.
- [ ] Reprint leaves stock and shift totals unchanged.
- [ ] Test 58mm/80mm output, long names/variations and collection wording.
- [ ] Conflicting offline terminals retain pending records and expose review errors.
- [ ] Upgrade/rollback retains native SQLite, settings and pending records.
- [ ] Update is deferred during active sale/unsafe shift; no forced data reset.

## Issue and release gates

P0 = data/money loss or tenant leak. P1 = blocked checkout/shift/printing.
P2 = workflow friction. P3 = cosmetic polish.

- [ ] Resolve all P0/P1 issues and reconcile affected data before production.
- [ ] Resolve major P2 issues; do not let P3 distract from correctness.
- [ ] Complete staff training, deployment rehearsal and recovery/backup rehearsal.
- [ ] Owner signs off expected-versus-actual daily totals and production readiness.
