# bb-plugin-issue-sweep

A bb sidebar panel listing every open GitHub issue assigned to you, across all
repositories, most recently updated first.

The sweep is deterministic: it runs `gh`, parses the result with pure functions,
and spends no model tokens. No agent is involved at any point.

## Install on a new machine

```bash
cd ~/.dotfiles/bb/plugins/bb-plugin-issue-sweep
npm install
bb plugin install . --yes
```

## Requirements

`gh` on PATH and authenticated as you (`gh auth login`). The plugin reports a
missing or unauthenticated `gh` as a configuration state, not an error.

## What it lists

One `gh search issues --assignee=@me --state=open` call covers every repository
you can see, so there is no per-repo fan-out and no allowlist to maintain. Two
kinds of hit are dropped: pull requests, which GitHub returns because it models
them as issues, and anything without a parseable `owner/name` or timestamp.

The table shows the issue number, its title linked to GitHub, its labels, and
how long ago it was last updated, with the comment count underneath when there
is one. The repository earns its own line only when more than one is in play.

Sorting is `updatedAt` descending, tie-broken by repository then number. The
tiebreak is not cosmetic: issues bulk-edited in one action share a timestamp to
the second, and without it those rows would reshuffle between sweeps.

Search caps at 100 hits. Past that the panel says the list may be incomplete
rather than quietly showing a subset.

## Settings

- **Sync interval** — how often the background sweep runs. Default 5 minutes.
- **Path to the gh CLI** — override when `gh` is not on the server's PATH.

## When a sweep fails

The last good rows stay in the store and stay on screen, with the error in a
banner above them. A stale list beats an empty one, and the background service
keeps running, so the panel heals on its own once `gh` works again.

## Development

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
bb plugin dev     # rebuild and reload on save
```

**All test fixtures are synthetic.** This repository is public. Never paste real
issue titles, repository names, or URLs into a test.

## Not here yet

There is no "Work on this" action, no thread link, and no per-issue triage
state. This is a read-only table by design; those are the obvious next steps if
it earns them.
