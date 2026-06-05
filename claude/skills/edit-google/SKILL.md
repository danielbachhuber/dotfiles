---
description: Pin a Google Doc or Sheet for editing this session, or `list` / `remove` pins
argument-hint: <url-or-id> | list | remove <alias|id>
allowed-tools: [Bash]
disable-model-invocation: true
---

!`~/.claude/scripts/edit-google-pin.ts $ARGUMENTS`

After pinning, edit the document with `~/.claude/scripts/edit-google-doc.ts <outline|find-replace|insert|append|apply>` or `~/.claude/scripts/edit-google-sheet.ts <get|set|append|apply>`. When more than one doc/sheet is pinned, pass `--doc <alias|id>` / `--sheet <alias|id>` to choose the target. Start a doc edit with `outline` to get paragraph indices.
