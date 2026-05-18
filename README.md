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
| `featureWhitelist` | Optional | LMS-selected SEB feature grants (`enablePrintScreen`, `allowScreenSharing`, `allowMultipleDisplays`, `allowExternalWebcam`). |
| `applicationWhitelist` | Optional | Per-launch allowed process list (`Slack.exe`, `Brave.exe`, etc.). |
| `allowExternalInputDevices` | Optional | Per-launch bool override for external keyboard/mouse policy. |
| `requireWindowsLocationEnabled` | Optional | Per-launch bool override requiring Windows location access. |
| `interviewSebSettings` | Optional | Object with interview browsing controls (`allowNewBrowserTab`, `restrictNavigationToAllowlist`, `websiteAllowlist`). |

Optional fields exist on the backend (e.g. `subscriptionPlan`); see **ma-proctoring-backend** `src/controllers/v1/seb-register-launch/`.

**Successful response (typical fields the UI uses):** `ok`, `orgConfigUrl`, `launchTicketId`, `proctoring.required`, `proctoring.mobileProctorUrl`, `proctoring.qrText`, error objects on failure (`error`, `hint`, …).

### Register-launch request example

```json
{
  "email": "himanshu.patel2@myanatomy.in",
  "accessToken": "none-tu3k",
  "launchUrl": "https://www.google.com/",
  "clientAssessmentId": "none-d",
  "assessmentName": "Dirt Exam1",
  "assessmentType": "TEST",
  "securityTemplate": "standard",
  "featureWhitelist": [
    "enablePrintScreen",
    "allowScreenSharing",
    "allowMultipleDisplays",
    "allowExternalWebcam"
  ],
  "applicationWhitelist": [
    "chrome.exe",
    "brave.exe",
    "mongo.ex",
    "mongo.exe",
    "cursor.exe"
  ],
  "allowExternalInputDevices": true,
  "requireWindowsLocationEnabled": false,
  "interviewSebSettings": {
    "allowNewBrowserTab": false,
    "restrictNavigationToAllowlist": false,
    "websiteAllowlist": []
  }
}
```

### Register-launch success response example

```json
{
  "ok": true,
  "accessToken": "none-tu3k",
  "email": "himanshu.patel2@myanatomy.in",
  "launchUrl": "https://www.google.com/",
  "clientCatalogId": "none-d",
  "clientAssessmentId": "none-d",
  "assessmentName": "Dirt Exam1",
  "assessmentType": "TEST",
  "subscriptionPlan": null,
  "applicationWhitelist": [
    "chrome.exe",
    "brave.exe",
    "mongo.ex",
    "mongo.exe",
    "cursor.exe"
  ],
  "allowExternalInputDevices": true,
  "requireWindowsLocationEnabled": false,
  "interviewSebSettings": {
    "allowNewBrowserTab": false,
    "restrictNavigationToAllowlist": false,
    "websiteAllowlist": []
  },
  "featureWhitelist": [
    "enablePrintScreen",
    "allowScreenSharing",
    "allowMultipleDisplays",
    "allowExternalWebcam"
  ],
  "securityTemplate": "standard",
  "mobileCameraRecordingRequiredResolved": false,
  "mobileCameraRecordingRequiredSource": "none",
  "candidateToken": "ec8ec809-a998-4283-8b44-796d7b3a535c",
  "launchTicketId": "6a0acbe68d131b2ee8758a02",
  "expiresAt": "2026-05-18T08:35:54.010Z",
  "ttlSeconds": 900,
  "orgConfigUrl": "http://localhost:4000/api/v1/org-config/none-tu3k?clientAssessmentId=none-d&launchTicketId=6a0acbe68d131b2ee8758a02",
  "proctoring": {
    "required": false,
    "mobileProctorUrl": "http://localhost:5174/mobile-proctor/6a0acbe68d131b2ee8758a02",
    "qrText": "http://localhost:5174/mobile-proctor/6a0acbe68d131b2ee8758a02"
  }
}
```

### Register-launch error response examples

Validation / input error (HTTP `400`):

```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "Invalid request payload",
  "details": {
    "assessmentName": "assessmentName is required",
    "launchUrl": "launchUrl must be a valid URL"
  }
}
```

Domain/config mismatch error (HTTP `404` or `422`):

```json
{
  "ok": false,
  "error": "assessment_not_found",
  "message": "Assessment is not configured for this org",
  "hint": "Check clientAssessmentId and assessmentName mapping in backend service"
}
```

Unexpected server error (HTTP `500`):

```json
{
  "ok": false,
  "error": "internal_server_error",
  "message": "Failed to register launch",
  "hint": "Try again or contact support with request timestamp"
}
```

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

### Mock client webhook receiver (for completion push report testing)

This repo now includes a lightweight backend receiver that acts like a client API endpoint:

- `POST /webhook/completion-report` → receives completion report push payload
- `GET /webhook/completion-report/events` → list received events
- `GET /webhook/completion-report/events/:id` → view one event (full payload + headers)
- `DELETE /webhook/completion-report/events` → clear stored events
- `GET /health` → health check

Run it with:

```bash
npm run mock-server
```

Default URL: `http://localhost:8787/webhook/completion-report`

Optional env vars:

- `MOCK_CLIENT_SERVER_PORT` (default `8787`)
- `MOCK_CLIENT_SIGNING_SECRET` (if set, validates `X-MA-Signature`)
- `MOCK_CLIENT_MAX_EVENTS` (default `500`)

**Config:** At minimum set **`VITE_SEB_SERVER_URL`** if the API is not local. Vite only exposes variables prefixed with **`VITE_`**. Optional defaults: `VITE_ACCESS_TOKEN`, `VITE_LAUNCH_URL`, `VITE_CLIENT_ASSESSMENT_ID`, `VITE_ASSESSMENT_NAME`, `VITE_SECURITY_TEMPLATE`, `VITE_ASSESSMENT_TYPE`, `VITE_FEATURE_WHITELIST` (comma-separated keys), `VITE_APPLICATION_WHITELIST` (comma-separated process names; see `src/App.jsx`).

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
