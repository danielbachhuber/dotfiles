# dotfiles

How my machine is configured

## ⚠️ This repository is public

Everything committed here is world-readable. Before adding a file, check that
it contains no credential, no real private repository or project name, and no
content copied out of a thread, issue, or pull request. Test fixtures and
examples use invented names (`acme-widgets`, `octocat`).

Secrets go in `environment.local`, which `.gitignore` keeps untracked. Agent
state directories stay on the machine: nothing from `~/.bb`, and nothing from
`~/.claude` beyond the files symlinked out of `claude/`.

## Layout

| Path | What it configures |
| --- | --- |
| `setup.sh` | Symlinks the shell, vim, and terminal config into `$HOME`. |
| `bb/` | [bb](https://getbb.app) plugins and skills, plus `bb/setup.sh`. See [bb/README.md](bb/README.md). |
| `claude/` | Claude Code settings, skills, hooks, scripts, and `CLAUDE.md`. |
| `agents/` | `AGENTS.md`, shared agent instructions. |
| `environment` | Exported environment variables. Tracked, so no secrets. |
| `environment.local` | Secrets and machine-local variables. Untracked. |
