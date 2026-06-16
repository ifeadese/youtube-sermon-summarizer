"""YouTube Sermon Summarizer — FastAPI backend.

Entry point for the API server. Exposes a health check, a /transcript route
(dev/debug), and /summarize — the main endpoint that turns a YouTube URL into a
finished article in one call.
"""

import logging
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from summarizer import generate_article
from transcript import TranscriptError, fetch_transcript
from utils import extract_video_id

# Load backend/.env for local `uvicorn main:app` runs, anchored to this file's
# directory so it works regardless of the current working directory. In
# production the host (e.g. Railway) sets real env vars and there is no .env
# file, so this is a no-op.
load_dotenv(Path(__file__).resolve().parent / ".env")

# Ensure app log records (e.g. transcript failure warnings) reliably surface in
# the host's stdout with a consistent format, rather than relying on Python's
# last-resort handler. No-op if logging is already configured (e.g. by uvicorn).
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")

app = FastAPI(title="YouTube Sermon Summarizer")

# Which frontend origins may call this API. Defaults to the local dev servers
# (Vite 5173, CRA 3000); override with ALLOWED_ORIGINS (comma-separated) at
# deploy time — no production URL is hardcoded here.
# `or` (not the get() default) so an empty ALLOWED_ORIGINS="" falls back to the
# dev defaults instead of silently blocking every browser origin.
_origins = os.environ.get("ALLOWED_ORIGINS") or "http://localhost:5173,http://localhost:3000"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class URLRequest(BaseModel):
    """Request body for /transcript and /summarize — a single YouTube URL."""

    url: str


@app.get("/health")
def health():
    """Liveness check — confirms the server is up and responding."""
    return {"status": "ok"}


@app.post("/transcript")
def transcript(request: URLRequest):
    """Fetch the full transcript text for a YouTube URL.

    Primarily a development/debug route; the shipped app uses /summarize,
    which calls the same fetch logic internally.
    """
    video_id = _video_id_or_400(request.url)
    try:
        text = fetch_transcript(video_id)
    except TranscriptError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return {"transcript": text}


@app.post("/summarize")
def summarize(request: URLRequest):
    """The main endpoint: YouTube URL → transcript → Claude → finished article."""
    video_id = _video_id_or_400(request.url)

    try:
        transcript_text = fetch_transcript(video_id)
    except TranscriptError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    try:
        article = generate_article(transcript_text)
    except ValueError as exc:
        # Empty/truncated model output — unusable result from the AI step.
        raise HTTPException(status_code=502, detail=f"Article generation failed: {exc}")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="The AI service is rate-limited. Try again shortly.")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=503, detail="Could not reach the AI service. Try again.")
    except anthropic.APIStatusError:
        raise HTTPException(status_code=502, detail="The AI service returned an error. Try again.")
    except anthropic.APIError:
        # Catch-all for any other Anthropic error (e.g. APIResponseValidationError)
        # so no AI-step failure escapes as an unhandled 500. Must come last —
        # APIError is the base class. Issue #11 refines this mapping.
        raise HTTPException(status_code=502, detail="The AI service returned an unexpected response. Try again.")

    return {"article": article}


def _video_id_or_400(url: str) -> str:
    """Validate a URL and return its video ID, or raise HTTP 400."""
    try:
        return extract_video_id(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
