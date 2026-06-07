# MVP Roadmap & Milestones

A step-by-step plan to go from zero code to a working, deployed sermon summarizer.

---

## High-Level Plan

| # | Milestone | What It Means |
|---|-----------|---------------|
| 1 | **Backend Foundation** | Build a server that can take a YouTube link and give back the sermon's words as text |
| 2 | **AI Integration** | Connect that text to Claude AI so it writes a polished blog article |
| 3 | **Frontend** | Build a web page: paste URL → click button → see article |
| 4 | **Polish & Deploy** | Make it handle mistakes gracefully, tune the writing quality, put it live online |

---

## Milestone 1: Backend Foundation

> **Goal:** A running Python server with one endpoint that accepts a YouTube URL and returns the transcript.

### Issue 1 — Project setup and dependencies

Create the `backend/` folder, install Python libraries (FastAPI, uvicorn, youtube-transcript-api), and set up `requirements.txt`.

**Acceptance criteria:**
- `pip install -r requirements.txt` works without errors
- `localhost:8000/health` responds with `{"status": "ok"}`

**Key steps:**
- Create `backend/main.py` and `backend/requirements.txt`
- Install: `fastapi`, `uvicorn[standard]`, `youtube-transcript-api`
- Add a `/health` route
- Test with `uvicorn main:app --reload`

---

### Issue 2 — YouTube URL validation

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

### Issue 3 — Transcript fetching endpoint

Build `POST /transcript` — accepts a YouTube URL in the request body, fetches the transcript using the `youtube-transcript-api` library, returns the full spoken text as one string.

**Acceptance criteria:**
- Valid sermon URL → returns `{"transcript": "...full text..."}` with HTTP 200
- Invalid URL → returns HTTP 422 with helpful error message
- Video with no captions → returns HTTP 404 with `"No transcript available for this video"`

**Key steps:**
- Create `backend/transcript.py` with `fetch_transcript(video_id)` function
- Use `YouTubeTranscriptApi.get_transcript(video_id)`
- Join all text segments into one string
- Add `POST /transcript` route in `main.py` with a Pydantic request model

---

## Milestone 2: AI Integration

> **Goal:** A second endpoint that takes the transcript, sends it to Claude with a carefully crafted prompt, and returns a blog-ready article.

### Issue 4 — Claude API client setup

Install the Anthropic Python SDK, configure it to read your API key from an environment variable, and verify the connection works.

**Acceptance criteria:**
- `anthropic` package is in `requirements.txt`
- `.env.example` documents the required `ANTHROPIC_API_KEY` variable
- A test script sends "Hello" to Claude and gets a response back

**Key steps:**
- `pip install anthropic python-dotenv`
- Create `.env.example` with `ANTHROPIC_API_KEY=your-key-here`
- Client reads key from environment automatically: `client = anthropic.Anthropic()`
- Write a small `backend/test_claude.py` to verify connectivity

---

### Issue 5 — System prompt engineering (the core product)

Write the system prompt that tells Claude how to transform raw transcript text into a polished blog article. This is the most important piece — it defines the tone, structure, and quality of every article the app produces.

**Acceptance criteria:**
- Prompt stored in its own file (`backend/prompts.py`) for easy iteration
- Given a real sermon transcript, Claude produces an article with: a title, subheadings, faithful representation of the message, natural tone, 800–1500 words
- Tested with 3+ real transcripts with satisfactory results

**Key steps:**
- Create `backend/prompts.py` with a `SYSTEM_PROMPT` string
- Include instructions for: role, output format, theological accuracy constraints, tone, target length
- Test iteratively with real sermon transcripts
- Model: `claude-sonnet-4-6` (good balance of quality and cost — ~$0.06–0.09 per article)

---

### Issue 6 — Summarize endpoint

Build `POST /summarize` — the main endpoint. Takes a YouTube URL, fetches the transcript internally, sends it to Claude, and returns the finished article. One call does everything.

**Acceptance criteria:**
- Valid URL → returns `{"article": "...the full blog post..."}` with HTTP 200
- Response time under 60 seconds for a typical 30–45 minute sermon
- Errors from transcript or Claude step return appropriate HTTP codes and messages

**Key steps:**
- Create `backend/summarizer.py` with `generate_article(transcript)` function
- Chain: extract video ID → fetch transcript → send to Claude → return article
- Add CORS middleware so the frontend can call this endpoint later
- Add `POST /summarize` route in `main.py`

