---
name: pr-sweep
description: Use when the user asks to sweep, triage, or check the health of their own open pull requests — looking for merge conflicts, failing CI, unanswered reviewer feedback, and non-draft PRs with no reviewer assigned.
---

# PR Sweep

Check every open PR the user authored for four problems — merge conflicts, CI trouble, unanswered
reviewer feedback, and missing reviewers — then help resolve them.

Two phases. **Report first:** one table of what needs attention. **Then work the queue:** one PR at a
time, proposing each action and waiting for a yes before doing anything that leaves the machine.

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

**Reviewer feedback.** Flag a PR when a review still stands and wants something: any entry in
`latestReviews` with state `CHANGES_REQUESTED` or `COMMENTED`. This covers drafts, since feedback on a
draft still needs an answer.

`reviewDecision` alone cannot carry this check, in either direction:

- It stays `REVIEW_REQUIRED` for a comment-only review. On the sample sweep, #4043 had five
  `COMMENTED` reviews and a decision of `REVIEW_REQUIRED`.
- It stays `CHANGES_REQUESTED` after the user answers and re-requests review, so it keeps flagging a
  PR whose ball is now in the reviewer's court.

**A re-requested reviewer means the work is done.** When `reviewDecision` is `CHANGES_REQUESTED` but
`latestReviews` holds no live review and `reviewRequests` is non-empty, the user already answered and
re-requested. Do not put it in the table as work; count it as awaiting re-review. GitHub drops a
reviewer from `latestReviews` when they are re-requested, which is what makes the two cases separable.

On the sample sweep, #5479 read `CHANGES_REQUESTED` with `latestReviews: []` and
`reviewRequests: [psi-orpc-experts, guillaumetecher-rc]`. Its timeline showed the review at 21:00, the
user's reply at 00:15:48, and the re-request 3 seconds later. Nothing for the user to do.

```bash
jq -r '[.[] | select(.reviewDecision == "CHANGES_REQUESTED"
  and ([.latestReviews[]? | .state] | (index("CHANGES_REQUESTED") or index("COMMENTED")) | not)
  and ((.reviewRequests | length) > 0)) | .number]' /tmp/pr-sweep.json
```

If the user wants those chased, the action is a nudge to the reviewer, never a code change.

**Reviewers.** A non-draft PR is covered when `reviewRequests` has any entry **or** `latestReviews`
has any entry. Drafts are exempt. Two traps:

- **Count entries. Never read `.login`.** `reviewRequests` holds `User` entries, which have
  `.login`, and `Team` entries, which have `.name` and `.slug` instead. `[.reviewRequests[].login]`
  returns `null` for a team, so a PR with a whole expert team assigned looks reviewer-less. On the
  same 22-PR sweep, the naive version flagged 14 PRs where only 7 were genuinely uncovered.
- **Check `latestReviews` too.** Once a requested reviewer submits a review, GitHub drops them from
  `reviewRequests`. Checking requests alone flags PRs already under review.

## 4. Work the queue, one PR at a time

**Re-fetch step 1 before starting.** A table built minutes ago is already out of date: reviewers get
assigned, runs finish, new PRs appear. Acting on a stale row wastes the user's time telling them about
a problem they already fixed.

Take one PR, finish or park it, then stop and ask before starting the next. Never open two PRs at
once, and never apply the same fix across several PRs in one step, however similar they look.
Incremental means the user sees each PR resolve before the next one begins.

**Open with the plan, then ask which action to start with.** State the numbered actions you intend to
take, one line each, naming the PR and the concrete change. Then ask which one to start with. Do not
ask whether to begin, and do not ask about a single PR as though it were the only option — the user
picks the order from a list they can see:

```
Here's what I plan to do:

1. #5538 — re-run the killed lint job, and add psi-orpc-experts as reviewer
2. #5530 — add psi-orpc-experts as reviewer, matching the rest of the docs series
3. #5524 — add psi-orpc-experts as reviewer
4. #5542 — read the failing server test, fix it in a worktree
5. #4043 — read the failing lint job and the five comment threads

Skipping #5521: CI still running. Skipping #5479: awaiting re-review.

Which should I start with?
```

Say what you are skipping and why, so a missing PR does not read as an oversight.

**Queue order.** Work the cheapest real problem first so the table shrinks fast:

| Problem | Actionable? |
| --- | --- |
| CI cancelled | Yes, a re-run |
| No reviewer | Yes, a suggestion to confirm |
| Reviewer feedback | Yes, usually a code change |
| CI failing | Yes, a code change |
| Merge conflict | Yes, a resolve |
| CI pending | No. The run decides. Say you are skipping it and why. |

**The loop, per PR.**

1. **Show the evidence.** The failed log, the thread bodies, the conflicting files. Never propose work
   from a table row alone; the row says a problem exists, not what it is.
2. **Propose one action** in a sentence or two, then wait for a yes.
3. **Work in a worktree** if the PR needs a code change. See the rules below.
4. **Make the change**, then run the checks that cover it, following the repo's own agent
   instructions. One heavy command at a time.
5. **Show the diff and stop.** Leave the work uncommitted for review. Do not commit as a side effect
   of finishing the edit.
