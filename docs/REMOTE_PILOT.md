# Maknam POS — remote pilot

**Business:** Adonai Pork — Dansoman · **Environment:** TEST / PILOT

> Please do not use this environment for real financial transactions.

Logins and the link are sent to you privately by your coordinator. For the full
checklist of things to try, see [PILOT_TESTING.md](PILOT_TESTING.md). For install
help and how offline mode works, see [PWA.md](PWA.md).

## Your 10-minute workflow

1. **Open the Maknam POS link** in Chrome (Android phone/tablet or computer).
2. **Sign in** as Cashier (internet needed for this first step).
3. **Install Maknam POS**: tap *Install Maknam POS* at the top (or Chrome menu → Install app).
   Open it from your home screen.
4. **Open a shift**: Shifts → Open shift → enter opening cash (e.g. 200) → Save.
5. **Test a sale**: POS → Pork + Yam → choose a size → Coke → Complete sale →
   Payment received. Check the receipt.
6. **Turn off the internet** (Wi‑Fi and mobile data). The top bar shows **Offline · Local mode**.
7. **Test another sale**, e.g. Fried Yam + Water paid by Mobile Money. It completes
   and shows a receipt as normal. Close and reopen the app: the sale is still there.
8. **Turn the internet back on.**
9. **Watch it sync automatically**: the top bar goes from *items pending* /
   *Syncing* to **✓ Synced**, usually within a few seconds.
10. Optionally tap the status button (**Sync now**) to sync immediately.
11. **Confirm your sales appear**: Sales shows both sales. Your coordinator (Admin) will
    confirm they arrived once each and that Coke and Water stock went down by one.

If anything looks wrong, note the time, what you tapped, whether you were online,
and take a screenshot.

---

## Coordinator checklist (before inviting clients)

| Check | How |
|---|---|
| API up and DB reachable | `curl https://<pilot-api>/health/db` → `"database":"connected"` |
| Schema, seed, logins | `MAKNAM_ENV_FILE=.env.pilot python scripts/verify_pilot.py` → all PASS |
| Frontend points at pilot API | build with `MAKNAM_DEPLOY=pilot` (refuses localhost/http) |
| CORS | `CORS_ORIGINS` = exact pilot frontend origin |
| Install + offline | Open link, install, go offline, reload: app opens and sells |
| Restrictions | Cashier cannot open Staff, Audit or business Settings |

Deployment steps: [PILOT_ENVIRONMENT.md](PILOT_ENVIRONMENT.md#deploying-for-remote-testers).
