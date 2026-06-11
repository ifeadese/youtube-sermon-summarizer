"""Utilities for parsing YouTube URLs.

Pure logic — no network calls. Used by the transcript endpoint to turn a
pasted YouTube link into the bare video ID that youtube-transcript-api needs.
"""

import re
from urllib.parse import parse_qs, urlparse

# YouTube video IDs are exactly 11 characters: letters, digits, hyphen, underscore.
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Path prefixes where the video ID is the segment right after the prefix,
# e.g. youtube.com/live/<id>, /embed/<id>, /shorts/<id>, /v/<id>.
_PATH_PREFIXES = {"live", "embed", "shorts", "v"}


def extract_video_id(url: str) -> str:
    """Return the 11-character video ID from a YouTube URL.

    Supports the common formats:
      - https://www.youtube.com/watch?v=VIDEOID  (with or without extra params)
      - https://youtu.be/VIDEOID
      - https://www.youtube.com/live/VIDEOID     (also /embed, /shorts, /v)

    A missing scheme (e.g. "youtu.be/VIDEOID") is tolerated. `www.` and `m.`
    host prefixes are accepted.

    Raises ValueError with a friendly message on anything that isn't a
    recognizable YouTube URL with a valid video ID. Makes no network calls.
    """
    if not isinstance(url, str) or not url.strip():
        raise ValueError("Please provide a YouTube URL.")

    raw = url.strip()
    parsed = urlparse(raw)
    # A missing scheme leaves both scheme and netloc empty (the host lands in
    # `path`). Re-parse with an https:// prefix so "youtube.com/watch?v=..."
    # is recognized the same as the full URL.
    if not parsed.scheme and not parsed.netloc:
        parsed = urlparse("https://" + raw)

    # Only real web URLs are YouTube links — reject mailto:, ftp:, abc://, etc.
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"That doesn't look like a YouTube URL: {url!r}")

    # `hostname` is lowercased and excludes any port or userinfo (unlike netloc).
    host = parsed.hostname or ""
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]

    segments = [s for s in parsed.path.split("/") if s]
    candidate = None

    if host == "youtu.be":
        candidate = segments[0] if segments else None
    elif host == "youtube.com":
        if segments and segments[0] == "watch":
            candidate = parse_qs(parsed.query).get("v", [None])[0]
        elif len(segments) >= 2 and segments[0] in _PATH_PREFIXES:
            candidate = segments[1]
    else:
        raise ValueError(f"That doesn't look like a YouTube URL: {url!r}")

    if candidate and _VIDEO_ID_RE.match(candidate):
        return candidate

    raise ValueError(f"Could not find a valid YouTube video ID in: {url!r}")
