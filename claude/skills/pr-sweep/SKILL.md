---
name: pr-sweep
description: Use when the user asks to sweep, triage, or check the health of their own open pull requests — looking for merge conflicts, failing CI, unanswered reviewer feedback, and non-draft PRs with no reviewer assigned.
---

# PR Sweep

Check every open PR the user authored for four problems — merge conflicts, CI trouble, unanswered
reviewer feedback, and missing reviewers — then report only what needs attention and suggest next
steps. Suggest them. Do not fix conflicts, re-run CI, assign reviewers, resolve threads, or merge
anything.

Two files sit beside this one:

- `report.jq` implements all four checks against the fetched JSON. Run it rather than rebuilding the
  logic by hand: the traps below are already handled there.
- `unresolved-threads.sh <pr-number>` lists a PR's open review threads and marks each as older or
  newer than the last push.

## 1. Fetch the PRs

Run from inside a repo checkout, which sweeps that repo:

```bash
gh pr list --author @me --state open --limit 100 \
  --json number,title,url,isDraft,mergeable,mergeStateStatus,reviewRequests,latestReviews,reviewDecision,statusCheckRollup \
  > /tmp/pr-sweep.json
```

If the working directory is not a repo, sweep across repos instead and say so in the report:

```bash
gh search prs --author=@me --state=open --limit 100 --json repository,number
```

## 2. Build the table

```bash
jq -rf ~/.claude/skills/pr-sweep/report.jq /tmp/pr-sweep.json
```

That emits one markdown row per PR needing attention, worst problem first. Add the header, then the
counts below it:

```markdown
| PR | Title | Needs |
| --- | --- | --- |
| [#4043](https://github.com/wearenewpublic/psi-product/pull/4043) | docs: Document the v2 HTTP API design | CI failing (draft) |
| [#5538](https://github.com/wearenewpublic/psi-product/pull/5538) | docs(orpc): describe the participants and pol… | CI cancelled, no reviewer |

14 of 22 PRs are clean. No merge conflicts. 1 draft skipped by the reviewer check.
```

Get the counts with:

```bash
jq -r '"total=\(length) drafts=\([.[] | select(.isDraft)] | length)"' /tmp/pr-sweep.json
```

Keep the table readable in a terminal:

- **Never pad columns with spaces.** The renderer sets the widths. Hand-padding is what makes every
  row wrap.
- Titles are already cut to 45 characters by `report.jq`. Do not lengthen them.
- On a cross-repo sweep, add a `Repo` column holding `nameWithOwner`.
- Do not table every PR. With 20 or more open, a full list buries the rows that matter.

## 3. What each check means

Read this when a result looks wrong, or before changing `report.jq`.

**Merge conflicts.**

| `mergeable` | Meaning | Action |
| --- | --- | --- |
| `CONFLICTING` | Real conflict | Report it |
| `UNKNOWN` | GitHub has not computed it yet | Re-query, see below |
| `MERGEABLE` | No conflict | Ignore |

Ignore `mergeStateStatus` values `BLOCKED`, `BEHIND`, and `UNSTABLE`. They mean review required,
branch behind its base, and failing checks. None is a conflict, and `BLOCKED` is the normal resting
state for most open PRs.

GitHub computes mergeability lazily, so a fresh query can return `UNKNOWN`. Wait a few seconds, then
re-query only those PRs, once. Still `UNKNOWN`? Report it as unknown, never as clean.

```bash
gh pr view <n> --json number,mergeable,mergeStateStatus
```

**CI status.** This check covers drafts too. Red CI matters on a draft, unlike a missing reviewer.
Four outcomes, each needing a different response:

- **failing** — a real red check. Needs a code fix.
- **pending** — still running. Not a pass. Say it is in flight.
- **cancelled** — usually a superseded or manually stopped run, not a code problem. Needs a re-run.
- **zero checks** — CI never ran. Report it; an empty rollup is not green.

Two traps:

- **`SKIPPED` and `NEUTRAL` are not failures.** Conditional workflows skip constantly. On a healthy
  22-PR sweep of `psi-product`, 105 of 603 checks were `SKIPPED` against 496 `SUCCESS`. Treating
  skips as failures flags every PR.
- **Read both entry shapes.** `statusCheckRollup` mixes `CheckRun` entries, which carry `.status` and
  `.conclusion`, with `StatusContext` entries, which carry `.state`. Reading `.conclusion` alone
  returns `null` for every status context and for every run still in progress.

