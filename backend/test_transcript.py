"""Tests for fetch_transcript + the /transcript route.

The only network call (`YouTubeTranscriptApi().fetch`) is monkeypatched, so
these run deterministically with no real YouTube traffic.

Run standalone:  python test_transcript.py
Or with pytest:  pytest test_transcript.py
"""

import os
from types import SimpleNamespace

import requests
from fastapi import HTTPException

import transcript as t_mod
from main import URLRequest, transcript as transcript_route
from transcript import TranscriptError, fetch_transcript
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig
from youtube_transcript_api import (
    AgeRestricted,
    CouldNotRetrieveTranscript,
    InvalidVideoId,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
)

VID = "dQw4w9WgXcQ"
VALID_URL = "https://youtu.be/dQw4w9WgXcQ"

# Library exception (or transport error) → expected HTTP status from fetch_transcript.
EXCEPTION_STATUS = [
    (VideoUnavailable(VID), 403),
    (VideoUnplayable(VID, "reason", []), 403),
    (AgeRestricted(VID), 403),
    (TranscriptsDisabled(VID), 404),
    (NoTranscriptFound(VID, ["en"], []), 404),
    (RequestBlocked(VID), 503),
    (IpBlocked(VID), 503),
    (InvalidVideoId(VID), 400),
    (CouldNotRetrieveTranscript(VID), 502),
    (requests.exceptions.ConnectionError("boom"), 503),
    (requests.exceptions.Timeout("slow"), 503),
]

# A few exact-message contracts (substring match) that callers/users rely on.
MESSAGE_CONTAINS = [
    (NoTranscriptFound(VID, ["en"], []), "English"),
    (AgeRestricted(VID), "age-restricted"),
    (TranscriptsDisabled(VID), "No transcript available"),
    (VideoUnavailable(VID), "private or unavailable"),
]


def _install_fetch(func):
    """Patch YouTubeTranscriptApi so the per-call instance's .fetch is `func`.

    Returns the original class so the caller can restore it.
    """
    original = t_mod.YouTubeTranscriptApi

    class _FakeApi:
        def __init__(self, proxy_config=None):
            self.proxy_config = proxy_config

        def fetch(self, video_id, languages=None):
            return func(video_id, languages=languages)

    t_mod.YouTubeTranscriptApi = _FakeApi
    return original


def _raises(exc):
    def _fetch(video_id, languages=None):
        raise exc
    return _fetch


def _snippets(*texts):
    return [SimpleNamespace(text=t) for t in texts]


def test_fetch_joins_snippet_text():
    original = _install_fetch(lambda v, languages=None: _snippets("Hello", "there", "world"))
    try:
        assert fetch_transcript(VID) == "Hello there world"
    finally:
        t_mod.YouTubeTranscriptApi = original


def test_fetch_requests_english_only():
    seen = {}

    def _fetch(video_id, languages=None):
        seen["languages"] = languages
        return _snippets("hi")

    original = _install_fetch(_fetch)
    try:
        fetch_transcript(VID)
        assert seen["languages"] == ["en"], f"expected ['en'], got {seen['languages']!r}"
    finally:
        t_mod.YouTubeTranscriptApi = original


def test_fetch_maps_exceptions_to_status():
    for exc, expected_status in EXCEPTION_STATUS:
        original = _install_fetch(_raises(exc))
        try:
            fetch_transcript(VID)
        except TranscriptError as err:
            assert err.status_code == expected_status, (
                f"{type(exc).__name__}: got {err.status_code}, expected {expected_status}"
            )
            assert err.detail, "TranscriptError should carry a friendly message"
        else:
            raise AssertionError(f"{type(exc).__name__}: expected TranscriptError")
        finally:
            t_mod.YouTubeTranscriptApi = original


def test_fetch_error_messages_are_specific():
    for exc, needle in MESSAGE_CONTAINS:
        original = _install_fetch(_raises(exc))
        try:
            fetch_transcript(VID)
        except TranscriptError as err:
            assert needle in err.detail, f"{type(exc).__name__}: {needle!r} not in {err.detail!r}"
        else:
            raise AssertionError(f"{type(exc).__name__}: expected TranscriptError")
        finally:
            t_mod.YouTubeTranscriptApi = original


