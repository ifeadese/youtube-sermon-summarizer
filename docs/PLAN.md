# Church Blog Automation — MVP Plan

Product thinking doc • June 2026

---

## Context & Background

Over a year ago, I started a blog section on my church's official website. The blog was intended to improve our SEO, and also help as an alternative way to recap/catch-up on previous teachings in much less time than having to watch or listen to the whole thing on a media streaming platform. The process for generating content for the blog was:

- Get the URL from the youtube video for the sunday sermon
- Obtain the transcript from https://kome.ai/tools/youtube-transcript-generator.
- Feed the transcript into ChatGPT and interact with it to produce a well-written, unmanipulated article
- Post it on the church blog via Squarespace

Sometimes kome.ai would not be able to generate the transcript for either technical reasons or because my device/identity hit a rate limit that triggers a paywall. In those cases, I'd explore another free tool like NoteGPT that lets me extract a clean, non-numbered transcript. ChatGPT was also inconsistent in output quality. I tried maintaining a chat thread, a context-shared project folder, and a dedicated GPT, but I wasn't getting the speed or consistency I wanted.

I was able to do this weekly for a while, but the time taken started ranging anywhere from minutes to hours depending on the quality of the LLM's output. The manual glue between 4+ tools is the bottleneck — not any single tool.

The goal is a simple, cost-effective product that collapses this workflow into one click. Built like an engineering product with a vision of serving many churches long-term — but starting as a pilot: build only what's necessary, expand only when demand proves the need.

---

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
- App fetches the transcript (via youtube-transcript-api — free locally, needs a proxy service in production)
- Transcript is sent straight into Claude with a locked, well-engineered prompt
- Output is a clean, ready-to-publish article
- Review, copy, done

No login system. No database. No fluff. Just the pipeline — in one screen.

## Tech Stack

