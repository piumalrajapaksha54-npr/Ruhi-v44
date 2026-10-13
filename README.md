# Ruhi Mobile V42 – Online Business Manager

## Run
1. Node.js 18+ LTS
2. `npm install`
3. `npm start`
4. Open the shown URL (default port 8787).

Default first-run administrator: `admin` / `admin`

## V42 changes and checks
- Purchase Save flow repaired and hardened.
- Purchase supplier/product validation, multi-item purchase, discount, additional charges, paid amount and payment-account handling.
- Partial credit purchase creates a supplier payment record so supplier balance is correct.
- Purchase cancellation reverses stock and paid cash/account effects.
- Supplier/customer/product edit/delete actions restored where they were missing.
- Invoice cancellation reverses stock and received cash effects.
- Customer Return / Supplier Return cancellation reverses stock and refund-account effects.
- Purchase and return detail views include cancellation actions.
- Supplier previous balance is calculated on Purchase screen.
- Cloud data normalization prevents missing-array errors after loading older data.
- Railway PostgreSQL persistence remains supported through `DATABASE_URL`.
- Service-worker cache/version bumped to prevent an old cached V19 app from hiding new fixes.
- Server-side user edit/delete permission checks corrected.

## Railway
Connect a PostgreSQL service and expose its `DATABASE_URL` to the Ruhi Mobile service. See `RAILWAY_DATABASE_SETUP.md`.

After deploying a new build, if an older version still appears, do one hard refresh/reload once so the new service worker can activate.

## V42 additions
- Added the missing `addPurchaseDraft()` handler, so multiple purchase lines can be added before saving a bill.
- Added remove controls for staged bill lines.
- Expanded Repair Jobs with automatic RJ job numbers, notes, status, technician, created-by tracking, searchable history, double-click detail modal, status/notes update, and CSV export.
- Added system-control settings and a global Download Data button for users with backup access.
- Added creator metadata to sales, purchases, returns, expenses and repair jobs where records are created in this client.
- Bumped the service-worker cache to V42 to reduce stale app files after deployment.

Validation performed: Node syntax checks for app.js, server.js, and service-worker.js; ZIP integrity check. A full end-to-end browser test against the user's Railway deployment was not possible from this environment.
