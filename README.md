# YouTube Sermon Summarizer

A simple web app that turns a YouTube sermon into a ready-to-publish blog article — in one click.

## What It Does

Paste a YouTube URL, get a clean, well-written article back. No manual transcript extraction, no copy-pasting between tools, no inconsistent LLM outputs.

## Why

Writing weekly sermon recaps for a church blog currently requires stitching together 4+ unreliable tools manually. This project collapses that entire pipeline into a single, reliable flow.

## Tech Stack

- **Frontend:** React (single page, minimal UI)
- **Backend:** Python + FastAPI
- **AI:** Claude API
- **Transcript:** youtube-transcript-api

## Docs

- [Background & Context](docs/BACKGROUND.md) — the problem story
- [MVP Plan](docs/PLAN.md) — what we're building and why

## Philosophy

Pilot-first. One input, one button, one output. Build only what's necessary — expand when demand proves the need.
