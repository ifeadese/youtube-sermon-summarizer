# Frontend — YouTube Sermon Summarizer

A single-page React app (built with Vite). Currently the app shell; the input
form and API wiring arrive in Issue #9.

## Setup

```bash
cd frontend
npm install
```

## Run

```bash
cd frontend
npm run dev
```

Vite serves the app on `http://localhost:5173` (the origin the backend's CORS
allows by default).

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

Tests use Vitest + React Testing Library (jsdom). The current smoke test asserts
the app heading renders; component tests grow alongside the UI in Issue #9.

## Lint

```bash
npm run lint       # ESLint (flat config) over src/
```

## Requirements

Node `^20.19.0 || >=22.12.0` (pinned in `package.json` `engines`, matching the
Vite 8 toolchain).
