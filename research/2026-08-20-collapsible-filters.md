# Collapsible filter facets — 2026-08-20

| | |
| - | - |
| **Session** | `e0b5ec5e-6c9e-491b-a10b-b73036c3773c` |
| **Model** | `claude-opus-5` |
| **Duration** | ~68 min, 74 API calls, 3 user turns |
| **Tokens** | fresh in 264k · cache read 3.68M · output 45k *(at time of writing — the note itself adds a little)* |
| **Touched** | `frontend/src/components/ui.tsx`, `frontend/src/pages/ProjectPage.tsx`, `specs/001-requirements-management-core.md`, `research/` |

## Asked

1. Put the type / status / priority filters in an expandable container, collapsed by
   default, so the UI is less cluttered — and update the spec.
2. Make the whole container clickable to toggle, with a right-aligned down chevron
   like the one on the sort `<select>`.
3. Start a `research/` folder: one note per session, tracking tokens and model, plus
   whatever else is worth keeping. Consider putting the convention in CLAUDE.md.

## Did

- New `Disclosure` component in `frontend/src/components/ui.tsx` — `<button>` with
  `aria-expanded`/`aria-controls` over a `hidden` region, plus `badge` and `actions` slots.
- Wrapped the three `FacetRow`s in it in `ProjectPage.tsx`, collapsed by default, with an
  "N active" badge and a `clearFacets()` that removes exactly `type`/`status`/`priority`
  from the URL.
- Whole header row toggles, via a stretched `after:absolute after:inset-0` overlay on the
  label button; `actions` sits in a `relative z-10` wrapper so "Clear filters" still takes
  its own clicks. Right-aligned inline-SVG chevron, rotating 180° when open.
- Spec: added **NFR-USE-008** (collapsed by default, whole header is the control,
  right-aligned state indicator), **NFR-USE-009** (active count + clear control,
  expanded when the URL carries filters), **FR-SRCH-010** (filter state lives in the URL),
  two acceptance-checklist items, version 0.5 → 0.6.
- This folder, plus `session-stats.py` and the CLAUDE.md section pointing at it.

## Verified

- `npm run typecheck`, `npm run lint`, `npm run build` in `frontend/` → all pass.
- Not verified in a browser. The click/keyboard behavior and the overlay/z-index
  interaction between the row toggle and the "Clear filters" button are reasoned about,
  not observed. There are no frontend tests in the repo, so nothing covers this.

## Learned

- **The spec had a gap the UI change exposed.** NFR-USE-009 needed to reference
  URL-carried filter state, and no requirement said the URL carried it — the code did it
  anyway. Writing the spec change first surfaced the undocumented behavior; writing the
  code first would have hidden it. Worth doing in that order deliberately.
- **Hiding a filter needs a compensating affordance.** Collapsing filters that are
  silently applied is a trap, so the active-count badge and clear control are not extras —
  they are what makes the collapse safe. That reasoning became NFR-USE-009 rather than
  staying an unwritten judgement call.
- **"Make the container clickable" has a real constraint**: a wrapping `<button>` would
  have nested the "Clear filters" button inside it, which is invalid. The stretched-overlay
  pattern keeps one accessible control and one focus stop.
- **The token profile is lopsided toward cache reads** (3.68M read vs 264k fresh) across
  a session that changed maybe 120 lines. That is the shape of a long conversation, not of
  expensive work — the fresh-input figure is the one to watch.
- Two Bash calls were wasted on a stale `cd` (working directory persists between calls) and
  one on Python 3.9 not accepting `str | None` annotations. Absolute paths and
  `from __future__ import annotations` avoid both.

## Follow-ups

- [ ] No frontend test setup at all (no vitest, no testing-library). The new component and
      the two new checklist items rely on manual demonstration. Worth deciding whether that
      is acceptable for the `D` verification method or whether the frontend needs a runner.
- [ ] `README.md` said SPEC-001 v0.5; updated to v0.6 here. The version appears in two
      places — a candidate for a CI check like the OpenAPI drift gate already in `ci.yml`.
