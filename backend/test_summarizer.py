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


def _install_client(*, text=None, blocks=None, stop_reason="end_turn", capture=None):
    """Patch _get_client with a fake messages.create.

    - `text`: shorthand for a single text block.
    - `blocks`: list of (type, text) tuples for multi/mixed-block responses.
    - `stop_reason`: set on the fake response (e.g. "max_tokens").
    - `capture`: if given (a dict), create()'s kwargs are recorded into it.
    Returns the original _get_client so the caller can restore it.
    """
    original = s._get_client

    if blocks is not None:
        content = [SimpleNamespace(type=t, text=x) for (t, x) in blocks]
    elif text is not None:
        content = [SimpleNamespace(type="text", text=text)]
    else:
        content = []

    class _FakeMessages:
        def create(self, **kwargs):
            if capture is not None:
                capture.update(kwargs)
            return SimpleNamespace(content=list(content), stop_reason=stop_reason)

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


def test_max_tokens_truncation_raises():
    # A truncated article must fail loudly, not return partial text as success.
    original = _install_client(text="An unfinished article that stops mid-", stop_reason="max_tokens")
    try:
        generate_article(TRANSCRIPT)
    except ValueError as exc:
        assert "limit" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError on stop_reason='max_tokens'")
    finally:
        s._get_client = original


def test_multiple_text_blocks_joined_with_breaks():
    original = _install_client(blocks=[("text", "Para one."), ("text", "Para two.")])
    try:
        assert generate_article(TRANSCRIPT) == "Para one.\n\nPara two."
    finally:
        s._get_client = original


def test_non_text_blocks_ignored():
    # e.g. a thinking block interleaved before the article text.
    original = _install_client(blocks=[("thinking", "internal reasoning"), ("text", "The article body.")])
    try:
        assert generate_article(TRANSCRIPT) == "The article body."
    finally:
        s._get_client = original


def test_whitespace_only_multiblock_raises():
    original = _install_client(blocks=[("text", "   "), ("text", "\n\t")])
    try:
        generate_article(TRANSCRIPT)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for whitespace-only output")
    finally:
        s._get_client = original


def test_system_prompt_keeps_load_bearing_invariants():
    """Guard the v1.1 reflection contract: these constraints are load-bearing
    (plain-text paste into Squarespace, length cap, voice, faithfulness), and an
    accidental edit that drops one should fail CI rather than silently ship.
    The output itself can't be unit-tested without live calls, so we assert the
    distinctive phrases that encode each constraint are still present."""
    invariants = {
        "plain-text output": "plain text only",
        "no Markdown": "no Markdown",
        "word cap (<=750)": "750",
        "first-person-plural voice": "first-person-plural",
        "2-4 emphasis-based headings": "Two to four sections",
        "no fabrication": "Do NOT invent",
        "no added commentary/analogies": "Do NOT add your own commentary",
    }
    missing = [name for name, phrase in invariants.items() if phrase not in SYSTEM_PROMPT]
    assert not missing, f"SYSTEM_PROMPT dropped load-bearing invariant(s): {missing}"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS  {t.__name__}")
    print(f"\nAll {len(tests)} tests passed (no API key, no network).")
