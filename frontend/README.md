# Frontend — YouTube Sermon Summarizer

A single-page React app (built with Vite): paste a YouTube URL, click Generate,
and the article from the backend's `/summarize` endpoint renders below.

## Setup

```bash
cd frontend
npm install
cp .env.example .env   # optional — override VITE_API_BASE_URL if the backend
                       # isn't on http://localhost:8000
```

## Run

```bash
cd frontend
npm run dev
```

Vite serves the app on `http://localhost:5173` (the origin the backend's CORS
allows by default). The backend must be running for Generate to work — see
`../backend/README.md`.

## Build

```bash
npm run build      # outputs static files to dist/
npm run preview    # serve the production build locally
```

## Tests

```bash
npm test           # run the Vitest suite once
npm run test:watch # re-run on change
```

Tests use Vitest + React Testing Library (jsdom), with `fetch` mocked (no
network). They cover the heading, the form lifecycle (loading/disabled), success
rendering, and the error paths — backend error, network failure, timeout,
malformed success payload, and the double-submit guard.

## Lint

```bash
npm run lint       # ESLint (flat config) over src/
```

## Requirements

Node `^20.19.0 || >=22.12.0` (pinned in `package.json` `engines`, matching the
Vite 8 toolchain).

## Fonts

The UI uses **Fraunces** (serif display) and **Inter** (sans body), self-hosted
via [`@fontsource`](https://fontsource.org/) and imported in `src/main.jsx`.
They're bundled into `dist/` at build time, so there are **no third-party font
requests** — the app renders identically offline and under a strict CSP.

## Deploy (Vercel)

The frontend deploys to Vercel from the **same repo** as the backend — point
the project at the `frontend/` subdirectory.

1. New Vercel project → import this GitHub repo.
2. Set **Root Directory = `frontend`**. Vercel auto-detects the Vite preset
   (build `npm run build`, output `dist/`).
3. Add the environment variable **`VITE_API_BASE_URL`** = your deployed backend
   URL (e.g. `https://your-backend.up.railway.app`). It's baked in at build
   time, so redeploy after changing it.
4. Back on the backend, set `ALLOWED_ORIGINS` to this app's Vercel URL so CORS
   permits the calls.

> Optional: set an "Ignored Build Step" so Vercel only rebuilds when `frontend/`
> changed, not on backend-only commits.
