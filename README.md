# Mock Exam Platform

Small **React + Vite** app that acts like a minimal LMS: sign in, **Start test**, then talk to **`seb-server`** to register a launch and download the **`.seb`** file for **MA Proctoring**. The real backend is **`seb-server`**; this UI is for integration testing.

## Local setup

1. Run **`seb-server`** (default `http://localhost:4000`).
2. In this repo:

```bash
npm install
npm run dev
```

3. Open **http://localhost:5173**, fill the form, accept consent, click **Start test**.

**Config:** set env vars your team uses (at least `VITE_SEB_SERVER_URL` if not local). Prefix **`VITE_`** is required for Vite to expose values to the browser.

## Optional checks

With **`seb-server`** running: `npm run verify:flow` (full register → OAuth → handshake → configuration chain).

## Deploy (Vercel)

Import the repo, set **`VITE_SEB_SERVER_URL`** (and other `VITE_*` vars) in the Vercel project. Ensure **`seb-server`** allows requests from your Vercel URL (CORS if needed). SPA routing uses `vercel.json`.

## Troubleshooting

- **Nothing downloads / errors:** confirm `seb-server` URL is correct and reachable from the browser; check its logs.
- **Port 5173 busy:** Vite is configured with `strictPort: true` — free the port or change `VITE_PORT` in env.

## Project layout

```
src/           App UI (start flow, /exam, mobile proctor route)
scripts/       verify-seb-flow.mjs
vite.config.js
vercel.json
```
