"""YouTube Sermon Summarizer — FastAPI backend.

Entry point for the API server. For now it exposes a single health-check
route; transcript and summarize endpoints arrive in later issues.
"""

from fastapi import FastAPI

app = FastAPI(title="YouTube Sermon Summarizer")


@app.get("/health")
def health():
    """Liveness check — confirms the server is up and responding."""
    return {"status": "ok"}
