# Design Plan — Issue #35: Make the UI presentable as a real product

> **Status:** Proposal for review (no implementation yet). This doc is the
> design plan for #35; once agreed, a follow-up PR implements it. Posted as a
> PR so it can be reviewed before any code is written.

## Context

The app works and looks clean (Warm Sanctuary theme, PR #31, merged), but it's a
bare tool: an input, a button, and a result. A first-time visitor who lands cold
has no idea what it is, who it's for, or how it works — there's no framing or
context. Even though the pilot is used by one church, it should read like a real
product to build trust. This issue adds product-grade context and explainer
content **on top of the existing design**, without bloating it or adding backend
functionality.

## Decisions locked (with the maintainer)

- **Attribution:** generic ministry framing ("Made for churches and ministries") — no names.
- **Example output:** feature a **real** generated article the maintainer supplies (needed at implementation).
- **Pilot framing:** subtle — a quiet note in the footer only; otherwise present as a finished product.

## Approach

Keep the single-page, single-column (`max-width: 42rem`) layout — the tool stays
the hero, above the fold. Add supporting content **below** it, gated to the idle
state so it never competes with a generated result. Reuse the existing CSS design
tokens and idle-gating pattern; introduce no router and no new dependencies.

All existing test / accessibility contracts stay unchanged: h1 text
(`YouTube Sermon Summarizer`), input/article `aria-label`s, button names, the
`role="status"` / `role="alert"` regions, the idle-hint regex
(`/Works with any public YouTube sermon/i`), and the `words · min read` meta.

### Page structure (top → bottom)

1. **Header** (existing) — wordmark, h1, value-prop tagline; add a one-line
   "who it's for" sub-line ("Made for churches and ministries turning Sunday's
   message into a blog-ready recap.").
2. **The tool** (existing) — form, status, error, result, idle hint. Behavior
   unchanged.
3. **How it works** (NEW `<section>` + `<h2>`) — three numbered steps:
   (1) Paste the link · (2) We write the article · (3) Copy it into your site.
   Responsive grid (3-up desktop, stacked mobile).
4. **Example** (NEW `<section>` + `<h2>`) — a labeled "Example" excerpt of a
   **real** article, in the existing `.article` paper style, with a distinct
   `aria-label` ("Example article") so it doesn't collide with the live result's
   "Generated article".
5. **Footer** (NEW `<footer>`):
   - **Attribution (required):** "Made for churches and ministries." This is a
     non-optional element — it satisfies the "who's behind it" trust criterion
     (generic, no names, per the locked decision).
   - **Pilot note (required, legible):** an "Early pilot" line that is subtle but
     **clearly legible** — readable, not greyed into invisibility. (See the AC
     reconciliation below: #35's "pilot context is clear" is interpreted as
     "present and legible in the footer," honoring the footer-only decision.)
   - **Privacy line (present-tense fact, not a promise):** state what is true
     *today* — "Your links and generated articles aren't stored" — phrased as a
     current fact, **not** a durable guarantee. ⚠️ **Revalidation trigger:** this
     copy MUST be re-verified/updated the moment any saved-history or login work
     begins, since that feature would store exactly these items.
   - **Contact (optional/recommended):** a generic contact (email or "Contact"
     link) strengthens trust; include if available, otherwise omit.

### Idle-gating

Sections 3–4 render only when idle (`!article && !loading`), mirroring the
existing hint gate, so a generated article gets a clean, focused screen. The
footer always shows.

## Files to modify (implementation PR)

- `frontend/src/App.jsx` — header sub-line + `HowItWorks`, `Example`, `Footer`
  markup (inline sections / small local components matching existing JSX style);
  gate sections 3–4 on the idle condition.
- `frontend/src/App.css` — new classes (`.subhead`, `.how`, `.how__steps`,
  `.step`, `.step__num`, `.example`, `.example__label`, `.footer`) reusing
  existing tokens; rules under the existing `@media (max-width: 34rem)` and
  `prefers-reduced-motion` blocks.
- `frontend/src/App.test.jsx` — focused tests (preserve all existing assertions):
  - "How it works" steps render when idle.
  - Idle-gating: How-it-works **and** Example are hidden when an article is
    present **and** when `loading` (assert both states, not just article-present).
  - Footer renders, and contains the **required attribution** ("Made for churches
    and ministries"), the **pilot note**, and the **privacy line** copy.
  - The Example uses a **distinct** `aria-label="Example article"` (asserts it does
    not collide with the live result's `aria-label="Generated article"`).
- `frontend/index.html` — (optional) refine `<meta name="description">` to match
  the sharpened value prop.

## Inputs needed from the maintainer at implementation

- **One real generated article** to feature as the Example (trimmed to a tasteful excerpt).
- **(Optional) a contact** for the footer (email or "Contact" link), or confirm to omit.

## Example content governance (required before merge)

The featured example is a *real* article shown publicly, so before it ships:
- [ ] **Scrub identifying details** — remove/anonymize the church name, preacher
      name, and any other identifiers. This keeps the example consistent with the
      locked "generic, no-names" attribution decision (a real article will
      otherwise reintroduce exactly the names we chose to omit).
- [ ] **Confirm permission to publish** — verify it's acceptable to display this
      sermon-derived content publicly (it's reproduced on a public page).
- [ ] If either can't be satisfied, fall back to a clearly-labeled illustrative
      sample rather than a real one.

## Out of scope

- Accounts / login / saved history (separate, premature).
- Custom domain (#34).
- Backend/API changes; the `{ article, seo_description }` work is its own PR (PR B).

## Issue #35 — acceptance-criteria reconciliation & coverage

Some of #35's original ACs predate the maintainer's later locked decisions
(subtle/footer-only pilot framing, generic/no-names attribution, optional
contact). To keep the ticket and the plan from contradicting each other, #35's
ACs are reconciled as below (this PR also updates the issue text to match):

| #35 acceptance criterion | Reconciled interpretation | Satisfied by |
|---|---|---|
| Visitor understands *what* it does | unchanged | value-prop tagline (existing) |
| Visitor understands *who it's for* | unchanged | "who it's for" sub-line + footer attribution |
| Visitor understands *how to use it* | unchanged | "How it works" 3-step section |
| Clear to a general, non-technical audience; no jargon | + a plain-language read-through (see Verification) | all copy |
| Minimalist, on-brand, not cluttered | unchanged | reuse tokens, single column, idle-gating |
| Responsive + accessible; existing contracts preserved | unchanged | `clamp()` + 34rem breakpoint; tests |
| Honest framing — **"pilot" context is clear** | → **"pilot context present and legible in the footer"** (footer-only is the locked decision) | footer pilot note (legible) |
| Trust microcopy incl. **who is behind it** | → satisfied by the **required generic attribution line**; contact optional | footer attribution (required) |

## Plan-doc lifecycle

This doc is **retained as design history** (alongside `docs/PLAN.md` and
`docs/PROMPT_LOG.md`). When the implementation PR merges, add a one-line
"Implemented in PR #__" note at the top rather than deleting it, so the rationale
and review trail stay discoverable.

## Verification (implementation PR)

- `cd frontend && npm run lint` — clean.
- `cd frontend && npm test` — existing tests pass + new section tests pass.
- `cd frontend && npm run build` — succeeds.
- `npm run dev` eyeball: (a) cold-load idle state clearly explains what/who/how;
  (b) generating an article hides the explainer and shows a clean result;
  (c) responsive at small/mid/large widths; (d) keyboard/focus + reduced-motion intact.
- **Plain-language read-through:** read all visitor-facing copy as a non-technical
  first-timer; confirm no jargon and that what/who/how land without explanation.
