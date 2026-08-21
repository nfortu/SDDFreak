#!/usr/bin/env python3
"""Summarise a Claude Code session transcript into the numbers research/ notes record.

Usage:  python3 research/session-stats.py [session-id-or-path]

With no argument it picks the most recently modified transcript for this project.
Transcripts live in ~/.claude/projects/<slugified-project-path>/<session-id>.jsonl and
carry per-request `usage` blocks, so every figure here is measured rather than estimated.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

PROJECT_DIR = Path.home() / '.claude/projects/-Users-nfortunato-projects-SDDFreak'
RESEARCH_DIR = Path(__file__).resolve().parent


def existing_note(session_id):
    """The note already written for this session, if any — so a re-run updates it."""
    for note in sorted(RESEARCH_DIR.glob('*.md')):
        if note.name.startswith('_'):
            continue
        if session_id in note.read_text():
            return note
    return None


def resolve(arg: str | None) -> Path:
    if arg:
        p = Path(arg)
        return p if p.exists() else PROJECT_DIR / f'{arg}.jsonl'
    return max(PROJECT_DIR.glob('*.jsonl'), key=lambda p: p.stat().st_mtime)


def main() -> None:
    path = resolve(sys.argv[1] if len(sys.argv) > 1 else None)
    records = []
    for line in path.read_text().splitlines():
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    totals = Counter()
    models, tools, prompts, stamps = set(), Counter(), [], []
    api_calls = 0

    for record in records:
        stamp = record.get('timestamp')
        if stamp:
            stamps.append(stamp)
        message = record.get('message')
        if not isinstance(message, dict):
            continue

        if record.get('type') == 'user' and isinstance(message.get('content'), str):
            prompts.append(message['content'])

        if record.get('type') != 'assistant':
            continue
        if message.get('model'):
            models.add(message['model'])
        usage = message.get('usage') or {}
        if usage:
            api_calls += 1
            for key in ('input_tokens', 'output_tokens', 'cache_read_input_tokens',
                        'cache_creation_input_tokens'):
                totals[key] += usage.get(key) or 0
        for block in message.get('content') or []:
            if isinstance(block, dict) and block.get('type') == 'tool_use':
                tools[block.get('name', '?')] += 1

    fresh = totals['input_tokens'] + totals['cache_creation_input_tokens']
    # Transcript timestamps are UTC; report in local time so the note's date matches the day
    # the work actually happened.
    parse = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone()
    started = parse(min(stamps)) if stamps else None
    minutes = round((parse(max(stamps)) - started).total_seconds() / 60, 1) if len(stamps) >= 2 else None

    note = existing_note(path.stem)
    print(f'session      {path.stem}')
    print(f'note         {note.relative_to(RESEARCH_DIR.parent) if note else "- (none yet — create one)"}')
    print(f'model        {", ".join(sorted(models)) or "-"}')
    print(f'date         {started.strftime("%Y-%m-%d %H:%M") if started else "-"} local')
    print(f'duration     {minutes} min' if minutes is not None else 'duration     -')
    print(f'api calls    {api_calls}')
    print(f'user turns   {len(prompts)}')
    print()
    print(f'input        {totals["input_tokens"]:>9,}  (uncached)')
    print(f'cache write  {totals["cache_creation_input_tokens"]:>9,}')
    print(f'cache read   {totals["cache_read_input_tokens"]:>9,}')
    print(f'output       {totals["output_tokens"]:>9,}')
    print(f'fresh in     {fresh:>9,}  (input + cache write)')
    print(f'total in     {totals["input_tokens"] + totals["cache_creation_input_tokens"] + totals["cache_read_input_tokens"]:>9,}')
    print()
    print('tool calls   ' + (', '.join(f'{name} x{n}' for name, n in tools.most_common()) or '-'))
    print()
    for i, prompt in enumerate(prompts, 1):
        one_line = ' '.join(prompt.split())
        print(f'  {i}. {one_line[:110]}{"…" if len(one_line) > 110 else ""}')


if __name__ == '__main__':
    main()
