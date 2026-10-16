---
description: Pin a Google Doc or Sheet for editing this session, or `list` / `remove` pins
argument-hint: <url-or-id> | list | remove <alias|id>
allowed-tools: [Bash]
disable-model-invocation: true
---

!`noglob ~/.claude/scripts/edit-google-pin.ts $ARGUMENTS`

After pinning, edit the document with `~/.claude/scripts/edit-google-doc.ts <outline|find-replace|insert|append|markdown|rows|find-row|set-cell|insert-row|delete-row|apply>` or `~/.claude/scripts/edit-google-sheet.ts <get|set|append|apply>`. When more than one doc/sheet is pinned, pass `--doc <alias|id>` / `--sheet <alias|id>` to choose the target. Start a doc edit with `outline` to get paragraph indices. For table rows, use `find-row`, `set-cell`, `insert-row`, and `delete-row`, which find rows by their first cell's text.

Notes:
- `find-replace <find> <replace>` runs across the whole document (all tabs); `insert`/`append` are tab-scoped (default first tab, override with `--tab <id>`).
- `apply <requests.json>` is the escape hatch for anything not covered: pass a path to a JSON file containing a raw array of Google Docs/Sheets `batchUpdate` request objects (or `{"requests":[...]}`). Use it for formatting, tables, inserting rows/sheets, etc.
