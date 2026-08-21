# research/

One note per Claude Code session, so we can look back at how this repo actually
gets built and get better at driving it.

These are **not** project documentation — the spec is the source of truth for what
the system does, and `backend/src/learnings.md` collects durable lessons. A note
here is a log entry: what was asked, what changed, what it cost, and what we would
do differently next time.

## Convention

- One file per session: `YYYY-MM-DD-<short-slug>.md`, named for the work, not the date alone.
- Start from [`_template.md`](_template.md).
- Keep it short. A note that takes ten minutes to write will not get written.
- Write it at the end of a session, while the friction is still fresh.

Run **`/flush-to-research`** (`.claude/commands/flush-to-research.md`) and Claude writes the
note for you. Safe to run repeatedly: it matches the current session id against existing
notes and updates the one it finds, so a mid-session flush and an end-of-session flush
produce one file, not two.

## Getting the numbers

Do not estimate token counts. Claude Code writes a transcript per session to
`~/.claude/projects/<slugified-project-path>/<session-id>.jsonl`, with a `usage`
block on every API response. [`session-stats.py`](session-stats.py) reads it:

```bash
python3 research/session-stats.py              # most recent session for this project
python3 research/session-stats.py <session-id> # a specific one
```

It prints the model, duration, API call count, the four token figures, a tool-call
histogram, the user prompts, and — on the `note` line — the existing note for this session
if there is one, which is what keeps repeated flushes from piling up files.

**Reading the token figures.** `cache read` dominates and should: every turn re-sends
the conversation, and cached input is far cheaper than fresh input. The number that
tracks real work is `fresh in` (uncached input + cache writes) — it grows when new
file content enters the context. A session with a large `fresh in` relative to its
output either explored a lot of code or re-read things it already had.