def test_fetch_empty_transcript_is_404():
    for empty in (_snippets(), _snippets("", "   ")):
        original = _install_fetch(lambda v, languages=None, _e=empty: _e)
        try:
            fetch_transcript(VID)
        except TranscriptError as err:
            assert err.status_code == 404
        else:
            raise AssertionError("expected TranscriptError 404 for empty transcript")
        finally:
            t_mod.YouTubeTranscriptApi = original


def test_route_returns_transcript_on_success():
    original = _install_fetch(lambda v, languages=None: _snippets("a", "b"))
    try:
        assert transcript_route(URLRequest(url=VALID_URL)) == {"transcript": "a b"}
    finally:
        t_mod.YouTubeTranscriptApi = original


def test_route_invalid_url_is_400():
    try:
        transcript_route(URLRequest(url="not a youtube link"))
    except HTTPException as err:
        assert err.status_code == 400
    else:
        raise AssertionError("expected HTTPException 400 for invalid URL")


_PROXY_ENV_KEYS = (
    "WEBSHARE_PROXY_USERNAME",
    "WEBSHARE_PROXY_PASSWORD",
    "PROXY_HTTP_URL",
    "PROXY_HTTPS_URL",
)


def _with_env(**values):
    """Set the given env vars (others among the proxy keys cleared); returns a
    restore() to put the environment back. Keeps the standalone runner working
    without pytest fixtures."""
    saved = {k: os.environ.get(k) for k in _PROXY_ENV_KEYS}
    for k in _PROXY_ENV_KEYS:
        os.environ.pop(k, None)
    for k, v in values.items():
        os.environ[k] = v

    def restore():
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    return restore


def test_proxy_config_none_when_unset():
    restore = _with_env()
    try:
        assert t_mod._proxy_config() is None
    finally:
        restore()


def test_proxy_config_webshare_when_creds_set():
    restore = _with_env(WEBSHARE_PROXY_USERNAME="u", WEBSHARE_PROXY_PASSWORD="p")
    try:
        assert isinstance(t_mod._proxy_config(), WebshareProxyConfig)
    finally:
        restore()


def test_proxy_config_generic_when_url_set():
    restore = _with_env(PROXY_HTTP_URL="http://user:pass@proxy.example.com:8080")
    try:
        assert isinstance(t_mod._proxy_config(), GenericProxyConfig)
    finally:
        restore()


def test_proxy_config_is_forwarded_to_the_client():
    """fetch_transcript must pass _proxy_config()'s result into the API client."""
    captured = {}

    class _RecordingApi:
        def __init__(self, proxy_config=None):
            captured["proxy_config"] = proxy_config

        def fetch(self, video_id, languages=None):
            return _snippets("hi")

    original_cls = t_mod.YouTubeTranscriptApi
    restore_env = _with_env(WEBSHARE_PROXY_USERNAME="u", WEBSHARE_PROXY_PASSWORD="p")
    t_mod.YouTubeTranscriptApi = _RecordingApi
    try:
        fetch_transcript(VID)
        assert isinstance(captured["proxy_config"], WebshareProxyConfig)
    finally:
        t_mod.YouTubeTranscriptApi = original_cls
        restore_env()


def test_opaque_failure_is_logged():
    """A blocked/transport failure must log the real cause (not just 503)."""
    recorded = []

    class _FakeLogger:
        def warning(self, *args, **kwargs):
            recorded.append(args)

    orig_logger = t_mod.logger
    orig_cls = _install_fetch(_raises(RequestBlocked(VID)))
    t_mod.logger = _FakeLogger()
    try:
        try:
            fetch_transcript(VID)
        except TranscriptError:
            pass
        assert recorded, "expected a warning log when a transcript fetch is blocked"
        # the video id should be in the logged args for traceability
        assert any(VID in a for a in recorded[0] if isinstance(a, str))
    finally:
        t_mod.YouTubeTranscriptApi = orig_cls
        t_mod.logger = orig_logger


def test_route_propagates_transcript_error_status():
    original = _install_fetch(_raises(TranscriptsDisabled(VID)))
    try:
        transcript_route(URLRequest(url=VALID_URL))
    except HTTPException as err:
        assert err.status_code == 404
    else:
        raise AssertionError("expected HTTPException 404")
    finally:
        t_mod.YouTubeTranscriptApi = original


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS  {t.__name__}")
    print(f"\nAll {len(tests)} tests passed.")
