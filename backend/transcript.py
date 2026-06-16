"""Fetch YouTube transcripts via youtube-transcript-api.

The library raises a dozen different exception types (and can let raw
`requests` transport errors through). This module wraps them all into a single
`TranscriptError` carrying an HTTP status code + a friendly, user-facing
message, so the API routes don't need to know the library's internals. The
transcript and summarize endpoints both reuse `fetch_transcript`.
"""

import logging
import os
import re

import requests

from youtube_transcript_api import (
    AgeRestricted,
    CouldNotRetrieveTranscript,
    InvalidVideoId,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
    YouTubeTranscriptApi,
)
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig

logger = logging.getLogger(__name__)

# Strip URL credentials (`//user:pass@host` -> `//***@host`) before logging an
# exception, so a malformed proxy URL can't leak proxy creds into the logs.
_USERINFO_RE = re.compile(r"(//)[^/@\s]+@")


def _redact(text: str) -> str:
    return _USERINFO_RE.sub(r"\1***@", text)


class TranscriptError(Exception):
    """A transcript fetch failure with an HTTP status code and friendly detail."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _proxy_config():
    """Build a proxy config from the environment, or None if none is set.

    YouTube blocks transcript requests from datacenter IPs, so production
    deployments need a residential proxy. This is off by default — local/
    residential dev needs no proxy — and activates only when the relevant env
    vars are present:

      - Webshare:  WEBSHARE_PROXY_USERNAME + WEBSHARE_PROXY_PASSWORD
      - Generic:   PROXY_HTTP_URL and/or PROXY_HTTPS_URL
    """
    ws_user = os.environ.get("WEBSHARE_PROXY_USERNAME")
    ws_pass = os.environ.get("WEBSHARE_PROXY_PASSWORD")
    if ws_user and ws_pass:
        return WebshareProxyConfig(proxy_username=ws_user, proxy_password=ws_pass)
    if bool(ws_user) != bool(ws_pass):
        # Only one of the pair set — almost certainly a misconfiguration. Warn
        # loudly; otherwise the proxy is silently skipped and transcript fetches
        # fail in prod with an opaque "blocked" error.
        logger.warning(
            "Partial Webshare proxy config: set BOTH WEBSHARE_PROXY_USERNAME and "
            "WEBSHARE_PROXY_PASSWORD. Proceeding without a proxy."
        )

    http_url = os.environ.get("PROXY_HTTP_URL")
    https_url = os.environ.get("PROXY_HTTPS_URL")
    if http_url or https_url:
        return GenericProxyConfig(http_url=http_url, https_url=https_url or http_url)

    return None


def fetch_transcript(video_id: str) -> str:
    """Return the full English transcript text for a YouTube video ID.

    Targets English captions (manual or auto-generated). Raises TranscriptError
    (with `status_code` + `detail`) on any failure. Makes a network call.
    """
    try:
        # A fresh client per call: YouTubeTranscriptApi owns a requests.Session
        # and is explicitly *not* thread-safe, while FastAPI runs sync routes in
        # a threadpool. The per-call cost is negligible at pilot volume.
        fetched = YouTubeTranscriptApi(proxy_config=_proxy_config()).fetch(
            video_id, languages=["en"]
        )
    except VideoUnavailable:
        raise TranscriptError(403, "This video is private or unavailable.")
    except VideoUnplayable:
        raise TranscriptError(403, "This video can't be played (it may be removed or region-locked).")
    except AgeRestricted:
        raise TranscriptError(403, "This video is age-restricted, so its transcript can't be accessed.")
    except TranscriptsDisabled:
        raise TranscriptError(404, "No transcript available for this video.")
    except NoTranscriptFound:
        raise TranscriptError(404, "No English transcript is available for this video.")
    except RequestBlocked as exc:  # also covers IpBlocked (a subclass)
        # Log the real cause: YouTube blocked the IP (usually: missing/invalid
        # proxy in prod, since datacenter IPs are blocked).
        logger.warning("Transcript blocked for %s (IP/proxy): %s", video_id, _redact(repr(exc)))
        raise TranscriptError(
            503,
            "Transcript service is temporarily unavailable (YouTube blocked the "
            "request). This usually means a proxy is needed in production — try again later.",
        )
    except InvalidVideoId:
        raise TranscriptError(400, "That doesn't look like a valid YouTube video.")
    except CouldNotRetrieveTranscript as exc:  # catch-all for remaining library errors
        logger.warning("Transcript retrieval failed for %s: %s", video_id, _redact(repr(exc)))
        raise TranscriptError(502, "Could not retrieve the transcript for this video.")
    except requests.exceptions.RequestException as exc:
        # Transport-level failure (proxy auth/connection error, DNS, timeout,
        # connection reset) raised by the underlying session before any HTTP
        # response — the library does not wrap these. This is the branch that
        # made the "mystery 503" opaque; log the real exception (e.g. a 407
        # ProxyError from bad proxy creds).
        logger.warning("Transcript transport error for %s (proxy/connection): %s", video_id, _redact(repr(exc)))
        raise TranscriptError(503, "Could not reach YouTube to fetch the transcript. Try again later.")

    text = " ".join(snippet.text for snippet in fetched).strip()
    if not text:
        raise TranscriptError(404, "The transcript for this video is empty.")
    return text