**Reviewer feedback.** Flag a PR when `reviewDecision` is `CHANGES_REQUESTED`, **or** any entry in
`latestReviews` has state `CHANGES_REQUESTED` or `COMMENTED`. This covers drafts: feedback on a draft
still needs an answer. Both signals are required, because each misses cases the other catches:

- `reviewDecision` stays `REVIEW_REQUIRED` for a comment-only review. On the sample sweep, #4043 had
  five `COMMENTED` reviews and a decision of `REVIEW_REQUIRED`.
- `latestReviews` goes empty once a reviewer is re-requested after asking for changes. #5479 read
  `CHANGES_REQUESTED` with `latestReviews: []`.

**Reviewers.** A non-draft PR is covered when `reviewRequests` has any entry **or** `latestReviews`
has any entry. Drafts are exempt. Two traps:

- **Count entries. Never read `.login`.** `reviewRequests` holds `User` entries, which have
  `.login`, and `Team` entries, which have `.name` and `.slug` instead. `[.reviewRequests[].login]`
  returns `null` for a team, so a PR with a whole expert team assigned looks reviewer-less. On the
  same 22-PR sweep, the naive version flagged 14 PRs where only 7 were genuinely uncovered.
- **Check `latestReviews` too.** Once a requested reviewer submits a review, GitHub drops them from
  `reviewRequests`. Checking requests alone flags PRs already under review.

## 4. Suggest next steps, run nothing

**Conflict.** Print the commands and ask before running any of them. Never force-push.

```bash
gh pr checkout <n>
git fetch origin main && git merge origin/main   # resolve, commit, push
```

**Failing CI.** Name the failing check, then offer to look:

```bash
gh pr checks <n>
gh run view --log-failed --job <job-id>   # job id from `gh pr checks <n>`
```

**Cancelled CI.** Suggest a re-run rather than a code change, since the run was probably superseded:

```bash
gh run rerun <run-id> --failed
```

**Reviewer feedback.** List the open threads first, because the table alone does not say whether the
feedback is still live:

```bash
~/.claude/skills/pr-sweep/unresolved-threads.sh <n>
```

Each thread is marked `before-push` or `AFTER-PUSH`, compared against the PR's last commit.

- `AFTER-PUSH` threads are untouched. These are the real work.
- `before-push` threads may already be answered by a later commit. Check the code before assuming
  either way, then say which it is.
- `(outdated)` threads sit on code that has since changed. Usually stale.

Not every thread asks for a change. On the sample sweep one open thread read "glad we got rid of the
useEffect hack !!" — praise, needing only a resolve. Read the bodies and separate requests from
remarks before proposing work.

Then offer to address them: summarize what each reviewer wants, propose the change per thread, and
ask which to take on. Reply to threads only after the fix is pushed, so the reply can cite the
commit. Do not push, resolve a thread, or reply on the user's behalf without being asked.

**No reviewer.** Read `EXPERTS.md` at the repo root if it exists. Match the PR's Conventional Commit
scope and its changed paths (`gh pr view <n> --json files`) to a subsystem row, then suggest one
person and name the row that put them there:

```bash
gh pr edit <n> --add-reviewer <handle>
```

The user assigns reviewers. Do not run that command unless they ask.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Hand-padding table columns | The renderer sets widths. Padding wraps every row. |
| Building PR links from `owner/repo` | Use the `url` field. A cross-repo sweep spans repos. |
| Counting `SKIPPED` checks as failures | Conditional workflows skip by design. Only the `bad` list fails. |
| Reading `.conclusion` off every check | `StatusContext` uses `.state`. In-progress runs have no conclusion. |
| Calling a PR green while checks run | Pending is not passing. Report it as in flight. |
| Reading an empty rollup as green | Zero checks means CI never ran. Report it. |
| Skipping the CI check on drafts | Red CI matters on a draft. Only the reviewer check exempts drafts. |
| Reporting `BLOCKED` as a conflict | `BLOCKED` means review required. Only `CONFLICTING` or `DIRTY` conflicts. |
| Reading `.login` off `reviewRequests` | Team entries have no login. Count entries. |
| Treating `UNKNOWN` mergeability as no conflict | Re-query once, then report it as unknown. |
| Checking `reviewRequests` alone | A submitted review clears the request. Check `latestReviews` too. |
| Using `reviewDecision` alone for feedback | It stays `REVIEW_REQUIRED` for comment-only reviews. Check `latestReviews` states too. |
| Treating every open thread as work | Some are praise or already answered by a later push. Read the bodies. |
| Assigning the reviewer, re-running CI, resolving threads, or replying | Suggest the command. The user runs it. |
