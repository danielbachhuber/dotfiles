---
name: improve-bb
description: Use when working on Daniel's bb setup — the GitHub sweep plugins in ~/.dotfiles/bb/plugins (pr-sweep, review-sweep, issue-sweep, gh-shared), a new bb plugin, a bb skill, or a bb automation. Triggers on "the PR panel", "the Issues tab", "the reviews list", "the sweep", "why is this row wrong", "this doesn't work" about a bb panel, or any request to add, fix, or restyle bb functionality. Read it before touching the code, not after the first thing breaks.
---

# Improving bb

`building-bb-plugins` covers how to write a bb plugin. This covers how to work
on *these* plugins, and what has actually gone wrong doing it.

## The GitHub family

Four packages in `~/.dotfiles/bb/plugins/`:

| Package | Owns |
| --- | --- |
| `bb-plugin-pr-sweep` | Your own open PRs; also the "Open pull request" form |
| `bb-plugin-review-sweep` | Reviews other people are waiting on you for |
| `bb-plugin-issue-sweep` | Issues assigned to you, bucketed by board status |
| `gh-shared` | `file:` package: the `gh` runner and project matching only |

They deliberately do **not** share their classifiers or fetch strategies — those
genuinely differ, and an earlier attempt to merge all three into one plugin was
reverted. What they do share is vendored UI (`components/ui/*.tsx`, kept
byte-identical) and `gh-shared`. `gh-shared` is bundled at build time, so a
change there needs all three rebuilt.

## The line these plugins hold

The sweep decides **what is true**. An agent decides **what to do about it**, in
a spawned thread, and only when you click something.

No plugin calls a model. The classifiers are pure functions of a `gh` payload —
same JSON in, same row out, no clock, no network. Keep it that way: spend no
model tokens on what a predicate can answer, and never let a background service
reach `threads.spawn`. There is a test asserting that last one.

Where judgement is genuinely needed, hand it to a thread rather than guessing in
the sweep. `notedBy` is the pattern: the classifier reports only that a review
body contains prose, and the prompt asks the thread to read it and say whether
the points were addressed.

## Verify against live data, not just tests

This matters more than anything else here. Every real bug in these plugins
passed its unit tests, because the tests encoded the same wrong assumption the
code did:

- A re-run check does not replace its predecessor in `statusCheckRollup`.
  GitHub returns both, so a PR that failed and was re-run green read
  "1 fail · 6 pass" with everything passing.
- An approval can carry thousands of characters of caveats in the **review
  body** — not an issue comment, not an inline thread, and `reviewDecision`
  still says `APPROVED`. Nothing was looking there.
- `threads.spawn` rejects an unmanaged workspace without `hostId`, while the
  SDK types have it optional. Only runtime says so.
- An empty check rollup is not a fault in a repo whose workflows do not trigger
  on PRs.

So before believing a classifier: pull the real payload, run the real parser
over it, and read the plugin's own database.

```sh
gh pr view <n> --repo <owner>/<repo> --json statusCheckRollup,reviews,latestReviews
gh api graphql -f query='...' -f q='...'

# The parser against real output — a throwaway test file is the easiest way,
# since the plugin's own tsconfig and module resolution already work there.
sqlite3 -readonly ~/.bb/plugins/<id>/data.db \
  "SELECT json_extract(payload,'\$.flags'), json_extract(payload,'\$.checks') FROM rows WHERE number=<n>;"
```

Quote the real numbers back when reporting. "0 failing on the live PR" is worth
more than "the tests pass".

## When a panel misbehaves, find the error before theorising

bb logs plugin RPC failures where `bb plugin logs` does not show them:

```sh
grep -h "plugin:<id>" ~/.bb/logs/server*.log | tail -20
```

That is where `hostId is required unless workspace.type is personal` was
sitting while the button silently did nothing. Two habits follow:

- Wrap anything that can reject in an RPC handler and return the message, so it
  reaches the panel instead of becoming a generic failure.
- Never leave the branch that hides UI as the silent one.

## Read bb's own source when behaviour is unclear

bb ships readable bundles. The server one is not minified:

```
/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/
  server/dist/start-server.js          # readable; routes, caches, thread creation
  host-daemon/dist/daemon-bundle.mjs   # minified; git and gh integration
```

