# bb-plugin-pr-sweep

A bb sidebar panel listing every open pull request you authored, across all
repositories, with the ones needing your action flagged.

The sweep is deterministic: it runs `gh`, classifies the result with pure
functions, and spends no model tokens. An agent is only involved when you click
"Work on this" on a flagged row.

## Install on a new machine

```bash
cd ~/.dotfiles/bb/plugins/bb-plugin-pr-sweep
npm install
bb plugin install . --yes
```

## Requirements

- `gh` on PATH and authenticated as you (`gh auth login`). The plugin reports a
  missing or unauthenticated `gh` as a configuration state, not an error.
- A bb project is needed only for "Work on this", which matches a PR's
  repository against each project's `gitRemoteUrl`. PRs in repositories with no
  matching project are still listed; their button is disabled.

## Settings

- **Sync interval** — how often the background sweep runs. Default 5 minutes.
- **Path to the gh CLI** — override when `gh` is not on the server's PATH.

## Flags

| Flag | Meaning |
| --- | --- |
| merge conflict | Conflicts with its base branch. |
| CI failing | A red check. |
| reviewer feedback | A live `CHANGES_REQUESTED` or `COMMENTED` review. |
| merge blocked | Approved and green, but a required review or ruleset is unsatisfied. |
| mergeability unknown | GitHub had not computed it, twice. |
| CI cancelled | A run was cancelled; usually needs a re-run. |
| no CI | Zero checks ran. Not the same as green. |
| no reviewer | Non-draft with nobody requested and no reviews. |
| CI running | Still in flight. |
| ready to merge | Approved, green, no conflict, not a draft. |

A PR that is answered and awaiting re-review carries no flag: the ball is in the
reviewer's court.

## Development

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
bb plugin dev     # rebuild and reload on save
```

The check rules are a port of the `pr-sweep` Claude skill at
`~/.dotfiles/claude/skills/pr-sweep/`, which documents why each rule is shaped
the way it is, including the GitHub API traps each one avoids. Read it before
changing `sweep/classify.ts`.

**All test fixtures are synthetic.** This repository is public. Never paste real
pull request titles, reviewer logins, repository names, or URLs into a test.
