"""Fetch YouTube transcripts via youtube-transcript-api.

The library raises a dozen different exception types (and can let raw
`requests` transport errors through). This module wraps them all into a single
`TranscriptError` carrying an HTTP status code + a friendly, user-facing
message, so the API routes don't need to know the library's internals. The
transcript and summarize endpoints both reuse `fetch_transcript`.
"""

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


class TranscriptError(Exception):
    """A transcript fetch failure with an HTTP status code and friendly detail."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def fetch_transcript(video_id: str) -> str:
    """Return the full English transcript text for a YouTube video ID.

    Targets English captions (manual or auto-generated). Raises TranscriptError
    (with `status_code` + `detail`) on any failure. Makes a network call.
    """
    try:
        # A fresh client per call: YouTubeTranscriptApi owns a requests.Session
        # and is explicitly *not* thread-safe, while FastAPI runs sync routes in
        # a threadpool. The per-call cost is negligible at pilot volume.
        fetched = YouTubeTranscriptApi().fetch(video_id, languages=["en"])
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
    except RequestBlocked:  # also covers IpBlocked (a subclass)
        raise TranscriptError(
            503,
            "Transcript service is temporarily unavailable (YouTube blocked the "
            "request). This usually means a proxy is needed in production — try again later.",
        )
    except InvalidVideoId:
        raise TranscriptError(400, "That doesn't look like a valid YouTube video.")
    except CouldNotRetrieveTranscript:  # catch-all for remaining library errors
        raise TranscriptError(502, "Could not retrieve the transcript for this video.")
    except requests.exceptions.RequestException:
        # Transport-level failure (DNS, timeout, connection reset) raised by the
        # underlying session before any HTTP response — the library does not wrap these.
        raise TranscriptError(503, "Could not reach YouTube to fetch the transcript. Try again later.")

    text = " ".join(snippet.text for snippet in fetched).strip()
    if not text:
        raise TranscriptError(404, "The transcript for this video is empty.")
    return text
