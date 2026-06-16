# Prompt Log

A running record of changes to `backend/prompts.py` (`SYSTEM_PROMPT`) and why.
The prompt is the core product — this log keeps its evolution auditable so we
can tell *what* changed, *why*, and whether a change helped.

---

## v1.1 — Reflection format (2026-06-16)

**Change:** Reframed the prompt from a long-form, third-person *article* into a
concise, reverent, first-person-plural *reflection*, derived from the
maintainer's hand-tuned ChatGPT custom-GPT writing guide.

**Why:** The v1.0 draft was written from a planning-time guess. The maintainer's
own tuned guide — refined over real church-blog use — is the better source of
truth for the target voice and length.

**What changed (v1.0 → v1.1):**

| Dimension | v1.0 | v1.1 |
|-----------|------|------|
| Voice | Neutral third-person | First-person plural ("we/us/our") |
| Length | 800–1500 words | ≤750 words (target 550–700) |
| Headings | "at least three" | 2–4, mirroring the preacher's own emphasis |
| Tone | Warm, accessible, encouraging | Reverent, readable, relatable reflection |
| Scripture | Faithful, no dedicated line | Primary reference on its own line under the title (when stated) |
| Faithfulness | No fabricated verses/quotes/stats/names | + no added commentary, analogies, modern illustrations, or applications; preserve the preacher's meaning and flow |
| Flow | "vary sentence structure" | Continuous message, smooth transitions, not a list of points |
| Title | "compelling, specific" (model-invented) | Faithful to the sermon's actual message, not clickbait |

**Unchanged:** plain-text-only output rules (no Markdown/HTML, headings as plain
lines) so it pastes cleanly into Squarespace; "return only" the finished output
with no preamble; ignore worship lyrics / music cues / audience call-and-response
/ transcription noise.

**Deferred to a follow-up PR (v1.2):**
- Use the *actual* YouTube video title (via oEmbed, with a graceful fallback to a
  model-generated title) instead of a model-invented one.
- An SEO meta description returned as a **structured field** (`{ article,
  seo_description }`), not appended inline to the article text, plus frontend
  surfacing/copy. (<160 chars, invitational tone.)

**Validation (pending — the human-judgment half of issue #12):** run 5+ real
sermons through `/summarize` and confirm each reflection meets the updated
checklist in `PLAN.md` (≤750 words, 2–4 emphasis-based headings, faithful "we"
voice, no fabricated/added content, publish-ready).

---

## v1.0 — Initial draft

First working `SYSTEM_PROMPT`: an experienced church-blog writer turning a messy
auto-generated transcript into a clean 800–1500-word article with a compelling
title, 3+ headings, plain-text output, and strict no-fabrication constraints.
