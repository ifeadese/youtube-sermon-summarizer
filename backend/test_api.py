"""HTTP-contract tests for the API, driven through FastAPI's TestClient.

Unlike test_transcript.py (which calls the route function directly), these
exercise the real request/response stack: body parsing, Pydantic validation,
status codes, and the JSON error envelope. Network is mocked via the
`monkeypatch` fixture (auto-restored, safe under parallel runs).

Requires the dev dependencies:  pip install -r requirements-dev.txt
Run with:  pytest test_api.py
"""

from types import SimpleNamespace

from fastapi.testclient import TestClient

import summarizer as sum_mod
import transcript as t_mod
from main import app
from youtube_transcript_api import TranscriptsDisabled

client = TestClient(app)

VALID_URL = "https://youtu.be/dQw4w9WgXcQ"
VID = "dQw4w9WgXcQ"


def _fake_api(*, snippets=None, raises=None):
    """Build a stand-in YouTubeTranscriptApi class whose .fetch is controlled."""

    class _FakeApi:
        def fetch(self, video_id, languages=None):
            if raises is not None:
                raise raises
            return snippets or []

    return _FakeApi


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_transcript_success_envelope(monkeypatch):
    monkeypatch.setattr(
        t_mod, "YouTubeTranscriptApi",
        _fake_api(snippets=[SimpleNamespace(text="hello"), SimpleNamespace(text="world")]),
    )
    resp = client.post("/transcript", json={"url": VALID_URL})
    assert resp.status_code == 200
    assert resp.json() == {"transcript": "hello world"}


def test_transcript_invalid_url_400(monkeypatch):
    # extract_video_id rejects before any fetch; no network seam needed.
    resp = client.post("/transcript", json={"url": "not a youtube link"})
    assert resp.status_code == 400
    assert "detail" in resp.json()


def test_transcript_missing_field_422():
    resp = client.post("/transcript", json={})
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "url"]


def test_transcript_malformed_json_422():
    resp = client.post(
        "/transcript",
        content="this is not json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_transcript_mapped_error_is_serialized(monkeypatch):
    monkeypatch.setattr(
        t_mod, "YouTubeTranscriptApi", _fake_api(raises=TranscriptsDisabled(VID))
    )
    resp = client.post("/transcript", json={"url": VALID_URL})
    assert resp.status_code == 404
    body = resp.json()
    assert body == {"detail": "No transcript available for this video."}


# ---- /summarize (the main endpoint: URL -> transcript -> Claude -> article) ----
# Both network steps are mocked: the transcript fetch and the Claude call.

def _fake_claude(article, *, stop_reason="end_turn"):
    """Patch summarizer._get_client with a fake that returns `article`."""

    class _Msgs:
        def create(self, **kwargs):
            return SimpleNamespace(
                content=[SimpleNamespace(type="text", text=article)],
                stop_reason=stop_reason,
            )

    class _Client:
        messages = _Msgs()

    return lambda: _Client()


def test_summarize_success(monkeypatch):
    monkeypatch.setattr(
        t_mod, "YouTubeTranscriptApi",
        _fake_api(snippets=[SimpleNamespace(text="The blessing of Abraham.")]),
    )
    monkeypatch.setattr(sum_mod, "_get_client", _fake_claude("My Title\n\nA fine article."))
    resp = client.post("/summarize", json={"url": VALID_URL})
    assert resp.status_code == 200
    assert resp.json() == {"article": "My Title\n\nA fine article."}


def test_summarize_invalid_url_400():
    resp = client.post("/summarize", json={"url": "not a youtube link"})
    assert resp.status_code == 400


def test_summarize_missing_field_422():
    resp = client.post("/summarize", json={})
    assert resp.status_code == 422


def test_summarize_transcript_error_404(monkeypatch):
    monkeypatch.setattr(
        t_mod, "YouTubeTranscriptApi", _fake_api(raises=TranscriptsDisabled(VID))
    )
    resp = client.post("/summarize", json={"url": VALID_URL})
    assert resp.status_code == 404


def test_summarize_truncated_article_502(monkeypatch):
    # Claude hits the output cap → generate_article raises → 502, not a partial 200.
    monkeypatch.setattr(
        t_mod, "YouTubeTranscriptApi",
        _fake_api(snippets=[SimpleNamespace(text="some sermon content")]),
    )
    monkeypatch.setattr(sum_mod, "_get_client", _fake_claude("cut off mid-", stop_reason="max_tokens"))
    resp = client.post("/summarize", json={"url": VALID_URL})
    assert resp.status_code == 502
