---
name: copy-edit
description: Use when the user asks to copy edit, tighten, or clean up a draft for clarity — a pull request description, a GitHub issue body or comment, a doc, or other prose — before it gets posted or committed.
argument-hint: [path-to-draft]
---

# Copy Edit

Make a clarity pass over the text under the house style rules in the `## Writing` section of
`~/.claude/CLAUDE.md` and the rules in `rules.md`. Edit a copy, show the result as a diff, and
wait for approval before you overwrite anything.

## 1. Find the file

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

**Edit only the prose you are responsible for.** A whole file is in scope only when the whole
file is up for editing.

| Situation | Edit |
| --- | --- |
| A draft you wrote, whole | The file. |
| A file you edited in part — a doc where you added two sections, an existing page you touched | Only the sections you changed. |
| A long file where one section is under discussion | Only that section. |

Copy the scope to a working pair of files: the input stays untouched as the baseline for the
diff, and you edit the revised copy.

```bash
cp "$FILE" /tmp/copy-edit-input.md
sed -n '40,72p' docs/architecture/authentication.md > /tmp/copy-edit-input.md
awk '/^## Auth$/,/^## HTTP status codes$/' docs/architecture/orpc.md > /tmp/copy-edit-input.md
```

```bash
cp /tmp/copy-edit-input.md /tmp/copy-edit-revised.md
```

For part of a file, check the extract: whole sections, balanced code fences, no half sentence at
either end. Splice the result back with Edit in step 5, not by overwriting the file.

Tell the user which scope you chose and why.

## 3. Edit

Read `rules.md` in this skill's directory, then edit `/tmp/copy-edit-revised.md` with Edit, one
sentence or paragraph at a time. Never rewrite the file with Write: a regenerated file drifts in
line breaks and whitespace, and the diff stops showing only the real edits.

As you go, keep two lists for step 4:

- **Notes.** The substantive edits: a sharpened sentence, a cut claim, a resolved ambiguity.
  Skip punctuation fixes and single-word swaps.
- **Questions.** Anything you could not fix without more information.

## 4. Show the result

```bash
git diff --no-index --word-diff=plain -- /tmp/copy-edit-input.md /tmp/copy-edit-revised.md
```

Use `--word-diff`, not a line diff: one paragraph per line makes a line diff useless for prose.

Relay three parts to the user: the diff, then the notes, then the questions. Keep each note to a
short before and after, enough to locate the change, plus one sentence on why. Call out, by name:

- Any edit that changes a technical claim.
- Any qualifier you cut, and why it was empty.

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
| Editing a whole file when you only wrote part of it | Extract the region first. Prose churn in untouched sections widens the review for no gain. |
| Accepting your own revision because it reads well | Read the diff as a reviewer would. A cut qualifier or a restated technical claim reads fluently and is still wrong. |
| Overwriting the original, then showing the diff | Show first. The user may want none of it. |
| Rewrapping a paragraph | A hard-wrapped file stays hard wrapped. If every line changed, the edit is unreviewable. |
| Editing a stale copy of a posted body | Re-fetch with `gh` before editing. |
| Losing template structure | Check that the headings from `.github/pull_request_template.md`, or an issue's `**Done is:**` block, survived. |
