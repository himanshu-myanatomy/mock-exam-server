# Mock Exam Platform

Small **React + Vite** app that acts like a minimal LMS: sign in, **Start test**, then talk to **`ma-proctoring-backend` (seb-server)** to register a launch and download the **`.mapr`** file for **MA Proctoring**. This UI is for integration testing only.

**Scope:** The browser app calls **only** the LMS integration endpoints below. It does **not** implement mobile (secondary camera) proctoring — that lives in **ma-proctoring-frontend** at `/mobile-proctor/:launchTicketId`. Configure seb-server **`PUBLIC_FRONTEND_URL`** (and local **`PUBLIC_FRONTEND_PORT`** if needed) so `mobileProctorUrl` / QR codes from register-launch point at the proctoring frontend, not this mock (default dev port **5173**).

---

## Backend APIs used by this repo

### Browser app (`src/App.jsx`)

| Method | Path | Role |
|--------|------|------|
| `POST` | `/api/v1/register-launch` | Creates launch ticket; JSON body (see below). |
| `GET` | `/api/v1/org-config/:accessToken?…` | Triggers **`.mapr`** download via navigation (`<a href>`). URL is usually `orgConfigUrl` from the register-launch response, or built with `launchTicketId` + `clientAssessmentId` query params, or the bare org-config URL as a manual fallback. |

**`POST /api/v1/register-launch` body** (fields the form sends):

| Field | Required | Notes |
|--------|----------|--------|
| `email` | Yes | Candidate email. |
| `accessToken` | Yes | Org tenant token (`companies.accessToken`), not the literal string `none` unless your test org uses it. |
| `launchUrl` | Yes | Attempt-specific deep link (often your `/exam?token=…` or production LMS URL). |
| `clientAssessmentId` | Yes | Opaque catalog id; must match the exam row in seb-server for this org. |
| `assessmentName` | Yes | Display title; must match configured assessment name in seb-server. |
| `assessmentType` | Yes | `TEST` or `INTERVIEW` (wired from the form). |
| `securityTemplate` | Yes | `standard` or `strict` (strict enables required mobile proctoring in product flows). |

Optional fields exist on the backend (e.g. `subscriptionPlan`); see **ma-proctoring-backend** `src/controllers/v1/seb-register-launch/`.

**Successful response (typical fields the UI uses):** `ok`, `orgConfigUrl`, `launchTicketId`, `proctoring.required`, `proctoring.mobileProctorUrl`, `proctoring.qrText`, error objects on failure (`error`, `hint`, …).

**Auth:** None on these routes — identification is via `accessToken` in the JSON body and org-config path segment.

---

## Local setup

1. Run **seb-server** (default `http://localhost:4000`).
2. In this repo:

```bash
npm install
npm run dev
```

3. Open **http://localhost:5173**, fill the form, accept consent, click **Start test**.

**Config:** At minimum set **`VITE_SEB_SERVER_URL`** if the API is not local. Vite only exposes variables prefixed with **`VITE_`**. Optional defaults: `VITE_ACCESS_TOKEN`, `VITE_LAUNCH_URL`, `VITE_CLIENT_ASSESSMENT_ID`, `VITE_ASSESSMENT_NAME`, `VITE_SECURITY_TEMPLATE`, `VITE_ASSESSMENT_TYPE` (see `src/App.jsx`).

## Deploy (Vercel)

Import the repo, set **`VITE_SEB_SERVER_URL`** (and other `VITE_*` vars) in the Vercel project. Ensure **`seb-server`** allows requests from your deploy origin (**CORS** if the API is on another host). SPA fallback uses **`vercel.json`**.

## Troubleshooting

- **Nothing downloads / errors:** Confirm `VITE_SEB_SERVER_URL` and network; check seb-server logs.
- **Port 5173 busy:** Vite may use **`strictPort: true`** — free the port or set **`VITE_PORT`** in env if your setup supports it.

## Project layout

```
src/           Mock LMS UI — register-launch + org-config download, /exam placeholder (JWT decode demo only)
vite.config.js
vercel.json
```
