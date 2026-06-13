# Backend — YouTube Sermon Summarizer

FastAPI server for the sermon summarizer. All commands below are run **from this `backend/` directory.**

## Onboarding (first-time setup)

Do all of this **on your own machine, with your own Anthropic account.**

1. **Prerequisites**
   - Python 3.11+ (the pinned deps are tested on **3.13**, which the deploy uses — see `.python-version`)
   - A personal Anthropic developer-API account with **prepaid credits** loaded
     ([console.anthropic.com](https://console.anthropic.com)) — this is the
     pay-as-you-go API, **not** a Claude.ai Pro/Max chat subscription. A key with
     zero credits fails on the first call with a billing error.

2. **Install**
   ```bash
   cd backend
   python3 -m venv venv
   ./venv/bin/pip install -r requirements.txt
   ```

3. **Add your API key**
   ```bash
   cp .env.example .env
   # open .env and paste your key after ANTHROPIC_API_KEY=
   ```

   > ⚠️ **Add your key locally, here, only.** Paste it directly into `.env` on
   > your own machine. **Never** paste an API key into a chat, an AI assistant
   > session, a screen share, a ticket, or anywhere it could be logged or
   > transmitted — a key sent through any such channel should be considered
   > leaked and rotated. `.env` is gitignored so it is never committed; that
   > protects against git, not against pasting the key somewhere it travels.
   > Keep personal and work/employer credentials separate.

4. **Verify it works** (makes one real, billed call)
   ```bash
   ./venv/bin/python generate_article_demo.py "https://www.youtube.com/watch?v=VIDEO_ID"
   ```

The rest of this README documents the individual commands.

## Setup

```bash
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

## Run

```bash
cd backend
./venv/bin/uvicorn main:app --reload
```

The server starts on `http://localhost:8000`.

## Verify

```bash
curl http://localhost:8000/health
# → {"status": "ok"}
```

## Endpoints

| Method | Path         | Description                                  |
|--------|--------------|----------------------------------------------|
| GET    | `/health`    | Liveness check — returns `{"status": "ok"}`  |
| POST   | `/transcript`| Body `{"url": "<youtube-url>"}` → `{"transcript": "..."}` (dev/debug) |
| POST   | `/summarize` | Body `{"url": "<youtube-url>"}` → `{"article": "..."}` — the main endpoint |

`/summarize` runs the full pipeline (URL → transcript → Claude → article) and
needs `ANTHROPIC_API_KEY` set (see Onboarding). CORS allows `localhost:5173`
and `localhost:3000` by default; override with the `ALLOWED_ORIGINS` env var
(comma-separated) at deploy time.

## Generating an article (your own key)

The article generator reads `ANTHROPIC_API_KEY` from a local `.env`. Nothing is
hardcoded — bring your own personal key (the developer API from
[console.anthropic.com](https://console.anthropic.com), **not** a Claude.ai
Pro/Max subscription).

```bash
cd backend
cp .env.example .env          # then edit .env and paste your key
./venv/bin/pip install -r requirements.txt

# End-to-end: URL -> transcript -> Claude -> article (makes a real, billed call)
./venv/bin/python generate_article_demo.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

## Tests

```bash
cd backend
./venv/bin/pip install -r requirements-dev.txt   # pytest + httpx (test-only)
./venv/bin/pytest                                # runs the full suite
```

The pure-logic tests also run without pytest: `python test_utils.py`,
`python test_transcript.py`. The HTTP-contract tests (`test_api.py`) need
pytest + httpx.

## Dependencies

Two files, mirroring the frontend's `package.json` + `package-lock.json`:

- **`requirements.txt`** — the human-readable manifest: the direct runtime deps,
  each pinned to an exact version. Edit this when adding/bumping a dep.
- **`requirements.lock`** — a full freeze (direct **and** transitive deps) for a
  reproducible install. The deploy build installs from this so transitive
  versions can't drift between environments. Generated, not hand-edited.

**To change a dependency:** edit `requirements.txt`, then regenerate the lock:

```bash
python3 -m venv /tmp/lock
/tmp/lock/bin/pip install -r requirements.txt
/tmp/lock/bin/pip freeze --exclude-editable > requirements.lock
```

Local dev installing `requirements.txt` is fine; use `requirements.lock` when
you need the exact reproducible set (CI / debugging an env-specific issue).

## Deploy (Railway)

The frontend deploys to Vercel; the backend deploys to Railway from the **same
repo** — point the service at the `backend/` subdirectory.

1. New Railway project → Deploy from this GitHub repo.
2. In the service settings, set **Root Directory = `backend`**. `nixpacks.toml`
   pins the install step to **`pip install -r requirements.lock`** (the fully
   reproducible set) and the `Procfile` starts it with
   `uvicorn main:app --host 0.0.0.0 --port $PORT`.
3. Set the environment variables below, then deploy. The public URL Railway
   gives you is what you put in the frontend's `VITE_API_BASE_URL`.

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | **Yes** | Your Anthropic developer key (the `/summarize` Claude call). |
| `ALLOWED_ORIGINS` | **Yes (prod)** | Comma-separated frontend origins, e.g. `https://your-app.vercel.app`. Without it, the browser blocks the deployed frontend. |
| `WEBSHARE_PROXY_USERNAME` + `WEBSHARE_PROXY_PASSWORD` | **Yes for transcripts** | Residential proxy creds. YouTube blocks transcript fetches from datacenter IPs, so without a proxy the deployed backend can fetch nothing. (Alternatively `PROXY_HTTP_URL` / `PROXY_HTTPS_URL` for a generic proxy.) Off by default — no proxy is used locally. |

> The proxy is the one non-obvious production requirement: it works on your
> laptop (residential IP) without one, but **will fail in the cloud** until you
> add proxy creds. See PLAN.md → Known Risks.
