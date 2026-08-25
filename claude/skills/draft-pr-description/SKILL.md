---
name: draft-pr-description
description: Use when a pull request needs its description written or rewritten — a new PR body, filling in the repo template, or expanding a section a reviewer found thin — and this session holds the diff, measurements, and decisions that belong in it.
argument-hint: [pr-number-or-branch]
---

# Draft PR description

`codex` writes the prose. Your job is the brief.

`codex` runs in the repo and can read it, so it can check a path or a surrounding function
if it has to. It cannot see this conversation. Every decision, rejected alternative,
measurement and caveat reaches the description only through the brief you hand it, and a
thin brief produces a description that could sit on any pull request. Give `codex` enough
direction that it never needs to go exploring: what it finds by reading code is the diff
restated, which is the one thing a reviewer can already see for themselves.

## 1. Gather

Collect before you write a word of the brief. Run these from the repo.

```bash
git diff main...HEAD
git diff --stat main...HEAD
```

For a PR that already exists, take what is live so the draft starts from the current body:

```bash
gh pr view <n> --json title,body,isDraft,files --jq '{title, isDraft, files: [.files[].path]}'
gh pr view <n> --json body --jq .body > ~/projects/drafts/pr-<n>-current.md
```

Then dig for the prior state, which is the part you cannot reconstruct from the diff:

```bash
git log --oneline --follow -12 -- <path>       # what built this file, with PR numbers
git log --oneline -S '<removed-string>' -- <path>   # when the behaviour being changed arrived
```

## 2. Write the brief

Copy the template and fill every slot:

```bash
cp ~/.claude/skills/draft-pr-description/brief-template.md ~/projects/drafts/brief-<slug>.md
```

The slots are `What changed`, `Why now`, `Prior state`, `Measurements`, `Decisions`,
`Verified, not assumed`, `Out of scope`, `Testing`, `Must appear`, `Uncertainties`. A slot
with nothing real in it gets `None.` rather than a guess.

`Must appear` is the lever for a second pass. `codex` weighs relevance and will drop a
figure it judges redundant, reporting it under `unused`. When the author wants that figure
back, list it under `Must appear` and re-run rather than editing the body by hand: the
brief stays the source of truth, and the next run does not lose the fix.

Three slots carry most of the value, and all three come from the conversation rather than
the diff. Write them from what this session actually did:

| Slot | What belongs there |
| --- | --- |
| `Decisions` | Each choice, the alternative genuinely considered, why it lost. Including the ones you talked yourself out of. |
| `Verified, not assumed` | Everything checked with a command or an API call rather than reasoned about, and the check itself. Branch protection, downstream consumers, whether a flag survives, whether a skipped job blocks a merge. |
| `Uncertainties` | Estimated versus measured, what a reviewer should doubt, figures that rest on outliers. |

Scan back through the session for corrections. A number you revised, a design you priced
and rejected, an assumption that turned out wrong: those belong in `Decisions` or
`Uncertainties`. They are the details a reviewer would otherwise spend an hour
rediscovering, and they are invisible in the diff.

## 3. Run codex

```bash
~/.claude/skills/draft-pr-description/build-prompt.sh ~/projects/drafts/brief-<slug>.md
```

It prints the prompt path and, on stderr, a manifest naming the style guide, the repo's
format document, and the template it found. **Read the manifest.** If `format doc` says
`none found` in a repo you know documents its format, the search paths in the script need
the new location, and `codex` is about to invent a format instead.

```bash
codex exec - --sandbox read-only --skip-git-repo-check \
  --output-schema ~/.claude/skills/draft-pr-description/schema.json \
  --output-last-message /tmp/pr-description-result.json \
  < /tmp/pr-description-prompt.md > /tmp/pr-description-run.log 2>&1
```

Two plain commands, not a pipeline: a worktree-isolated session refuses compound commands
it cannot verify. Expect up to a couple of minutes. `codex` echoes the prompt to stdout,
which is why stdout goes to the log. If the result file is missing or `jq` cannot parse
it, read `/tmp/pr-description-run.log`.

## 4. Read the result before showing it

```bash
jq -r .body /tmp/pr-description-result.json > ~/projects/drafts/pr-<slug>.md
jq -r .title /tmp/pr-description-result.json
jq -r 'if (.gaps | length) == 0 then "(no gaps)" else .gaps[] | "- \(.)" end' /tmp/pr-description-result.json
jq -r 'if (.unused | length) == 0 then "(all used)" else .unused[] | "- \(.)" end' /tmp/pr-description-result.json
```

Check the body against the brief yourself, and name what you find:

- **Invented facts.** Any claim with no line in the brief behind it. This is the failure
  to hunt for hardest, because it reads as confident.
- **Dropped caveats.** A number that appears in the body without the qualifier the brief
  attached to it.
- **Overclaiming.** "Fixes", "removes", "resolves" where the brief only supports "reduces".
- **Lost structure.** Headings from the repo template, or an expander the format requires.

`gaps` is the useful half of the output. It names what to go measure before the next run,
and flags anything `codex` had to read the repo to resolve, which is a brief that needed
one more line.

## 5. Add the diff links

`codex` names files by path, because the pull request number usually does not exist when the
body is drafted. Once it does, turn the notable paths into diff-view links so a reviewer
lands on the hunk rather than the whole file:

```bash
~/.claude/skills/draft-pr-description/difflink.sh 5765 .github/workflows/e2e.yml 32
```

Link the one or two files that need real review, not every path in the body. Splice them in
with Edit.

## 6. Show, then apply

Relay the title, the body, the gaps, and anything you flagged. Then wait.

Editing a live PR body is a GitHub write, and it needs its own approval even when the
description was requested. Re-fetch before applying, in case it was edited meanwhile.

```bash
gh pr edit <n> --repo <owner>/<repo> --body-file ~/projects/drafts/pr-<slug>.md
gh pr create --repo <owner>/<repo> --title "<title>" --body-file ~/projects/drafts/pr-<slug>.md
```

Delete the brief and draft files from `~/projects/drafts/` once the GitHub operation
succeeds.

## Revising one section

A reviewer asking for more detail in one section does not need a whole regenerated body,
which would churn prose the author already approved. Fill only the relevant brief slots,
tell `codex` in the brief title that it is drafting that section alone, and splice the
result in with Edit.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Brief describes the diff and nothing else | The diff is the one thing a reviewer can already read. The brief earns its place through `Prior state`, `Decisions`, and `Verified`. |
| Session decisions left out | The repo is readable; the conversation is not. An alternative you priced and rejected is invisible unless you write it down. |
| Numbers without provenance | A figure with no method and no caveat comes back as a confident claim the reviewer cannot check. |
| Skipping the manifest on stderr | Without the repo's format document, `codex` invents a structure and the body arrives in the wrong shape. |
| Regenerating a whole body to fix one section | Splice one section. Wholesale regeneration rewrites prose the author already signed off. |
| Posting because the prose reads well | Fluent and wrong is the expected failure. Check every claim against a brief line. |
| Hand-patching a fact `codex` dropped | Put it under `Must appear` and re-run. Editing the body leaves the brief wrong, so the next run drops it again. |
| Filling empty slots with plausible text | `None.` is a valid answer and a useful signal. Invented content in the brief becomes invented content in the description. |
