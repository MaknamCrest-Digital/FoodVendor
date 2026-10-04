# Testing Strategy

## Must-pass release scenarios
1. 20 sales with internet disabled.
2. All receipts printable/reprintable offline.
3. Restart app; orders/outbox remain.
4. Reconnect; all sales sync exactly once.
5. Replay every sync request; totals remain unchanged.
6. Upgrade app/local schema; historical data remains.
7. Roll API code back one version; supported clients continue.
8. Two terminals create orders offline without ID collision.
9. Tenant A cannot read Tenant B records.
10. Print failure never loses payment/order.

Backend uses pytest. POS unit tests use the Node test runner through tsx; browser tests use Playwright. Add device/E2E tests as hardware integration matures.

## Current browser checks
From `apps/pos`, run `npm test`, `npm run build`, then `npm run test:e2e`.
Install Chromium once with `npx playwright install chromium`. The browser suite uses
the Next.js static export at localhost:5174 (start it separately with `npm run preview`
to reuse a running server). On Windows use `npm.cmd` / `npx.cmd` if script execution is restricted.

Coverage: 20 offline sales, integer totals, duplicate insert rollback, retry acknowledgements,
network failure retention, simultaneous sync calls, widths from 320 to 1440px, payment selection,
quantity controls, repeated checkout taps, offline reload, reconnect and print failure isolation.
Browser sync responses are mocked; API pytest checks duplicate retries and tenant/location ownership.
This does not certify authentication, physical printers, Android process restart, cross-version
upgrades or concurrent native terminals. Those release scenarios still require implementation and validation.

## Version 1 migration gates
Run `npm install`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`,
and backend `python -m pytest`. The production build must export all 15 module routes.
Test direct deep links and client-side navigation, including offline route changes with
no document reload, cart/payment retention across POS/Sales, original schema-1 pending
orders, receipt snapshots, and old protocol-1 clients without Idempotency-Key.

Browser network acknowledgements are mocked in integration tests; backend pytest exercises
real FastAPI requests and database writes in the isolated test database. Auth tests use
locally generated RSA tokens and a test JWKS key to verify signature, issuer, audience,
expiration, explicit subject mapping, and disabled-account rejection without contacting
Supabase. Do not run tests against a restaurant database. Native hardware and the unfinished
Version 1 operational modules remain outside this migration's validation claims.
