"""YouTube Sermon Summarizer — FastAPI backend.

Entry point for the API server. Exposes a health check and a /transcript
route; the /summarize endpoint arrives in a later issue.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from transcript import TranscriptError, fetch_transcript
from utils import extract_video_id

app = FastAPI(title="YouTube Sermon Summarizer")


class TranscriptRequest(BaseModel):
    """Request body for /transcript — a single YouTube URL."""

    url: str


@app.get("/health")
def health():
    """Liveness check — confirms the server is up and responding."""
    return {"status": "ok"}


@app.post("/transcript")
def transcript(request: TranscriptRequest):
    """Fetch the full transcript text for a YouTube URL.

    Primarily a development/debug route; the shipped app uses /summarize,
    which calls the same fetch logic internally.
    """
    try:
        video_id = extract_video_id(request.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        text = fetch_transcript(video_id)
    except TranscriptError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    return {"transcript": text}
