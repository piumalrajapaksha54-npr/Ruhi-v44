# RUHI MOBILE V39 — Railway persistent data

This version fixes the online-save problem caused by Railway's ephemeral filesystem. Business data (customers, suppliers, products, sales, purchases, returns, accounts, etc.) is stored in PostgreSQL when `DATABASE_URL` is present.

## Railway setup
1. Keep your existing Ruhi Mobile service.
2. In the Railway project, click **New** → **Database** → **Add PostgreSQL**.
3. Open the PostgreSQL service and confirm it is running.
4. Open your **Ruhi Mobile web service** → **Variables**.
5. Add/link the PostgreSQL `DATABASE_URL` variable. Railway normally offers **Add Reference** / **Reference Variable**; choose the PostgreSQL service's `DATABASE_URL`.
6. Deploy/redeploy the Ruhi Mobile service.
7. Open the app URL and login. Add a test customer. Refresh the page, logout/login, and open the app from another device. The customer should remain.

### Important
Do not use only JSON files for production Railway storage. Railway containers can restart/redeploy and their local filesystem is not a reliable permanent database. PostgreSQL is the persistent store used by V39.

### Local use
If `DATABASE_URL` is not set, V39 falls back to `server-data/business-data.json` so the app still works locally.