Grep them rather than guessing. They answered: how managed branch names are
built (`buildManagedBranchName`), how a thread's PR is resolved (`gh pr view`
on the checked-out branch, 10s cache), how bb dedupes check runs
(`assembleThreadPullRequestChecks` — the fix for the bug above), and what the
bundled GitHub plugin uses for table padding.

Matching bb's own behaviour is usually right. When this panel and bb's thread
header disagreed about CI, bb was correct.

## bb state that cannot be un-set

`bb.status.needsConfiguration` is one-way — the SDK clears it on the next load
and offers no runtime way back. One transient `gh` failure once hid two panels
from the sidebar until someone reloaded them.

Treat any latching state the same way: require a run of failures before
latching, reset the count on success, and log every time you consider it.
Classify errors on the specific evidence (`gh` stderr against phrases `gh`
actually prints), not on a keyword appearing anywhere in a message that
contains the whole argv.

## Anything personal is a setting, never a constant

`~/.dotfiles` is public. The board name, its status order, which statuses count,
the repository list — settings in `~/.bb`, set with `bb plugin config <id> set
<key> <value>`. Node ids (project, field, option) are resolved at runtime from
the board's name and never written down.

Fixtures use `acme/widgets`, `acme/gadgets`, `octocat`, `hubber`, `Acme Board`.
Scan the staged diff before committing.

## Changing a row's shape

Adding a field touches the same places every time. In order:

1. `<domain>/types.ts` — the raw `gh` shape and the classified row
2. `<domain>/classify.ts` (or `types.ts`'s `toRow`) — how it is derived
3. `<domain>/contract.ts` — the zod row schema, or the panel silently drops it
4. `app.tsx` — the local `Row` type and wherever it renders
5. Every fixture: `app.test.tsx`, `server.test.ts`, `<domain>/*.test.ts`

Missing (3) is the quiet one: `rpc listRows failed: rpc output validation
failed` in the server log, and an empty panel.

## UI conventions

The bundled GitHub plugin is the reference. Read its bundle rather than
approximating: `server/dist/builtin-plugins/github/dist/app.js`.

- Table cells `px-3 py-3`, headers `px-3 py-2`. A fixed column holding a
  non-wrapping button needs its width to include that padding.
- Sync status and Refresh go in the panel's `headerContent`, not the body, and
  the time is relative: "synced 4m ago".
- Title first, context under it: repo, age, comments on one muted line joined
  with `·`.
- Tooltips on titles only when the text is actually cut — measure and skip
  otherwise, and treat unmeasurable as truncated.
- Columns holding slugs wrap with `break-words`; truncation hides the tail,
  which is the part that identifies the team.
- A hand-rolled `<button>` or `<select>` needs `cursor-pointer`; only the
  shared `Button` sets it.
- Empty states earn a graphic drawn from the subject's own world. Avoid grey
  rounded bars — that is the loading-skeleton idiom and reads as "still
  fetching".

## Spawned threads

The prompt names a skill and gets out of the way. Routing beats restating: a
prompt that re-explains worktree setup will contradict the skill that owns it.

Two things every prompt needs, learned from threads that stalled or went
wandering:

- The standing rule against committing without an explicit ask outranks a
  skill, so say that the click *is* the ask — and still withhold force-push,
  history rewrites, and the merge itself.
- Describe the starting condition. A thread already in a bb worktree, told to
  "work in a worktree", built a second one in `/tmp` where bb could not see it.

Judge completion from the world, not from the thread's prose. Auto-archive
re-checks whether the flag that justified the thread still appears in the next
sweep; a thread announcing success is not evidence.

## Working rhythm

Feedback usually arrives as a screenshot of something slightly wrong. Take the
whole change: fix it, update the tests it breaks, `bb plugin build`,
`bb plugin reload <id>`, verify against live data, commit, push.

- Commit incrementally, and stage the exact plugin directory — other threads
  commit to this repo at the same time, and `git add bb/` once swept 23 of
  another thread's files into a commit.
- When a test fails because behaviour changed on purpose, rewrite it to assert
  the new contract. Those failures are the tests doing their job.
- Say what was verified and what was not. "I have not clicked the button
  myself" is a useful sentence.
- Fixing an adjacent instance of the same defect is usually right — say so
  rather than doing it silently.
