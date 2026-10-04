# Maknam POS as an installed app (PWA)

Maknam POS runs in the browser and can be installed like an app. Once it has been
opened online and you have signed in, the till keeps selling without internet
and syncs when the connection comes back.

## Install

**Android (Chrome)**
1. Open the Maknam POS link in Chrome and sign in.
2. Tap **Install Maknam POS** at the top of the screen, or Chrome's menu **⋮ → Install app**
   (on some phones: **Add to Home screen**).
3. Open **Maknam POS** from the home screen. It runs full-screen, without a browser bar.

**Desktop (Chrome or Edge)**
1. Open the link and sign in.
2. Click **Install Maknam POS** in the header, or the install icon at the right of the
   address bar (Edge: **⋯ → Apps → Install Maknam POS**).
3. Launch it from the Start menu, Dock or desktop shortcut.

Installation is optional; the browser tab works the same way. If you choose
**Not now**, the offer stays hidden for 14 days. It never appears once installed.
iPhone/iPad: Safari → Share → **Add to Home Screen** (no install button is shown on iOS).

## How offline mode works

| | Needs internet? |
|---|---|
| First sign-in on a device | **Yes** |
| Loading the app after it has been opened once | No |
| POS: add items, sizes, take Cash/MoMo/Card payment, complete sale | No |
| Receipt preview and printing | No |
| Stock going down on sale, opening/closing shift | No |
| Sales history and today's totals for this device | No |
| Seeing sales made on *other* devices | Yes (after a sync) |
| Changing settings, staff or menu on the server | Yes |
| Signing in again after signing out or after 7 days | **Yes** |

Every completed sale is saved on the device in one step (order, items, payment,
stock movement, shift totals, audit entry and a sync record) **before** the
receipt prints. If printing fails the sale stays completed and you can print again.

Storage on the device: the browser's built-in database (IndexedDB) in the web/PWA
app, and SQLite in the Android app. Both are private to the app on that device.
React screen state and localStorage are never used as the sales record.

## Sync

The status in the top bar tells you where things stand:

| You see | Meaning |
|---|---|
| ● Online · ✓ **Synced** | Everything on this device is in the cloud. |
| ● Online · **3 items pending** | Saved here, waiting to upload. Tap it to sync now. |
| ● Online · ↻ **Syncing 3 items** | Uploading now. |
| ● Offline · **Local mode** | No internet. Keep selling; nothing is lost. |
| **Sync failed — retry available** | Something was not accepted. The records are still saved here. |

"Synced" only appears when nothing is waiting, not just because you are online.

Sync runs automatically when the app opens, when the internet returns, when you
come back to the app (tablet woken up, app reopened), and about every 10 seconds
while it is open. You can also tap the status button (or **Settings → Sync & data
→ Sync now**) at any time. Settings → Sync & data shows Pending, the last run's
Synced/Failed counts and the time of the last successful sync.

Every record carries a permanent ID. Sending it twice (for example, when the
connection drops just as the server saves it) is recognised by the server, so a
sale, payment, stock change or shift is never counted twice.

## If sync fails

1. Check the internet connection, then tap **Sync now**.
2. Open **Settings → Sync & data**. Items under *Needs attention* show what the
   server rejected (for example, a shift closed on another device).
3. Keep selling. Failed records are never deleted and are retried automatically.
4. Do not clear browser data or uninstall the app while items are pending. That
   deletes unsynced sales from the device.
5. Report the message shown under *Needs attention* to your coordinator.

Signing out with unsynced items asks for confirmation. Those items stay on the
device and sync the next time the same person signs in on it.

## Security notes

- Passwords are never stored on the device. Sign-in goes to Supabase Auth and
  the account, role and permissions come from the Maknam API.
- The device keeps the signed-in profile and a short-lived (1 hour) access token so
  it can keep selling offline for up to **7 days from sign-in**. After that, sign in
  again with internet.
- Limitation: as a static web app with no server of its own, the Supabase refresh
  token is kept in a first-party browser cookie that page scripts can read; an
  httpOnly cookie is not possible here. Mitigations: tokens are short-lived,
  deactivating a user on the server signs that device out the next time it is
  online, and **Sign out** revokes the session. Use dedicated till devices and do
  not install browser extensions on them.
- Each business/location/user only ever sees its own records on a shared device.
  Records are filtered by the signed-in account, and the server re-checks
  every upload. The service worker caches only the app's own files, never API
  responses.

## For developers

- Manifest: `apps/pos/public/manifest.webmanifest`. Icons: `public/icons/` (edit
  `icon.svg`, then `npm run build:icons`).
- Service worker: generated by `scripts/build-sw.mjs` after `next build`. It
  precaches the static export (cache-first) and never intercepts `/api/` or
  cross-origin requests. A new version waits until open tills are closed.
- The service worker registers only in production builds (`npm run build && npm run preview`
  → http://localhost:5174). `npm run dev` does not install it.
- Sync status logic: `src/lib/syncStatus.ts`; triggers: `components/pos/PosProvider.tsx`.
- Browser Background Sync is not relied on (not available in every browser); the
  online/resume/timer/manual triggers cover the same cases while the app is open.
