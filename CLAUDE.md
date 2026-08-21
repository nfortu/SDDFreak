# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A requirements management system that is **built to its own specification**.
`specs/001-requirements-management-core.md` is the source of truth: every behavior
carries a stable requirement ID (`FR-*`, `NFR-*`, `TR-*`) and a verification method
(T = test, D = demonstration, I = inspection).

## Spec-first

A behavior change is a spec change plus the code that satisfies it — in that order.

- Add or amend the requirement in `specs/`, bump the version and **Last updated** in the
  header, and add an acceptance-checklist item in the closing section.
- Then write the code. Reference the requirement ID in a comment only where the *why*
  is not obvious from the code — do not sprinkle IDs across every function.
- Propagate: the spec version appears in `README.md`; `backend/openapi.json` is generated
  (`npm run openapi`) and CI fails on drift; `frontend/src/api/schema.d.ts` is generated
  from it (`npm run gen:api`).
- If implementing a change reveals behavior the spec never described, write the missing
  requirement rather than quietly relying on it.

## Verify before reporting done

```bash
cd backend  && npm run lint && npm run typecheck && npm test
cd frontend && npm run lint && npm run typecheck && npm run build
```

There are **no frontend tests** — no runner is configured. UI work is verified by
typecheck, lint, build, and manual demonstration. Say so plainly rather than implying
coverage that does not exist.

## Session notes

At the end of a session, run **`/flush-to-research`** — it writes or updates this
session's note in `research/`. The conventions live in
[`research/README.md`](research/README.md); the command itself carries the rest.

## Conventions

- Match the surrounding code — comment density, naming, Tailwind class ordering.
- Frontend shared primitives live in `frontend/src/components/ui.tsx`; add to it rather
  than growing one-off styled markup in pages.
- List filter/sort/search state lives in the URL (FR-SRCH-010), so views are shareable.
- Commit or push only when asked.
