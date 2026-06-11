"""Tests for extract_video_id — pure logic, no network.

Run standalone:  python test_utils.py
Or with pytest:  pytest test_utils.py
"""

from utils import extract_video_id

VALID = {
    # description: (input_url, expected_id)
    "watch": ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "watch_no_www": ("https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "watch_extra_params": ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
    "short_link": ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "short_link_with_query": ("https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"),
    "live": ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "mobile": ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "no_scheme": ("youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "embed": ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "shorts": ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    "whitespace": ("  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"),
}

INVALID = {
    "empty": "",
    "whitespace_only": "   ",
    "not_a_url": "hello world",
    "wrong_site": "https://vimeo.com/123456789",
    "google": "https://www.google.com/watch?v=dQw4w9WgXcQ",
    "watch_no_v": "https://www.youtube.com/watch?foo=bar",
    "id_too_short": "https://youtu.be/abc",
    "id_too_long": "https://youtu.be/dQw4w9WgXcQEXTRA",
    "bare_domain": "https://www.youtube.com/",
}


def test_valid_urls():
    for name, (url, expected) in VALID.items():
        result = extract_video_id(url)
        assert result == expected, f"{name}: got {result!r}, expected {expected!r}"


def test_invalid_urls_raise():
    for name, url in INVALID.items():
        try:
            result = extract_video_id(url)
        except ValueError:
            continue
        raise AssertionError(f"{name}: expected ValueError, got {result!r}")


def test_non_string_raises():
    for bad in (None, 123, ["https://youtu.be/dQw4w9WgXcQ"]):
        try:
            extract_video_id(bad)  # type: ignore[arg-type]
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for {bad!r}")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS  {t.__name__}")
    print(f"\nAll {len(tests)} test groups passed "
          f"({len(VALID)} valid + {len(INVALID)} invalid + non-string cases).")
