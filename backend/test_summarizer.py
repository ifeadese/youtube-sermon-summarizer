"""Tests for generate_article.

The Claude API client is mocked — these run with NO ANTHROPIC_API_KEY and make
NO real API calls (no credits spent, no credentials touched). They verify the
code *around* Claude: input validation, request shape, and output handling.

Run standalone:  python test_summarizer.py
Or with pytest:  pytest test_summarizer.py
"""

from types import SimpleNamespace

import summarizer as s
from prompts import SYSTEM_PROMPT
from summarizer import generate_article

TRANSCRIPT = "Today we are talking about the blessing of Abraham. The Bible says..."


def _install_client(*, text=None, capture=None):
    """Patch _get_client with a fake whose messages.create returns `text`.

    If `capture` (a dict) is given, the create() kwargs are recorded into it.
    Returns the original _get_client so the caller can restore it.
    """
    original = s._get_client

    class _FakeMessages:
        def create(self, **kwargs):
            if capture is not None:
                capture.update(kwargs)
            blocks = [SimpleNamespace(type="text", text=text)] if text is not None else []
            return SimpleNamespace(content=blocks)

    class _FakeClient:
        messages = _FakeMessages()

    s._get_client = lambda: _FakeClient()
    return original


def test_import_requires_no_credentials():
    # Importing the module and reaching this point proves no key was needed.
    # The client is built lazily, so it stays None until a real call.
    assert s._client is None


def test_generate_article_returns_text():
    original = _install_client(text="  My Title\n\nA fine article.  ")
    try:
        assert generate_article(TRANSCRIPT) == "My Title\n\nA fine article."
    finally:
        s._get_client = original


def test_generate_article_sends_prompt_and_transcript():
    captured = {}
    original = _install_client(text="ok", capture=captured)
    try:
        generate_article(TRANSCRIPT)
        assert captured["model"] == s.MODEL
        assert captured["system"] == SYSTEM_PROMPT
        # the transcript must reach Claude as the user message
        sent = captured["messages"][0]["content"]
        text = sent if isinstance(sent, str) else sent[0]["text"]
        assert TRANSCRIPT in text
    finally:
        s._get_client = original


def test_empty_transcript_raises():
    for bad in ("", "   ", "\n\t "):
        try:
            generate_article(bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for {bad!r}")


def test_empty_model_output_raises():
    # Claude returns no text blocks → we should surface a clear error, not "".
    for empty in (None, "", "   "):
        original = _install_client(text=empty)
        try:
            generate_article(TRANSCRIPT)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected ValueError when model returns {empty!r}")
        finally:
            s._get_client = original


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS  {t.__name__}")
    print(f"\nAll {len(tests)} tests passed (no API key, no network).")
