# PSI dev container — Claude memory

You are running inside the PSI dev container: a sandboxed Linux container whose
only meaningful mounts are this worktree and whose outbound network is
restricted to a default-deny firewall allowlist. This is a deliberately
autonomous environment — run tests, linters, type-checks, builds, and edit
files freely without asking.

## Always confirm before committing, pushing, PRs, or GitHub comments

Even when tool-permission prompts are skipped, you MUST stop and ask Daniel for
explicit confirmation **in the conversation** BEFORE doing any of the following.
State exactly what you are about to do, then wait for an affirmative reply
before running the command:

- **Committing** — `git commit`
- **Pushing** — `git push`
- **Creating or updating a pull request** — `gh pr create`, `gh pr edit`
- **Leaving any GitHub comment** (PR or issue) — `gh pr comment`,
  `gh issue comment`, `gh pr review`, or any `gh api` / `curl` call that posts a
  comment

This is a hard rule. Do not batch any of these actions behind other work, and
do not assume prior approval carries over to a later commit/push/comment — ask
each time.

## Inherited global guidance

The following is Daniel's host `~/.claude/CLAUDE.md`, mounted read-only:

@host-CLAUDE.md