---

## Milestone 3: Frontend

> **Goal:** A simple, clean web page where you paste a URL, click a button, and get an article back.

### Issue 7 — React app scaffolding

Create a React app using Vite (the modern build tool), clean out the boilerplate, and get a dev server running.

**Acceptance criteria:**
- `npm run dev` in `frontend/` starts the app
- Browser shows "YouTube Sermon Summarizer" heading
- Uses plain CSS (no complex UI framework needed)

**Key steps:**
- `npm create vite@latest frontend -- --template react`
- Clear boilerplate, add centered layout with app title
- Keep it to one main component (`App.jsx`) for now

---

### Issue 8 — Input form and API integration

Build the main UI: a text input for the URL, a "Generate Article" button, a loading spinner while waiting, and a section to display the returned article. Wire it to call the backend.

**Acceptance criteria:**
- Paste URL + click button → article appears below
- Loading indicator shows while waiting (button disabled)
- On error, a clear message is shown (not a code dump)

**Key steps:**
- State: `url`, `article`, `loading`, `error`
- On submit: `fetch("http://localhost:8000/summarize", ...)`
- Conditional rendering: spinner when loading, error when failed, article when done
- Style the article display with readable typography

---

### Issue 9 — Copy-to-clipboard feature

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

## Milestone 4: Polish & Deploy

> **Goal:** The app handles edge cases, output quality is tuned, and it's live on the internet.

### Issue 10 — Error handling and edge cases

Make sure every possible failure gives the user a friendly, helpful message instead of crashing or showing technical jargon.

**Acceptance criteria:**
- Every failure produces a user-friendly message
- Backend returns appropriate HTTP codes (400, 404, 500, 503) per error type
- Frontend handles network failures (backend unreachable)
- Tested with: empty input, non-YouTube URL, private video, video without captions

**Key steps:**
- Add try/except blocks in backend routes
- Catch specific Anthropic errors: `RateLimitError`, `APIConnectionError`, `APIStatusError`
- Frontend: try/catch around fetch, handle non-2xx responses
- Test each failure scenario manually

---

### Issue 11 — Prompt tuning and output quality

Run 5–10 real church sermons through the system. Compare outputs. Refine the prompt until the articles are consistently publish-ready.

**Acceptance criteria:**
- 5+ real sermons produce articles you'd publish without manual edits
- `docs/PROMPT_LOG.md` records what changed and why
- Handles edge cases: short sermons, audience interaction, sermon series references

**Key steps:**
- Collect 5–10 real YouTube sermon URLs from your church
- Run each through `/summarize`
- Review for: theological accuracy, readability, structure, tone, length
- Iterate on `SYSTEM_PROMPT` and document changes

---

### Issue 12 — Deploy to Railway or Render

Put the app on the internet so you can use it from any device. API key stays secret (stored on the hosting platform, never in code).

**Acceptance criteria:**
- App accessible at a public URL
- `ANTHROPIC_API_KEY` stored as a secret environment variable (not in code)
- Frontend calls the deployed backend (not localhost)
- Full flow works: paste URL → get article → copy it

**Key steps:**
- Backend: add startup config (`Procfile` or platform config), command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Frontend: `npm run build` → deploy `dist/` as static site (or serve from FastAPI)
- Set `ANTHROPIC_API_KEY` in platform dashboard
- Update CORS to allow the frontend's deployed URL

---

## Dependency Map

```
Issue 1 (Setup)
  ├── Issue 2 (URL Validation) → Issue 3 (Transcript Endpoint)
  └── Issue 4 (Claude Setup) → Issue 5 (Prompt) → Issue 6 (Summarize Endpoint)
                                                        │
                                          ┌─────────────┼─────────────┐
                                          │                           │
                              Issue 7 (React Setup)          Issue 10 (Errors)
                                          │                           │
                              Issue 8 (Form + API)           Issue 11 (Tuning)
                                          │                           │
                              Issue 9 (Copy Button)          Issue 12 (Deploy)
```

---

## Cost Estimate

Using Claude Sonnet 4.6 at $3/M input tokens, $15/M output tokens:
- A 45-min sermon transcript ≈ 8,000–12,000 tokens input
- A 1,500-word article ≈ 2,000 tokens output
- **Cost per article: ~$0.06–0.09**
- At 4 articles/month: **~$0.25–0.36/month** in API costs

Hosting on Railway/Render free tier: **$0/month** (within free limits for low-traffic use).
