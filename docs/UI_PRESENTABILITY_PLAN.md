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
5. **Footer** (NEW `<footer>`) — "Made for churches and ministries", a subtle
   "Early pilot" note, an honest privacy line ("Private by default — we don't
   store your links or the articles we generate." — accurate today; revisit if a
   saved-history feature lands), and an optional contact.

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
- `frontend/src/App.test.jsx` — focused tests: "How it works" steps render when
  idle and hide once an article is present; footer renders; example renders.
  Preserve all existing assertions.
- `frontend/index.html` — (optional) refine `<meta name="description">` to match
  the sharpened value prop.

## Inputs needed from the maintainer at implementation

- **One real generated article** to feature as the Example (trimmed to a tasteful excerpt).
- **(Optional) a contact** for the footer (email or "Contact" link), or confirm to omit.

## Out of scope

- Accounts / login / saved history (separate, premature).
- Custom domain (#34).
- Backend/API changes; the `{ article, seo_description }` work is its own PR (PR B).

## Verification (implementation PR)

- `cd frontend && npm run lint` — clean.
- `cd frontend && npm test` — existing tests pass + new section tests pass.
- `cd frontend && npm run build` — succeeds.
- `npm run dev` eyeball: (a) cold-load idle state clearly explains what/who/how;
  (b) generating an article hides the explainer and shows a clean result;
  (c) responsive at small/mid/large widths; (d) keyboard/focus + reduced-motion intact.