- **Frontend:** React (single page, minimal UI)
- **Backend:** Python + FastAPI (one or two endpoints)
- **AI:** Claude API (more consistent than ChatGPT for structured writing)
- **Hosting:** Render free tier or Railway Hobby ($5/mo) — runs ~$5–15/mo at pilot scale including proxy costs
- **Transcript:** youtube-transcript-api Python library (free and reliable locally; requires a residential proxy in production due to YouTube's cloud IP blocking — see [Known Risks](#known-risks))

## Engineering Philosophy

- **Pilot-first:** Build it for yourself. If it saves your time reliably, it'll save others'.
- **Prompt is the product:** The quality of the article lives or dies by your system prompt. Nail that first.
- **Don't over-build:** No auth, no multi-tenancy, no settings yet — those come when a second church asks.
- **Version like code:** Commit, iterate, and track what works.

## Long-Term Vision

Build only what is necessary. Build more only as demand or evidence of need becomes clear. Think of this as a pilot — validate with one church (yours), then expand. Future additions could include multi-church accounts, scheduling and auto-posting to Squarespace, sermon series tagging, and SEO optimization hints — but none of that until the core is proven.

## TL;DR

One input. One button. One output. Get that right first.

---

## MVP Roadmap & Milestones

A step-by-step plan to go from zero code to a working, deployed sermon summarizer.

---

### High-Level Plan

| # | Milestone | What It Means |
|---|-----------|---------------|
| 1 | **Backend Foundation** | Build a server that can take a YouTube link and give back the sermon's words as text |
| 2 | **AI Integration** | Connect that text to Claude AI so it writes a polished blog article |
| 3 | **Frontend** | Build a web page: paste URL → click button → see article |
| 4 | **Polish & Deploy** | Make it handle mistakes gracefully, tune the writing quality, put it live online |

---

### Milestone 1: Backend Foundation

> **Goal:** A running Python server with one endpoint that accepts a YouTube URL and returns the transcript.

> **Done when:** You can hit the `/transcript` endpoint with a real sermon URL from your terminal and get back the full text of the sermon.

#### Issue 1 — Project setup and dependencies

Create the `backend/` folder, install Python libraries (FastAPI, uvicorn, youtube-transcript-api), and set up `requirements.txt`.

**Acceptance criteria:**
- `pip install -r requirements.txt` works without errors
- `localhost:8000/health` responds with `{"status": "ok"}`
- `.gitignore` includes `.env`, `__pycache__/`, and `venv/` (so secrets and junk never get committed)

**Key steps:**
- Create `backend/main.py` and `backend/requirements.txt`
- Install: `fastapi`, `uvicorn[standard]`, `youtube-transcript-api`
- Add a `/health` route
- Create `.gitignore` with `.env`, `__pycache__/`, `venv/`, `node_modules/`, `dist/`
- Test with `uvicorn main:app --reload`

---

#### Issue 2 — YouTube URL validation

Write a helper function that confirms a pasted link is actually a YouTube URL and pulls out the video ID (that 11-character code at the end).

**Acceptance criteria:**
- Handles `youtube.com/watch?v=XXX`, `youtu.be/XXX`, and `youtube.com/live/XXX`
- Returns the video ID on success, or a clear error on garbage input
- Works without making any network calls (pure logic)

**Key steps:**
- Create `backend/utils.py` with `extract_video_id(url)` function
- Use `urllib.parse` to handle the different URL formats
- Raise `ValueError` with a friendly message on failure

---

#### Issue 3 — Transcript fetching endpoint

Build `POST /transcript` — accepts a YouTube URL in the request body, fetches the transcript using the `youtube-transcript-api` library, returns the full spoken text as one string. This is primarily a development/debug route; the shipped app uses `/summarize` which calls this internally.

**Acceptance criteria:**
- Valid sermon URL → returns `{"transcript": "...full text..."}` with HTTP 200
- Invalid URL → returns HTTP 400 with helpful error message
- Private or unavailable video → returns HTTP 403 with `"This video is private or unavailable"`
- Video with no captions → returns HTTP 404 with `"No transcript available for this video"`
- Targets English transcripts (auto-generated or manual); returns a clear error if no English transcript exists

**Key steps:**
- Create `backend/transcript.py` with `fetch_transcript(video_id)` function
- Instantiate the client: `ytt_api = YouTubeTranscriptApi()`
- Fetch with: `fetched = ytt_api.fetch(video_id, languages=['en'])`
- Join all text: `" ".join(snippet.text for snippet in fetched)`
- Add `POST /transcript` route in `main.py` with a Pydantic model (a schema that validates the request shape — think of it as a form definition for your API)
- Handle specific exceptions: `TranscriptsDisabled`, `NoTranscriptFound`, `VideoUnavailable`, `RequestBlocked`

---

### Milestone 2: AI Integration

> **Goal:** A second endpoint that takes the transcript, sends it to Claude with a carefully crafted prompt, and returns a blog-ready article.

> **Done when:** You can call `/summarize` with a real sermon URL and get back a well-written article you'd consider publishing.

#### Issue 4 — Claude API client setup

Install the Anthropic Python SDK, configure it to read your API key from an environment variable, and verify the connection works.

**Acceptance criteria:**
- `anthropic` package is in `requirements.txt`
- `.env.example` documents the required `ANTHROPIC_API_KEY` variable
- `.env` is in `.gitignore` (never committed — leaking an API key costs real money)
- A test script sends "Hello" to Claude and gets a response back

**Key steps:**
- `pip install anthropic python-dotenv`
- Create `.env.example` with `ANTHROPIC_API_KEY=your-key-here`
- Client reads key from environment automatically: `client = anthropic.Anthropic()`
- Write a small `backend/test_claude.py` to verify connectivity
- Use the current Claude Sonnet model (verify exact model ID at [Anthropic's model docs](https://docs.anthropic.com/en/docs/about-claude/models) before coding)

---

#### Issue 5 — System prompt engineering (first working draft)

Write the system prompt that tells Claude how to transform raw transcript text into a polished blog article. This is the most important piece — it defines the tone, structure, and quality of every article the app produces. This issue is about getting the first working version; Issue 11 is about tuning it at volume.

**Acceptance criteria:**
- Prompt stored in its own file (`backend/prompts.py`) for easy iteration
- Given a real sermon transcript, Claude produces an article that passes this checklist:
  - [ ] Has a compelling title
  - [ ] Contains 3+ subheadings
  - [ ] Faithfully represents the sermon's message (no fabricated points or scripture references)
  - [ ] Between 800–1500 words
  - [ ] Reads naturally — no meta-AI phrasing ("In this sermon, the pastor explores..."), no generic filler openers, no repeated phrasing patterns
  - [ ] Output is plain text with line breaks for paragraphs (no Markdown, no HTML) — so it pastes cleanly into Squarespace's rich text editor without rendering literal `##` or `**` symbols
- Tested with 3 real transcripts; all pass the checklist above

**Key steps:**
- Create `backend/prompts.py` with a `SYSTEM_PROMPT` string
- Include instructions for: role, output format, theological accuracy constraints, tone, target length
- Test iteratively with real sermon transcripts
- Use the current Claude Sonnet model (best balance of quality and cost — ~$0.05–0.07 per article; see Cost Estimate)

---

#### Issue 6 — Summarize endpoint

Build `POST /summarize` — the main endpoint. Takes a YouTube URL, fetches the transcript internally, sends it to Claude, and returns the finished article. One call does everything.

**Acceptance criteria:**
- Valid URL → returns `{"article": "...the full blog post..."}` with HTTP 200
- Response time under 90 seconds for a typical 30–45 minute sermon (allows for cold starts on free hosting)
- Errors from transcript or Claude step return appropriate HTTP codes and messages

**Key steps:**
- Create `backend/summarizer.py` with `generate_article(transcript)` function
- Chain: extract video ID → fetch transcript → send to Claude → return article
- Add CORS middleware (a browser permission that lets your frontend talk to your backend — without it, the browser blocks the request)
- Add `POST /summarize` route in `main.py`

---

### Milestone 3: Frontend

> **Goal:** A simple, clean web page where you paste a URL, click a button, and get an article back.

> **Done when:** You can open the app in a browser, paste a sermon URL, click Generate, and copy the resulting article to your clipboard.

#### Issue 7 — React app scaffolding

Create a React app using Vite (a fast build tool that bundles your code for the browser), clean out the boilerplate, and get a dev server running.

**Acceptance criteria:**
- `npm run dev` in `frontend/` starts the app
- Browser shows "YouTube Sermon Summarizer" heading
- Uses plain CSS (no complex UI framework needed)

**Key steps:**
- `npm create vite@latest frontend -- --template react`
- Clear boilerplate, add centered layout with app title
- Keep it to one main component (`App.jsx`) for now

---

#### Issue 8 — Input form and API integration

Build the main UI: a text input for the URL, a "Generate Article" button, a loading spinner while waiting, and a section to display the returned article. Wire it to call the backend.

**Acceptance criteria:**
- Paste URL + click button → article appears below
- Loading indicator shows while waiting (button disabled)
- On error, a clear message is shown (not a code dump)
- API base URL is configurable via environment variable (not hardcoded)

**Key steps:**
- State: `url`, `article`, `loading`, `error`
- Use `import.meta.env.VITE_API_BASE_URL` for the backend URL (defaults to `http://localhost:8000` in development)
- Create `.env.example` in `frontend/` with `VITE_API_BASE_URL=http://localhost:8000`
- On submit: call `fetch(API_BASE_URL + "/summarize", ...)` with the URL in the request body
- Conditional rendering: spinner when loading, error when failed, article when done
- Style the article display with readable typography

---

#### Issue 9 — Copy-to-clipboard feature

Add a "Copy Article" button so you can paste the output directly into Squarespace or any blog editor without selecting text manually.

**Acceptance criteria:**
- "Copy" button appears after an article is generated
- Clicking copies full article text to clipboard
- Visual feedback: button text changes to "Copied!" for 2 seconds

**Key steps:**
- Use `navigator.clipboard.writeText()` browser API
- Add button with onClick handler
- Toggle `copied` state with a `setTimeout` reset

---

### Milestone 4: Polish & Deploy

> **Goal:** The app handles edge cases, output quality is tuned, and it's live on the internet.

> **Done when:** Someone can open a public URL, paste a sermon link, and get a publish-ready article — with no crashes, no confusing errors, and no you standing behind them to troubleshoot.

#### Issue 10 — Error handling and edge cases

Make sure every possible failure gives the user a friendly, helpful message instead of crashing or showing technical jargon. Backend error handling can be built after Issue 6; frontend error UX requires Issues 7–8 to be complete.

**Acceptance criteria:**
- Every failure produces a user-friendly message
- Backend returns appropriate HTTP codes per error type:
  - `400` — invalid input (bad URL that passes Pydantic but isn't a real YouTube link)
  - `403` — video is private or restricted
  - `404` — video exists but has no transcript
  - `422` — malformed request body (FastAPI/Pydantic returns this automatically when the request shape is wrong — e.g. missing fields, wrong types)
  - `429` — Claude API rate-limited (signals the frontend to retry after a delay)
  - `500` — unexpected server error
  - `503` — Claude API down or unreachable
- Frontend handles network failures (backend unreachable)
- Tested with: empty input, non-YouTube URL, private video, video without captions

**Key steps:**
- Add try/except blocks in backend routes
- Catch specific Anthropic errors: `RateLimitError`, `APIConnectionError`, `APIStatusError`
- Catch transcript errors: `TranscriptsDisabled`, `NoTranscriptFound`, `VideoUnavailable`, `RequestBlocked`
- Frontend: try/catch around fetch, handle non-2xx responses by reading the JSON error detail
- Test each failure scenario manually

---

#### Issue 11 — Prompt tuning and output quality (tune at volume)

Run 5–10 real church sermons through the system. Compare outputs. Refine the prompt until the articles are consistently publish-ready. This builds on the first draft from Issue 5 — here you stress-test with more sermons and lock in the final version.

**Acceptance criteria:**
- 5+ real sermons produce articles that pass the quality checklist:
  - [ ] Has a compelling title
  - [ ] Contains 3+ subheadings
  - [ ] Faithfully represents the sermon's message (no fabricated points or scripture)
  - [ ] Between 800–1500 words
  - [ ] Reads naturally — no meta-AI phrasing, no generic filler openers, no repeated phrasing patterns
  - [ ] You would publish it without edits
- `docs/PROMPT_LOG.md` records what changed and why
- Handles edge cases: short sermons, audience interaction, sermon series references

**Key steps:**
- Collect 5–10 real YouTube sermon URLs from your church
- Run each through `/summarize`
- Review against the checklist above
- Paste at least one result into Squarespace's editor and confirm subheadings/paragraphs look acceptable as plain text (if too flat, revisit whether the editor accepts rich text pasting)
- Iterate on `SYSTEM_PROMPT` and document changes in `PROMPT_LOG.md`

---

#### Issue 12 — Deploy to Render (or alternative)

Put the app on the internet so you can use it from any device. API key stays secret (stored on the hosting platform, never in code).

**Acceptance criteria:**
- App accessible at a public URL
- `ANTHROPIC_API_KEY` stored as a secret environment variable (not in code)
- Frontend's `VITE_API_BASE_URL` points to the deployed backend URL
- Full flow works: paste URL → get article → copy it
- Proxy configuration is in place so transcript fetching works from cloud (see Known Risks)

**Key steps:**
- Backend: add startup config (Procfile — a file that tells the host how to start your app), command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Frontend: `npm run build` → deploy `dist/` as static site (or serve from FastAPI directly — simplest single-service deploy)
- Set `ANTHROPIC_API_KEY` and proxy credentials in platform dashboard
- Update CORS `allow_origins` (the list of frontend URLs allowed to talk to your backend) to include the deployed frontend URL
- Render free tier: $0/month but services sleep after ~15 min idle (expect 30–60s cold start on first request). Railway: $5/mo minimum (no free tier). Choose based on tolerance for cold starts vs. cost.

---

### Dependency Map

```
Issue 1 (Setup + .gitignore)
  ├── Issue 2 (URL Validation) → Issue 3 (Transcript Endpoint)
  └── Issue 4 (Claude Setup) → Issue 5 (Prompt v1) → Issue 6 (Summarize Endpoint)
                                                           │
                                             ┌─────────────┼──────────────┐
                                             │                            │
                                 Issue 7 (React Setup)         Issue 10 (Backend Errors)
                                             │                            │
                                 Issue 8 (Form + API)          Issue 10 (Frontend Errors)*
                                             │                            │
                                 Issue 9 (Copy Button)         Issue 11 (Prompt Tuning)
                                                                          │
                                                               Issue 12 (Deploy)

* Issue 10's frontend error work depends on Issues 7–8 being done.
  Backend error handling can start right after Issue 6.
  Issues 7–9 (frontend) can begin in parallel with Issue 6 using mocked/stubbed responses.
```

---

### Known Risks

#### YouTube blocks cloud IPs (critical)

Since late 2024, YouTube blocks transcript requests from most datacenter IPs (AWS, GCP, Railway, Render, etc.). There is a high likelihood that the `youtube-transcript-api` library will raise `RequestBlocked` when deployed to cloud hosts. It works on your laptop (residential IP) but will very likely fail in production — validate early on your target host.

**Impact:** This adds a recurring cost and a third-party dependency for production use.

**Mitigations:**

1. **Webshare residential proxies (recommended)** — the library's maintainer recommends Webshare and ships a dedicated zero-config helper:
   ```python
   from youtube_transcript_api.proxies import WebshareProxyConfig

   ytt_api = YouTubeTranscriptApi(
       proxy_config=WebshareProxyConfig(
           proxy_username="your-username",
           proxy_password="your-password",
       )
   )
   ```
   This auto-rotates residential IPs with no URL wiring needed. ~$5–10/month for pilot-level usage.

   For other providers (Smartproxy, Oxylabs), use `GenericProxyConfig` with explicit URLs:
   ```python
   from youtube_transcript_api.proxies import GenericProxyConfig

   ytt_api = YouTubeTranscriptApi(
       proxy_config=GenericProxyConfig(
           http_url="http://user:pass@proxy.example.com:port",
           https_url="https://user:pass@proxy.example.com:port",
       )
   )
   ```

2. **Hosted transcript API** (e.g. Supadata) — a paid service that handles the proxy/blocking for you. Simpler but adds a dependency.

3. **Self-host on a residential IP** — e.g. a Raspberry Pi at home. Free but fragile.

**Recommendation:** Pick Webshare and move on — it's the cheapest, simplest, and library-native option. Don't comparison-shop proxies; that's a rabbit hole that doesn't serve the pilot. Budget ~$5–10/month. Test this during Issue 3 development so you're not surprised at deploy time.

#### The library uses an undocumented YouTube API

`youtube-transcript-api` relies on an undocumented part of YouTube's API. There's no guarantee it won't break if YouTube changes their internal endpoints. For a pilot this is acceptable — if it breaks, evaluate alternatives then.

---

### Cost Estimate

**Claude API (per article):**
- A 45-min sermon transcript ≈ 8,000–12,000 tokens input
- A 1,500-word article ≈ 2,000 tokens output
- Using the current Claude Sonnet model (~$3/M input, ~$15/M output): **~$0.05–0.07 per article**
  - Math: 12k input × $3/M = $0.036 + 2k output × $15/M = $0.030 → ~$0.066 at the high end
  - Add ~10% buffer for system prompt overhead → ~$0.07 conservative max
- At 4 articles/month: **~$0.20–0.28/month**

**Hosting:**
- Render free tier: **$0/month** (but services sleep after ~15 min; 30–60s cold start on wake)
- Railway Hobby plan: **$5/month** (always-on, no cold starts)
- Confirm current pricing/limits at deployment time — these change frequently

**Transcript proxies (required for cloud deploy):**
- Residential proxy service: **~$5–15/month** depending on provider and volume

**Total estimated monthly cost:** ~$5–16/month for a single-church pilot.
