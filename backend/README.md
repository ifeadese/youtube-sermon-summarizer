# Backend — YouTube Sermon Summarizer

FastAPI server for the sermon summarizer. All commands below are run **from this `backend/` directory.**

## Onboarding (first-time setup)

Do all of this **on your own machine, with your own Anthropic account.**

1. **Prerequisites**
   - Python 3.11+
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
| POST   | `/transcript`| Body `{"url": "<youtube-url>"}` → `{"transcript": "..."}` |

_The summarize endpoint arrives in a later issue (#7). The article generator
(`generate_article`) exists now but isn't wired to a route yet._

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
