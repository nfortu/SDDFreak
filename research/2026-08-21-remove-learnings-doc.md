# Remove backend/src/learnings.md — 2026-08-21

| | |
| - | - |
| **Session** | `384d8905-a121-45da-8886-911d96b8b696` |
| **Model** | `claude-opus-5` |
| **Duration** | ~4 min, 11 API calls, 1 user turn |
| **Tokens** | fresh in 62k · cache read 253k · output 4.4k *(at time of writing — the note itself adds a little)* |
| **Touched** | `backend/src/learnings.md` (deleted), `CLAUDE.md`, `research/README.md` |

## Asked

1. We do not need `backend/src/learnings.md` anymore — remove the file and update references.

## Did

- Deleted `backend/src/learnings.md`. Its only content was one paragraph arguing that
  replicating `FR-*` IDs into comments across the code is overkill and that requirement
  validation belongs in tests.
- `CLAUDE.md:19` — kept the rule ("do not sprinkle IDs across every function"), dropped the
  trailing `(backend/src/learnings.md)` citation. The rule already states the conclusion the
  deleted file argued for, so nothing was lost by removing the pointer.
- `research/README.md:6-8` — dropped the "and `backend/src/learnings.md` collects durable
  lessons" clause and reflowed the sentence. Notably this sentence was the one drawing the
  line between *spec* (what the system does), *learnings* (durable lessons) and *research*
  (session log). That three-way split is now a two-way one.

## Verified

- `grep -rn learnings .` (excluding `.git`, `node_modules`) → no hits.
- `git diff` → 3 files, +3/−9, exactly the intended hunks.
- **Not run:** no lint / typecheck / test / build. Docs-only change, no source touched —
  running them would have proved nothing about this diff.
- **Not done:** nothing committed (repo convention is commit only when asked).

## Learned

- Two `perl -0pi -e 's/.../.../'` multi-line substitutions silently no-op'd — `perl -pi`
  exits 0 whether or not anything matched, so the `&&` chain marched on and deleted the
  file while both reference edits had quietly failed. Only the follow-up `grep` caught it.
  The lesson is not "avoid perl" but **make the verification step part of the same command**:
  the grep that ran immediately after is what turned a silent failure into a two-minute fix.
  For prose in Markdown, line-addressed `sed` (`19s/.../`, `20d`) matched first try where
  the pattern match did not.
- Deleting lines by number then re-checking the *rendered* region is worth the extra call —
  the `9,10d` took the blank line before `## Convention` with it, which the diff showed but
  a "refs are gone" check alone would not have.
- When a doc's whole content is the rationale for a rule stated elsewhere, deleting it is
  safe; the judgement call is whether the surviving rule carries the *why*. Here it did.
  Worth flagging to the user rather than silently assuming.

## Follow-ups

- [ ] The user's original argument — "reflect requirement validation with unit tests, not
      ID comments" — now lives only as a one-line prohibition in `CLAUDE.md`. If the positive
      half (tests are where requirements get verified) matters, it belongs in the spec's
      verification-method language, not in a loose doc. Minor; the spec's `T/D/I` column
      arguably already says it.
