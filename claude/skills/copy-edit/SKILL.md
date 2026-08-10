---
name: copy-edit
description: Use when the user asks to copy edit, tighten, or clean up a draft for clarity — a pull request description, a GitHub issue body or comment, or other short prose — before it gets posted.
argument-hint: [path-to-draft]
---

# Copy Edit

Send a draft to `codex` for a clarity pass, show the result as a diff, and wait for approval before
you overwrite anything.

## 1. Find the file

`codex` reads a file, so the draft must be on disk.

- Path given as an argument: use it.
- No argument: use the draft this session is already working on, usually in `~/projects/drafts/`.
  If the context does not point at one file, ask. Do not guess.
- Text lives only in the conversation: write it to `~/projects/drafts/<slug>.md` first.
- Text is already posted on GitHub: fetch what is live, so the edit starts from the current body.
  ```bash
  gh pr view <n> --json body --jq .body > ~/projects/drafts/<slug>.md
  gh issue view <n> --json body --jq .body > ~/projects/drafts/<slug>.md
  ```

## 2. Run codex

```bash
SKILL=~/.claude/skills/copy-edit
FILE=~/projects/drafts/<slug>.md

{ cat "$SKILL/instructions.md"; echo; cat "$FILE"; } | \
  codex exec - --sandbox read-only --skip-git-repo-check \
    --output-schema "$SKILL/schema.json" \
    --output-last-message /tmp/copy-edit-result.json \
    > /tmp/copy-edit-run.log 2>&1
```

The draft goes in over stdin and the sandbox is read-only, so `codex` cannot touch the original.
Expect it to take up to a minute. Send stdout to the log: `codex` echoes the whole prompt back. If
the result file is missing or `jq` cannot parse it, read `/tmp/copy-edit-run.log`.

## 3. Show the result

```bash
jq -r .revised /tmp/copy-edit-result.json > /tmp/copy-edit-revised.md
git diff --no-index --word-diff=plain -- "$FILE" /tmp/copy-edit-revised.md
jq -r '.notes[] | "- \(.why)\n  - was: \(.before)\n  - now: \(.after)"' /tmp/copy-edit-result.json
jq -r 'if (.questions | length) == 0 then "(no questions)" else .questions[] | "- \(.)" end' /tmp/copy-edit-result.json
```

Use `--word-diff`, not a line diff: one paragraph per line makes a line diff useless for prose.

Relay all three parts to the user: the diff, then the notes, then the questions. Read the diff
yourself first and call out any edit that changes a technical claim or drops a qualifier that
carried meaning.

## 4. Apply only after approval

```bash
cp /tmp/copy-edit-revised.md "$FILE"
```

Never write over the draft before the user approves it. If they want only some of the edits, apply
those by hand with Edit and leave the rest. Posting to GitHub is a separate, later step that needs
its own approval.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Accepting the revision because it reads well | `codex` will occasionally cut a qualifier that carried real meaning. Read the diff. |
| Overwriting the draft, then showing the diff | Show first. The user may want none of it. |
| Editing a stale copy of a posted body | Re-fetch with `gh` before the run. |
| Losing template structure | Check that the headings from `.github/pull_request_template.md`, or an issue's `**Done is:**` block, survived. |
| Hard-wrapped output | Look for a paragraph split across lines in the diff and reject it. |
