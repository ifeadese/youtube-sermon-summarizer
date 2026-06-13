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
