"""Manual end-to-end demo: YouTube URL -> transcript -> Claude -> article.

Run this on YOUR device with YOUR personal Anthropic key — it makes a real,
billed Claude API call. It is NOT run by the test suite or in CI.

Setup (from the backend/ directory):
    cp .env.example .env          # then edit .env and paste your personal key
    ./venv/bin/pip install -r requirements.txt

Run:
    ./venv/bin/python generate_article_demo.py "https://www.youtube.com/watch?v=VIDEO_ID"

The key is read from .env (ANTHROPIC_API_KEY). Nothing is hardcoded.
"""

import sys

from dotenv import load_dotenv

from summarizer import generate_article
from transcript import TranscriptError, fetch_transcript
from utils import extract_video_id


def main() -> int:
    load_dotenv()  # pulls ANTHROPIC_API_KEY from your local .env

    if len(sys.argv) != 2:
        print('Usage: python generate_article_demo.py "<youtube-url>"')
        return 2

    url = sys.argv[1]

    try:
        video_id = extract_video_id(url)
    except ValueError as exc:
        print(f"Invalid URL: {exc}")
        return 1

    print(f"Fetching transcript for {video_id} ...")
    try:
        transcript = fetch_transcript(video_id)
    except TranscriptError as exc:
        print(f"Transcript error ({exc.status_code}): {exc.detail}")
        return 1
    print(f"Transcript: {len(transcript):,} chars / ~{len(transcript.split()):,} words")

    print("Generating article with Claude (this makes a real, billed API call) ...\n")
    article = generate_article(transcript)

    print("=" * 70)
    print(article)
    print("=" * 70)
    print(f"\nArticle: ~{len(article.split()):,} words")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
