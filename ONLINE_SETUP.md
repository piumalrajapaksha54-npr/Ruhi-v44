# RUHI MOBILE — Online Setup (V38)

This version keeps the existing UI/business logic but adds authenticated server-side cloud data storage so the same business data can be opened from multiple devices through the hosted URL.

## Local test
1. Install Node.js 18+.
2. Open this folder in CMD/Terminal.
3. Run `npm start`.
4. Open `http://localhost:8787`.
5. Login with `admin / admin` on a fresh data folder.

## Hosting
Use a Node.js host that supports a persistent disk/volume mounted at `/app/server-data` (Render paid Starter with the included `render.yaml`, or another VPS/container host with persistent storage).

The server listens on `0.0.0.0` and uses the host's `PORT` environment variable.

## Important security
Change the default admin password immediately after first login. The current app uses scrypt password hashes and bearer sessions. For internet production, put the app behind HTTPS and use a persistent server volume/database. Do not expose port 8787 directly without HTTPS/reverse proxy.

## Multi-device behavior
- Login loads the shared business data from the server.
- Changes are automatically uploaded after saves.
- If another device changed the business data first, the app reloads the latest server copy rather than silently overwriting it.
- Browser localStorage remains as a local fallback/cache.
