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

Secrets that bb reads from the environment (`BB_INFERENCE`,
`BB_TRANSCRIPTION`, and any provider keys) belong in `../environment.local`,
which `.gitignore` keeps out of this repository. Non-sensitive values can go in
`../environment`.

## Usage

```sh
./setup.sh
```

It is idempotent: already-installed plugins are skipped, and an existing
non-empty `~/.bb/skills` is left alone rather than replaced.

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
