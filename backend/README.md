# Backend — YouTube Sermon Summarizer

FastAPI server for the sermon summarizer. All commands below are run **from this `backend/` directory.**

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

_The summarize endpoint arrives in a later issue (#7)._

## Tests

```bash
cd backend
./venv/bin/pip install -r requirements-dev.txt   # pytest + httpx (test-only)
./venv/bin/pytest                                # runs the full suite
```

The pure-logic tests also run without pytest: `python test_utils.py`,
`python test_transcript.py`. The HTTP-contract tests (`test_api.py`) need
pytest + httpx.
