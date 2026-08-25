---
name: resolve-merge-conflicts
description: Use when a pull request conflicts with its base branch, GitHub reports CONFLICTING or DIRTY, or the user asks to merge main into a branch, resolve conflicts, or unblock a stale PR.
---

# Resolve Merge Conflicts

## Overview

Conflict markers are a symptom, not the job. Git marks the lines where two branches edited the same text. It says nothing about the code main added while your branch was away: code that compiles, passes its own tests, and quietly contradicts whatever rule your branch introduces.

**Resolving the markers is step 4 of 8.** The work that matters is finding the collisions git could not see.

Merge, never rebase. The branch is already on the remote and under review, so history stays append-only.

## 1. Set up a worktree on the PR's own branch

`EnterWorktree` alone is wrong here: with no arguments it creates a *new* branch from `origin/<default>`, and you need the PR's existing branch so the push lands on the PR. Create the worktree first, then enter it by path:

```bash
gh pr view <n> --json number,title,headRefName,baseRefName,mergeable,mergeStateStatus,url,body
git fetch origin <headRef> <baseRef>
git worktree add .claude/worktrees/pr-<n> <headRef>
```

Then `EnterWorktree` with `path: <abs path>`.

The session is now worktree-isolated. It refuses any shell command too complex to prove it stays inside the worktree: chained `&&` with `cd`, most heredocs. Split them into plain separate commands; for anything scriptlike, write a file, run it, delete it.

## 2. Merge and see what git marked

```bash
git merge origin/<baseRef>
git diff --name-only --diff-filter=U
```

Read the whole conflict hunk with context, not just the marked lines.

## 3. Learn both sides' intent before editing a marker

A conflict is two deliberate changes, and the resolution is usually the union of both intents rather than a choice between them. Establish what each side meant:

```bash
git merge-base HEAD origin/<baseRef>
git log --oneline <base>..origin/<baseRef> -- <conflicted-path>   # what main did, and why
git log --oneline -S '<symbol>' origin/<baseRef> -- <path>        # which side introduced a symbol
```

Read your own branch's commit messages and PR body too. A deletion that looks like a casualty of the merge is often the point of the PR.

## 4. Resolve the markers

Take both intents. Keep main's addition *and* your branch's deletion when they merely landed adjacent in the file. Adjacency is what conflicted, not meaning.

## 5. Find the conflicts git did not mark

**This is the step that fails silently if you skip it.** Two kinds, and only the first is caught by tooling.

**Deleted or renamed symbols.** Typecheck catches these, but grep first so you understand the scope before the compiler dumps errors on you:

```bash
grep -rn '<symbol-you-deleted>' --include='*.ts' --include='*.tsx' . | grep -v node_modules
```

**New code on main that predates your branch's new rule.** Nothing catches this. It compiles, its tests pass, and it is wrong anyway, because it was written before the pattern your PR establishes. Enumerate what main added and ask of each: *would this have been written differently on my branch?*

```bash
git diff <merge-base> origin/<baseRef> --stat -- <the areas your PR touches>
```

In the session this skill came from, one file conflicted and three things actually needed fixing. Two were new routers main added that git merged cleanly: one called a function the PR deletes, the other hand-rolled work the PR's new middleware now does for it.

**Baselines and generated inventories are the third kind.** A branch that adds a broad test, a new lint rule, or a new gate will shift a checked-in baseline file: coverage exclusions, snapshot counts, allowlists. The tool usually names the drift and the fix. Prefer editing the specific stale entries over regenerating the whole file, so the diff stays reviewable.

## 6. Verify with the full suite

```bash
pnpm install                    # a fresh worktree has no node_modules
pnpm typecheck && pnpm lint     # in each package you touched
pnpm test                       # full, not filtered
pnpm check-format               # from the repo root
```

Install the **whole** workspace, not a filtered subset. Pre-push hooks typecheck every package, and a partial install fails the push on a package you never touched.

Run the **full** test suite. Filtered runs skip cross-suite gates that only arm on a complete run, so a green filtered run proves nothing about the merge.

## 7. Commit the reasoning, then push

The merge commit is where a returning reviewer learns what you decided. Say what collided and how you resolved each one, rather than "merge main".

```
Merge origin/main into <headRef>

- <symbol> stays deleted, and main's new <symbol> stays. The two landed
  adjacent in <file>, which is what conflicted.
- <router> (N handlers) moves to <new pattern>. It was main's only
  remaining caller of <deleted symbol>.
- <n> entries leave <baseline file>, because <test> now covers those cells.
```

Then `git push origin <headRef>`, and confirm the PR cleared:

```bash
gh pr view <n> --json mergeable,mergeStateStatus
```

`MERGEABLE` is the goal. `BLOCKED` alongside it just means checks or review are outstanding.

## 8. Report the drift, do not silently fix it

A merge routinely falsifies the PR description: counts go stale ("its six callers", "all 53 procedures"), and a decision the body defends may now cover code the author never saw. Say so and offer to update the body. Do not rewrite the description as part of the merge.

Same for judgment calls you made on the author's behalf: a baseline you loosened, a pattern you extended to new code. Surface each one explicitly rather than burying it in a green test run.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Stopping when the markers are gone | Markers are step 4 of 8; step 5 is the real work |
| Rebasing to get a clean history | Merge, because the branch is pushed and under review |
| Picking a side | Resolution is usually the union of two intents |
| Trusting a green typecheck | It catches deleted symbols, never stale patterns |
| Filtered test run | Full-run-only gates stay silent under a filter |
| Filtered `pnpm install` in a worktree | Pre-push hooks typecheck every package |
| `EnterWorktree` with no path | Creates a new branch off main, not the PR's branch |
| Compound `cd && git ...` in a worktree | Split into plain, separate commands |
| Regenerating a whole baseline file | Remove the specific stale entries so the diff reads |
| "Merge main" as the commit message | Record what collided and how each was resolved |
| Quietly editing the PR description | Report the drift, let the author decide |