6. **On approval, commit and push.** Never force-push, and never amend or rebase a commit that is
   already on the remote. A correction becomes a new commit on top.
7. **Then reply**, so the reply can cite the pushed SHA. Report what changed and ask whether to move
   to the next PR.

**Stop and ask first, every time, before:** pushing, assigning a reviewer, replying to a thread,
resolving a thread, re-running CI, editing the PR body, or merging. Approval on one PR is not approval
for the next one.

### Every code change happens in a worktree

**Never `gh pr checkout` or `git checkout` in the user's own checkout.** It switches their branch
under them and strands whatever they had in progress. Use the `EnterWorktree` tool, one worktree per
PR, and `ExitWorktree` when that PR is done.

- **Edit at the worktree path**, not the original repo path. The paths look alike, and editing the
  original silently puts the change on the wrong branch.
- **A PR needing no code edit needs no worktree.** Re-running CI and assigning a reviewer are API
  calls against a PR number. Do not create a worktree to run a `gh` command.
- **A fresh worktree carries only tracked files.** Tests that read untracked local config, such as
  `.env` files, fail there until those files are copied across from the main checkout. Copy them
  rather than concluding the branch is broken.
- **Finish one worktree before opening the next.** Parallel worktrees running the same heavy test
  suite will thrash the machine.

### Per-problem playbooks

**Cancelled CI.** Usually a superseded or manually stopped run, not a code problem. Prove that before
offering a re-run, because a re-run of a genuinely broken build just wastes ten minutes:

```bash
gh run view <run-id> --json headSha,conclusion,event    # does it match the PR head?
gh run list --branch <branch> --workflow <name> --limit 5   # did a newer run supersede it?
gh run view <run-id> --job <job-id> --log | grep -iE "error|cancel" | tail
```

The log settles it. A job killed mid-command shows its command running and then
`##[error]The operation was canceled`, with no errors of its own. Then re-run only the bad jobs:

```bash
gh run rerun <run-id> --failed
```

**`gh pr checks` prints `CANCELLED` as `fail`.** Trusting that display sends you hunting a bug that
does not exist. The rollup's `conclusion` field is authoritative.

**No reviewer.** Read `EXPERTS.md` at the repo root if it exists. Match the PR's Conventional Commit
scope and its changed paths to a subsystem row, then name one person and the row that put them there,
so the user can judge the pick:

```bash
gh pr view <n> --json files --jq '[.files[].path]'
gh pr edit <n> --add-reviewer <handle>
```

Suggest one reviewer, not a list. Spread picks across PRs rather than routing everything to one
person.

**Reviewer feedback.** List the open threads first. The table does not say whether the feedback is
still live:

```bash
~/.claude/skills/pr-sweep/unresolved-threads.sh <n>
```

Each thread is marked against the PR's last commit:

- `AFTER-PUSH` threads are untouched. These are the real work.
- `before-push` threads may already be answered by a later commit. Read the code at that path before
  deciding, then say which it is.
- `(outdated)` threads sit on code that has since changed. Usually stale.

Not every thread asks for a change. On the sample sweep one open thread read "glad we got rid of the
useEffect hack !!" — praise, needing only a resolve. Separate requests from remarks before proposing
work, and group threads that share one underlying decision instead of treating each as its own task.

**Failing CI.** Read the log before touching code. Guessing from the check name wastes a push:

```bash
gh pr checks <n>
gh run view --log-failed --job <job-id>   # job id from `gh pr checks <n>`
```

Reproduce the failure locally with the repo's own command, fix it, and re-run that command before
pushing.

**Merge conflict.** In the worktree, merge the base branch rather than rebasing, since the branch is
already pushed:

```bash
git fetch origin main && git merge origin/main
```

Resolve, run the checks, show the diff, then push after approval.

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
| Using `reviewDecision` alone for feedback | It stays `REVIEW_REQUIRED` for comment-only reviews and `CHANGES_REQUESTED` after a re-request. Read `latestReviews`. |
| Flagging a PR whose reviewer was re-requested | The user already answered. Count it as awaiting re-review, no row. |
| Asking "want me to start with #X?" | Give the numbered plan, then ask which action to start with. |
| Treating every open thread as work | Some are praise or already answered by a later push. Read the bodies. |
| Working several PRs in one step | One PR, then stop and ask. The user watches each one resolve. |
| Working the queue off a stale table | Re-fetch first. Reviewers and runs change between sweeps. |
| Trusting `gh pr checks` on a cancelled job | It prints `fail`. Read the rollup `conclusion` instead. |
| Re-running CI without reading the log | Prove the job was killed, not broken, or the re-run repeats it. |
| `gh pr checkout` in the user's checkout | Switches their branch under them. Use a worktree. |
| Editing the original path while a worktree is open | The change lands on the wrong branch. Edit at the worktree path. |
| Opening a worktree to run a `gh` command | Re-runs and reviewer edits need no checkout at all. |
| Committing as soon as the edit is done | Show the diff and stop. Commit after approval. |
| Amending or force-pushing a pushed commit | Corrections go on top as a new commit. |
| Replying to a thread before pushing | Push first so the reply can cite the SHA. |
| Reading one approval as blanket approval | Ask again for each PR and each outward-facing action. |
