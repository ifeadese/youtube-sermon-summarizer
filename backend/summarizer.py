"""Turn a sermon transcript into a blog article using the Claude API.

Credential-agnostic by design: the client reads ANTHROPIC_API_KEY from the
environment via the SDK's default resolution. No key, base URL, org ID, or
gateway is hardcoded anywhere — point your own key at it and it works.

The client is constructed lazily so importing this module (and running the
mocked test suite) requires no credentials.
"""

import anthropic

from prompts import SYSTEM_PROMPT

# The project chose Sonnet for the cost/quality balance on structured writing
# (~$0.05–0.07 per article). Verify the exact ID at the Anthropic model docs.
MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4096

_client = None


def _get_client() -> "anthropic.Anthropic":
    """Lazily build the Anthropic client. Reads ANTHROPIC_API_KEY from the env."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def generate_article(transcript: str) -> str:
    """Send a transcript to Claude with the system prompt; return the article text.

    Raises ValueError if the transcript is empty or Claude returns no text.
    Anthropic SDK exceptions propagate to the caller (the /summarize route
    maps them to HTTP status codes in a later issue).
    """
    if not transcript or not transcript.strip():
        raise ValueError("Transcript is empty.")

    response = _get_client().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": transcript}],
    )

    # Truncation guard: if Claude hit the output cap, the article is cut off
    # mid-sentence. Fail loudly rather than return a partial article that looks
    # complete to the caller.
    if response.stop_reason == "max_tokens":
        raise ValueError(
            f"Claude hit the {MAX_TOKENS}-token output limit before finishing the "
            "article. Increase MAX_TOKENS and retry."
        )

    # Join text blocks with paragraph breaks (not ""), so multi-block responses
    # don't run two paragraphs together. In practice there's usually one block.
    article = "\n\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()

    if not article:
        raise ValueError("Claude returned an empty article.")
    return article
