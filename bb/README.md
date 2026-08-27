# bb

Configuration for [bb](https://getbb.app), the agentic IDE.

## ⚠️ This repository is public

`danielbachhuber/dotfiles` is a public GitHub repository. Nothing here may
contain a credential, a real private repository or project name, or any content
copied out of a thread. Test fixtures use invented names (`acme-widgets`,
`octocat`) for the same reason.

Nothing under `~/.bb` belongs in this directory. That includes:

| Path | Why it can never be committed |
| --- | --- |
| `~/.bb/auth.json`, `~/.bb/auth-secret` | Session credentials. |
| `~/.bb/bb.db` | Every thread's full content, plus settings and project paths. |
| `~/.bb/plugins/*/secrets/` | Plugin secret settings and per-plugin HTTP tokens. |
| `~/.bb/plugins/*/data.db` | Plugin state, which may cache private data. |
| `~/.bb/thread-storage/`, `~/.bb/attachments/`, `~/.bb/logs/` | Thread content and attachments. |
| `~/.bb/host-id`, `~/.bb/telemetry-id` | Machine identifiers. |

## What lives here

bb keeps its own configuration in `~/.bb/bb.db` rather than in files, so there
is nothing to symlink the way `claude/settings.json` is symlinked. General
preferences, keybindings, provider order, the project list, and plugin
registrations are all rows in that database, next to the credentials above.

The versionable form of that configuration is therefore `setup.sh`, which
reproduces it through the `bb` CLI on a new machine:

- `plugins/` — first-party plugins, installed from these directories with
  `bb plugin install .` so bb loads them via a `path:` source.
- Plugin-building preferences, as a skill under `../claude/skills/` (BB reads
  user skills per provider, not from `~/.bb/skills`).
- Settings → General and keyboard overrides, applied as `bb settings` calls.
  Nothing is customized today; add a line to `setup.sh` when that changes.
- `automations/` — script bodies for scheduled work, registered by `setup.sh`.

Secrets that bb reads from the environment (`BB_INFERENCE`,
`BB_TRANSCRIPTION`, and any provider keys) belong in `../environment.local`,
which `.gitignore` keeps out of this repository. Non-sensitive values can go in
`../environment`.

## Automations

`automations/` holds the script bodies for bb automations. Registering them is
part of `setup.sh`, for the same reason everything else there is: an automation
is a row in `bb.db`, not a file bb reads from disk.

bb stores its own snapshot copy of a script when the automation is created, so
editing a file in `automations/` does not change what runs. Re-run `setup.sh`
after an edit, or the `update ... --script-file` command that `create` printed.

Pause before you refresh a snapshot, and resume afterward:

```sh
bb plugin run automations pause  <id> --project <project>
bb plugin run automations update <id> --project <project> --script-file ...
bb plugin run automations resume <id> --project <project>
```

An `update` on an active automation has been observed to fire a run
immediately, which for the Dependabot sweep means a batch of threads you did not
ask for. The same `update` against a paused automation does not.

### Dependabot sweep

`automations/dependabot-sweep.sh` runs at 7am and 2pm Pacific on weekdays and
spawns one bb thread per open Dependabot pull request, each pointed at the
`review-dependabot-prs` skill and scoped to that single PR. It is a script
automation, so the sweep itself spends no model tokens; only the threads it
creates do.

Threads are titled after the package rather than the bot, behind a `Dep: `
prefix that keeps them sortable in the sidebar: `Dep: jose #5775`,
`Dep: @testing-library/user-event #5776`, `Dep: sentry group #5580`.
Dependabot writes two
title shapes, a single bump and a grouped one, and the script reduces both to
the part worth reading in a sidebar. A shape it does not recognize keeps its
title verbatim.

A PR gets a thread once. The script asks bb which threads already exist, active
and archived alike, so a review you finished and archived does not come back at
2pm. There is no state file to fall out of sync. The match runs on
`owner/name#number`, which the prompt opens with so bb captures it in the
thread's fallback title — not on the display title, since a bare `#5775` would
also match any unrelated thread mentioning that number.

At most five threads are created per run, so a backlog arrives over several
sweeps instead of all at once. When the cap bites, the run says how many PRs it
left behind rather than quietly stopping at five. A sweep that finds nothing new
prints nothing at all, which bb records as a silent tick.

The threads stop at a draft assessment. Posting the comment, approving, and
merging stay manual, because approving carries your identity.

Configure the sweeps in `../environment.local` (gitignored, since a private
repository name cannot live in this public repository):

```sh
export BB_DEPENDABOT_SWEEPS='[
  {"project": "Acme Widgets",
   "repo": "octocat/acme-widgets",
   "workspace": "/Users/you/projects/acme-widgets"}
]'
```

`project` is the bb project name from `bb project list`. Threads attach to
`workspace` rather than each getting a worktree: the review reads the repository
and drives `gh`, and never writes to the checkout.

Requires `gh` on the server's PATH, authenticated as you. When it is not, set
`DEPENDABOT_GH` to its absolute path in the automation's script variables.

## The full inventory

Everything bb keeps in `bb.db`, and whether `setup.sh` puts it back on a new
machine. Audited 2026-08-27.

| Configuration | Reproduced by `setup.sh` |
| --- | --- |
| First-party plugins in `plugins/` | Yes, installed from a `path:` source |
| Automations in `automations/` | Yes, one per entry in `BB_DEPENDABOT_SWEEPS` |
| Which builtin plugins are disabled | No, see below |
| Plugin settings | No, see below |
| Registered projects | No, added by hand as you start work in a repo |
| Plugin marketplaces | Nothing to do; only the default `bb-community` is registered |
| `connect` pairing | No, pairing is interactive and machine-specific |
| Settings → General, appearance, keybindings, experiments | Nothing to do; all still at their defaults |

Two gaps are deliberate rather than pending.

**Disabled builtin plugins.** Four ship with bb and are turned off here:
`ask-user-question`, `monaco-editor`, `plugin-api-tester`, and `workflows`.
`bb plugin list` prints the state of each. Re-disable them by hand on a new
machine, or add `bb plugin disable <id>` lines to `setup.sh` if that becomes
tedious.

**Plugin settings.** One is set today: `issue-sweep` has a `projectBoard`
naming the board its panel buckets issues by. The value is a real team name, so
it cannot be committed to this public repository, and there is no
`environment.local` indirection for plugin settings the way there is for
automations. Set it in the plugin's settings panel.

Registered projects are also left out on purpose. A project binds a name to an
absolute checkout path, and both are private, so `bb project add` belongs in the
same category as the settings above.

The AI-service settings (`BB_INFERENCE`, `BB_INFERENCE_FALLBACK`,
`BB_TRANSCRIPTION`) read as populated in `bb settings ai-services`, but nothing
in this repository exports them and they are absent from `bb.db`, so what you
see is bb resolving its own defaults against the one registered provider. The
guidance above about putting them in `../environment.local` applies the day you
want to pin them to something else.

## Usage

```sh
./setup.sh
```

It is idempotent: an already-installed plugin is skipped, and an automation
whose name is already registered against the project is left alone. Directories
under `plugins/` without a `bb` manifest block are shared libraries, not
plugins, and are passed over.

Re-running it does not pick up an edit to a script under `automations/`, because
bb runs its own snapshot copy. Refresh those with the paused update above.

## Building plugins

House preferences for the plugins here — reuse BB's own components rather than
hand-rolling a composer or picker, pin the provider for spawned threads, where
logic goes relative to vendored shadcn source, the testing-harness gotchas, and
how to verify against a running server — live in a skill, so that an agent asked
to build a plugin actually receives them:

```
../claude/skills/building-bb-plugins/SKILL.md
```

It sits under `claude/` rather than here because BB reads user skills from each
provider's own directory — `~/.claude/skills` for claude-code,
`~/.codex/skills/.system` for codex, `~/.hermes/skills` for acp-hermes-agent.
`~/.bb/skills` is not a scanned directory. Symlink it into `~/.claude/skills`
the way the other skills in this repository are.
