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
- **Provider for spawned threads** — defaults to `claude-code`, which is the
  provider the routed skills belong to. Blank uses bb's default.
- **Permission mode for spawned threads** — defaults to `full`. `accept-edits` stops
  at the first shell command; `auto` keeps the workspace sandbox, which blocks
  network egress, so a conflict resolution commits but cannot push. Only `full`
  carries the work through to the PR unattended, and it grants unsandboxed
  command execution in the worktree.
- **Model by action** — a JSON object keyed by flag, picking the model for that
  action's thread. An unlisted flag takes the provider's default model, and a
  malformed value is logged and ignored rather than blocking a spawn.

  ```json
  { "conflict": "claude-sonnet-5" }
  ```

  Worth knowing before tuning this down: `resolve-merge-conflicts` is explicit
  that the conflict markers are the easy part and the real work is the semantic
  collisions git could not mark. Watch the first few conflict threads before
  trusting a cheaper model with them.

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

A pull request with a thread attached moves to **In progress**, whatever its
flags say, so Needs action only ever holds work that is actually waiting on
you. The sidebar count follows the same rule.

A PR that is answered and awaiting re-review carries no flag: the ball is in the
reviewer's court.

## Where an action sends the work

The row's worst flag picks both the button label and the skill the spawned
thread is told to use:

| Worst flag | Skill |
| --- | --- |
| merge conflict | `resolve-merge-conflicts` |
| reviewer feedback | `address-code-review` |
| anything else | `pr-sweep` |

Those first two skills specify their own flow, including worktree setup on the
PR's own branch, so the prompt names the skill and states the findings without
restating any method. Rows routed to `pr-sweep` carry the standing guardrails
instead.

Two things follow from that routing:

**Threads spawn on Claude Code.** All three skills are `provider-user` skills
scoped to `claude-code`, so a thread on any other provider cannot see them and
will improvise the workflow instead. The **Provider for spawned threads**
setting pins this; blank falls back to bb's default provider. If you point it
at a provider without these skills, the prompts will name skills that provider
does not have.

**A skill-routed prompt authorizes its own commit and push.** Standing user
instructions forbid committing without an explicit ask and outrank a skill, so
without that paragraph the thread does the work and stops at a staged merge.
Clicking the row's action is the ask. Force-pushing, rewriting a pushed commit,
merging the PR, and posting review replies still require confirmation.

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
