# Maknam POS Pilot

**Business:** Adonai Pork — Dansoman
**Environment:** TEST / PILOT

> **Please do not use this environment for real financial transactions.**
> Sales here are test records. Receipts are marked "PILOT TEST RECEIPT".

## Your access

| | |
|---|---|
| Testing URL | *[configured separately — your coordinator will send it]* |
| Admin login | `admin@adonai.test` |
| Cashier login | `cashier@adonai.test` |
| Temporary passwords | *[DO NOT COMMIT THESE — sent to you privately by your coordinator]* |

Use Google Chrome (desktop, tablet or Android phone). Signing in the first time
needs internet; after that the till keeps working offline.

## What is set up

- Categories: **Pork**, **Yam**, **Drinks**
- **Pork + Yam** — Small GHS 60, Medium GHS 90, Large GHS 130
- **Fried Yam** — Small GHS 20, Medium GHS 30, Large GHS 40
- **Coke** GHS 12, **Malt** GHS 15, **Water** GHS 5 — each starts with 48 in stock
- Payment methods: Cash and Mobile Money. Currency GHS, time zone Africa/Accra.
- Till (terminal): **AD-01**

## Smoke test (about 15 minutes)

Write down anything that looks wrong, with the time and a screenshot.

1. Open the testing URL.
2. Sign in as **Cashier**.
3. Go to **Shifts** and **open a shift** (enter opening cash, e.g. GHS 200).
4. Go to **POS** and tap **Pork + Yam**.
5. Choose a size (variation), e.g. **Medium**.
6. Tap **Coke**.
7. Choose **Cash** and enter the cash received (e.g. GHS 120).
8. **Complete the sale.**
9. Check the **receipt** preview: items, size, total, cash received and change.
10. Open **Sales**.
11. Find the transaction you just made; check its total and payment method.
12. Note the Coke count shown on the POS (it should be one lower than before).
13. **Sign out.**
14. Sign in as **Admin**.
15. Open **Sales** and confirm the cashier's sale appears. Open **Menu** /
    **Inventory** and confirm Coke went down by one.
16. Sign in again as **Cashier** and confirm you **cannot** open Staff, Settings
    → Team & Access, business settings or Audit (they are hidden or say you do
    not have permission).
17. **Offline test:** while signed in as Cashier, turn off Wi‑Fi / mobile data
    (or in Chrome: DevTools → Network → *Offline*).
18. Make another sale (e.g. Fried Yam Small + Water, paid by Mobile Money).
    It must complete and show a receipt while offline.
19. Turn the internet back on. Wait up to a minute (or press **Sync now** on the
    Dashboard).
20. Sign in as **Admin** and check that the offline sale appears **exactly once**
    in Sales and that Water went down by exactly one.

Finally, as Cashier, **close your shift**: count the cash and enter it. Expected
cash = opening cash + cash sales only (Mobile Money is not in the drawer).

## Please also try

- Login with a wrong password (should be refused clearly).
- Both payment methods: Cash and Mobile Money.
- Several sizes of the same item in one order.
- Re-printing / re-opening a receipt (it must not create a new sale).
- Refreshing the page in the middle of the day (your shift and sales stay).

## Reporting problems

Send: what you did, what you expected, what happened, the time, the account
(Admin/Cashier), and whether you were online or offline.
