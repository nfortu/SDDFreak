---
description: Write or update this session's note in research/ with measured token and tool stats
argument-hint: "[extra context worth recording]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(python3 research/session-stats.py:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

## Context

- Session stats: !`python3 research/session-stats.py`
- Working tree: !`git status --short`
- Changes so far: !`git diff --stat HEAD`

## Your task

Write this session's note in `research/`, following `research/README.md` and the shape of
`research/_template.md`.

**One note per session — never two.** The `note` line in the stats above resolves the
current session id against existing notes:

- **A path** — that note is this session's. **Update it in place**: same filename, same
  session id. Refresh the stats table, extend `Asked` with any new user turns, extend
  `Did`/`Verified` with work done since the last flush, and revise `Learned` and
  `Follow-ups` in light of how things actually turned out. Do not append a second
  "run 2" section, and do not rename the file even if the session has moved on to a
  different topic — rewrite the title instead.
- **`- (none yet — create one)`** — create `research/YYYY-MM-DD-<short-slug>.md`, dated
  from the stats `date` line and slugged for the work, not the date.

Preserve any edits the user made to an existing note. Their words stay; you are updating
the record around them.

### Rules

- **Never estimate the numbers.** Every figure in the stats table comes from the stats
  output above. If something was not measured, leave it out rather than guessing.
- **Record what was not verified** as carefully as what was — commands that were never
  run, behavior never exercised in a browser, tests that do not exist. A note that only
  lists successes is worthless for its purpose.
- **`Learned` is the payload.** Wrong turns, friction, a constraint discovered halfway,
  something that worked well enough to repeat. Skip anything that is just a restatement
  of what changed — that already lives in `Did`. If nothing was genuinely learned, say
  so in one line instead of padding.
- **Keep it short.** Aim for a page. Cut `Did` down to the changes that would matter to
  someone reading this in three months.
- Write only inside `research/`. This command records work; it does not do work, fix
  follow-ups, or touch the spec or source.

`$ARGUMENTS` — if non-empty, the user has flagged something specific worth recording
(a dead end, a decision and its reasoning, a preference). Work it into the right section.

Finish by telling the user the note path, whether it was created or updated, and the
headline figures — model, fresh-in tokens, output tokens, duration.
