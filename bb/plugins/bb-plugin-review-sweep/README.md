# bb-plugin-review-sweep

A bb sidebar panel listing every open pull request waiting on a review from you,
across all repositories, oldest request first.

The sweep is deterministic: it runs one `gh` query, classifies the result with
pure functions, and spends no model tokens. An agent is only involved when you
click a row's action.

## Install on a new machine

```bash
cd ~/.dotfiles/bb/plugins/bb-plugin-review-sweep
npm install
bb plugin install . --yes
```

## Requirements

- `gh` on PATH and authenticated as you (`gh auth login`). The plugin reports a
  missing or unauthenticated `gh` as a configuration state, not an error.
- A bb project is needed only for the row action, which matches a PR's
  repository against each project's `gitRemoteUrl`. PRs in repositories with no
  matching project are still listed; their button is disabled.

## What lands in the list

One GraphQL query, `is:pr is:open review-requested:@me archived:false`.

`review-requested:` rather than `user-review-requested:` on purpose. The two are
not synonyms: the former also matches a request that reached you through a team
you belong to, which is how most requests arrive in an org, and the narrower
qualifier drops them silently.

Nothing else is filtered. A conflicting PR, a red-CI PR and a bot's dependency
bump are all still review requests, so they are all still listed.

## Why GraphQL rather than `gh pr list`

pr-sweep discovers repositories with `gh search prs` and then fans out one
`gh pr list` per repository, because `statusCheckRollup` and `mergeable` are
unavailable from search. This plugin reads neither.

What it does need is **when the review was requested of you**, and `gh pr list`
has no field for it at any verbosity. The only honest sources are the
`ReviewRequestedEvent` timeline, or a guess from the PR's own timestamps —
and `updatedAt` bumps on every unrelated comment, so a PR that has sat with you
for three weeks would read as "20 minutes". A review queue whose age column is a
guess is not worth having.

So: one `gh api graphql` call, with an exact `requestedAt` per row. It also
means there is no per-repository partial-failure state to carry; the sweep
either returns the whole queue or fails and keeps the last known rows.

`requestedAt` resolves in three steps, so a thin timeline degrades rather than
throwing:

1. The newest request naming your login. Exact.
2. The newest request of any kind. A request reaching you through a team names
   the team and never your login, and the search already guarantees you are a
   requested reviewer.
3. The pull request's own `createdAt`, if the timeline window did not reach the
   event.

## Sections

| Section | What is in it |
| --- | --- |
| Needs Review | Non-draft requests with no thread yet, oldest first. |
| In Progress | A review thread has been started. |
| Draft | A draft was assigned to you: a real request, but not offered for review yet. |

A row with a thread leaves Needs Review whatever else is true, so the queue only
ever holds work actually waiting on you. The sidebar count follows the same rule.

The **Age** column is how long ago the review was requested of you, and it
reddens once that is past the **Stale after (days)** setting. Colouring every age
makes the column noise; colouring the overdue ones makes it a signal.

The **Reviewers** column names everyone whose review is still outstanding, you
first. Your own entry reads "you" rather than your login, because every row here
is a request of you and repeating the same login down the column carries no
information — whereas "you, platform" versus "platform" answers the question the
column exists for: is this mine alone, or could a teammate take it? It reads
`reviewRequests`, the set of requests still open, which is a different thing from
the `ReviewRequestedEvent` timeline used for the age (a history, including
requests already answered or withdrawn).

A **re-review** — you reviewed it, the author pushed, and it came back — gets the
badge that stands out. The author is blocked on you, and it is usually the
cheapest row in the queue to clear.

## Settings

- **Sync interval** — how often the background sweep runs. Default 5 minutes.
- **Path to the gh CLI** — override when `gh` is not on the server's PATH.
- **Stale after (days)** — when a wait starts reading as overdue. Default 2.
- **Model for review threads** — blank takes the provider's default. There is
  only one action here, so this is a single value rather than pr-sweep's
  model-by-action JSON.
- **Provider for spawned threads** — defaults to `claude-code`, the provider
  whose `code-review` command the prompt names. Blank uses bb's default.
- **Permission mode for spawned threads** — defaults to `full`. Read the next
  section before changing it.

## What a spawned thread may do

**It reports findings in the thread. It posts nothing to GitHub without asking.**

Reviewing someone else's pull request is outward-facing in a way pushing to your
own branch is not: a wrong finding lands publicly on a colleague's PR and cannot
be quietly undone. So unlike pr-sweep, whose prompt authorizes its own commit
and push, this prompt withholds that authorization and says so explicitly.

Two things make that instruction load-bearing rather than decorative.

**The skill may try to post on its own.** Two commands answer to `code-review`
on this machine: the built-in one, which posts only when passed `--comment`, and
the claude-plugins-official one, whose final step runs `gh pr comment` with no
flag to suppress it. Which one a spawned thread resolves is not something this
plugin controls. The prompt therefore names the skill *and* states the
constraint, including the case where the skill's own last step posts a comment —
a direct user instruction outranks a skill's steps.

**The sandbox cannot enforce it.** `auto` keeps the workspace sandbox, which
blocks network egress, so a thread in that mode cannot reach GitHub to read the
diff it was started for. `full` is the only mode in which a review can happen at
all, and it has no way to express "may read GitHub, may not write to it". The
no-posting rule lives in the prompt, not in the permission mode. Worth knowing
before trusting it unattended.

## In a spawned thread

Threads this plugin starts carry an **Open pull request** control in the thread
header, linking to the pull request in a real browser tab. It renders only on
threads this plugin created: the server resolves the thread id against its own
link table and returns null for anything else, so the control never appears on
an unrelated thread.

## Relationship to pr-sweep

`bb-plugin-pr-sweep` covers pull requests *you authored*; this one covers
requests *made of you*. They are deliberately separate plugins, which means
`review/spawn-target.ts`, `review/store.ts`, the `gh` runner and the vendored
`components/` are a second copy of pr-sweep's. If a third sweep plugin ever
appears, that is the point to extract a shared package.

## Development

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
bb plugin dev     # rebuild and reload on save
```

**All test fixtures are synthetic.** This repository is public. Never paste real
pull request titles, reviewer logins, repository names, or URLs into a test.
