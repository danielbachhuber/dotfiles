# Default PSI dev container

The default dev container `wts` (`psi-start-worktree.sh`) drops into every PSI
worktree. It combines the **psi-product toolchain** (Node 22, Temurin JDK,
gcloud, gh, Chromium/Playwright, `firebase-tools`/`expo`/`mprocs`/`claude-code`)
with the **psi-workflow-viz network sandbox** (a default-deny outbound firewall)
so you can run Claude autonomously inside a worktree with the blast radius
limited to the container.

## Files

- `Dockerfile` — the toolchain image plus the sandbox layer (sudo + iptables/
  ipset and the firewall script with a NOPASSWD sudoers entry for `node`).
- `init-firewall.sh` — default-deny iptables/ipset firewall applied at container
  start. Allowlists GitHub, npm, the Anthropic API + Claude telemetry, the VS
  Code marketplace, and a PSI block (Expo, Google Fonts). Google/Firebase deploy
  endpoints are commented out — uncomment and rebuild if you need them.
- `devcontainer.json` — the container definition (`wts` copies this and stamps a
  per-branch `name`).
- `CLAUDE.md` — container user-memory: the commit/push/PR/comment guard, and an
  `@host-CLAUDE.md` import of your global `~/.claude/CLAUDE.md`.

These are the source of truth. `wts` copies `Dockerfile` + `init-firewall.sh`
into each worktree's `.devcontainer/` and generates `devcontainer.json` there
(adding the two copied files to the worktree's local git excludes). The two
`CLAUDE.md` files are not copied — `devcontainer.json` bind-mounts them from this
directory by absolute host path.

## Using it

After `wts <branch>`, open the worktree and **Reopen in Container** (VS Code /
Cursor Dev Containers extension), or from the worktree:

```bash
devcontainer up --workspace-folder .
devcontainer exec --workspace-folder . claude
```

The firewall runs as `postStartCommand` and prints `Firewall verification
passed` when the allowlist is active. `mprocs pnpm dev` starts on attach.

### The commit/push/PR/comment guard

`CLAUDE.md` instructs Claude to stop and ask for explicit confirmation before
committing, pushing, creating/updating a PR, or leaving a GitHub comment. This
is a **soft guard** — instruction-based, not enforced. It holds even if you run
`claude --dangerously-skip-permissions`, but nothing physically blocks those
actions; it relies on Claude following the instruction.

## PSI_GITHUB_TOKEN

`devcontainer.json` reads `PSI_GITHUB_TOKEN` from your host shell
(`${localEnv:PSI_GITHUB_TOKEN}`) and exposes it inside the container as both
`PSI_GITHUB_TOKEN` and `GH_TOKEN`; a `postCreateCommand` runs `gh auth
setup-git` so `git` over HTTPS uses it too. Grant the token only the limited PSI
access you need. If it's unset when you run `wts`, the script warns you.

## Persistence & rebuilds

`~/.claude` (login) and shell history persist in per-container Docker volumes, so
you sign in once. After changing anything here, recreate the container:

```bash
devcontainer up --workspace-folder . --remove-existing-container
```

## Adding an allowlisted host

Edit the `for domain in ...` loop in `init-firewall.sh`, then rebuild.
