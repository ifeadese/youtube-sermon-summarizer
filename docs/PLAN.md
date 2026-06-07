# Church Blog Automation — MVP Plan

Product thinking doc • June 2026

## The Problem

A manual, fragile, multi-tool pipeline with no memory, no consistency, and no central place to manage it. Every week involves stitching together 4+ tools manually, and output quality is a coin flip. It doesn't scale even for one person, let alone many churches.

**The core bottleneck:** It's not any single tool — it's the lack of a unified workflow. The user is the glue between everything, and that's what burns time.

## Current Workflow (Broken)

- Get YouTube URL from the Sunday sermon
- Go to kome.ai or NoteGPT to extract a transcript (unreliable, rate-limited, sometimes paywalled)
- Paste transcript into ChatGPT and iterate to produce a well-written article (inconsistent quality)
- Post the article on the church blog via Squarespace

## MVP — What to Build

One simple web app that collapses the entire pipeline into a single flow:

- Paste a YouTube URL
- App fetches the transcript (via youtube-transcript-api — no third-party dependency)
- Transcript is sent straight into Claude/GPT with a locked, well-engineered prompt
- Output is a clean, ready-to-publish article
- Review, copy, done

No login system. No database. No fluff. Just the pipeline — in one screen.

## Tech Stack

- **Frontend:** React (single page, minimal UI)
- **Backend:** Python + FastAPI (one or two endpoints)
- **AI:** Claude API (more consistent than ChatGPT for structured writing)
- **Hosting:** Railway or Render (free/cheap tier)
- **Transcript:** youtube-transcript-api Python library (free, no rate limits, no third-party)

## Engineering Philosophy

- **Pilot-first:** Build it for yourself. If it saves your time reliably, it'll save others'.
- **Prompt is the product:** The quality of the article lives or dies by your system prompt. Nail that first.
- **Don't over-build:** No auth, no multi-tenancy, no settings yet — those come when a second church asks.
- **Version like code:** Commit, iterate, and track what works.

## Long-Term Vision

Build only what is necessary. Build more only as demand or evidence of need becomes clear. Think of this as a pilot — validate with one church (yours), then expand. Future additions could include multi-church accounts, scheduling and auto-posting to Squarespace, sermon series tagging, and SEO optimization hints — but none of that until the core is proven.

## TL;DR

One input. One button. One output. Get that right first.
