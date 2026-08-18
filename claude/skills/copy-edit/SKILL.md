---
name: copy-edit
description: Use when the user asks to copy edit, tighten, or clean up a draft for clarity — a pull request description, a GitHub issue body or comment, a doc, or other prose — before it gets posted or committed.
argument-hint: [path-to-draft]
---

# Copy Edit

Send text to `codex` for a clarity pass under the house style rules, show the result as a diff, and
wait for approval before you overwrite anything.

## 1. Find the file

`codex` reads a file, so the text must be on disk.

- Path given as an argument: use it.
- No argument: use the draft this session is already working on, usually in `~/projects/drafts/`.
  If the context does not point at one file, ask. Do not guess.
- Text lives only in the conversation: write it to `~/projects/drafts/<slug>.md` first.
- Text is already posted on GitHub: fetch what is live, so the edit starts from the current body.
  ```bash
  gh pr view <n> --json body --jq .body > ~/projects/drafts/<slug>.md
  gh issue view <n> --json body --jq .body > ~/projects/drafts/<slug>.md
  ```

## 2. Choose the scope

**Send only the prose you are responsible for.** Anything you send comes back edited, so a whole
file goes in only when the whole file is up for editing.

| Situation | Send |
| --- | --- |
| A draft you wrote, whole | The file. |
| A file you edited in part — a doc where you added two sections, an existing page you touched | Only the sections you changed. |
| A long file where one section is under discussion | Only that section. |

For part of a file, cut the region to a temp file and edit that:

```bash
sed -n '40,72p' docs/architecture/authentication.md > /tmp/copy-edit-input.md
awk '/^## Auth$/,/^## HTTP status codes$/' docs/architecture/orpc.md > /tmp/copy-edit-input.md
```

Check the extract before sending it: whole sections, balanced code fences, no half sentence at
either end. Splice the result back with Edit in step 5, not by overwriting the file.

Tell the user which scope you chose and why.

## 3. Build the prompt and run codex

`build-prompt.sh` assembles three parts: the `## Writing` section of `~/.claude/CLAUDE.md`, the
copy-edit brief, and the text. Run it, then run `codex`.

```bash
~/.claude/skills/copy-edit/build-prompt.sh /tmp/copy-edit-input.md
```

```bash
codex exec - --sandbox read-only --skip-git-repo-check \
  --output-schema ~/.claude/skills/copy-edit/schema.json \
  --output-last-message /tmp/copy-edit-result.json \
  < /tmp/copy-edit-prompt.md > /tmp/copy-edit-run.log 2>&1
```

Two plain commands, not a pipeline: a worktree-isolated session refuses compound commands it cannot
verify. The sandbox is read-only, so `codex` cannot touch the original. Expect up to a minute.
`codex` echoes the whole prompt to stdout, which is why stdout goes to the log. If the result file is
missing or `jq` cannot parse it, read `/tmp/copy-edit-run.log`.

## 4. Show the result

```bash
jq -r .revised /tmp/copy-edit-result.json > /tmp/copy-edit-revised.md
```

```bash
git diff --no-index --word-diff=plain -- /tmp/copy-edit-input.md /tmp/copy-edit-revised.md
```

```bash
jq -r '.notes[] | "- \(.why)\n  - was: \(.before)\n  - now: \(.after)"' /tmp/copy-edit-result.json
jq -r 'if (.questions | length) == 0 then "(no questions)" else .questions[] | "- \(.)" end' /tmp/copy-edit-result.json
```

Use `--word-diff`, not a line diff: one paragraph per line makes a line diff useless for prose.

Relay all three parts to the user: the diff, then the notes, then the questions. Read the diff
yourself first and call out, by name:

- Any edit that changes a technical claim.
- Any dropped qualifier that carried meaning.
- Any rewrapped paragraph. Reject those; they bury the real edits.
- Any paragraph you did not intend to send.

## 5. Apply only after approval

Whole file:

```bash
cp /tmp/copy-edit-revised.md "$FILE"
```

Part of a file: splice with Edit, one hunk at a time. Same when the user wants some edits and not
others.

Never write over the original before the user approves. Posting to GitHub is a separate, later step
that needs its own approval.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Sending a whole file when you only wrote part of it | Extract the region first. Every paragraph you send comes back rewritten, and prose churn in untouched sections widens the review for no gain. |
| Accepting the revision because it reads well | `codex` will occasionally cut a qualifier that carried real meaning, or restate a technical claim wrongly. Read the diff. |
| Overwriting the original, then showing the diff | Show first. The user may want none of it. |
| Accepting a rewrapped file | A hard-wrapped file must come back hard wrapped. If every line changed, the edit is unreviewable. Re-run or apply by hand. |
| Editing a stale copy of a posted body | Re-fetch with `gh` before the run. |
| Losing template structure | Check that the headings from `.github/pull_request_template.md`, or an issue's `**Done is:**` block, survived. |
