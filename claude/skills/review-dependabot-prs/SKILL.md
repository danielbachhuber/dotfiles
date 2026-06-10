---
name: review-dependabot-prs
description: Use when reviewing, assessing, triaging, approving, or merging open Dependabot dependency-bump PRs — one-by-one impact assessment with a posted comment before merge.
---

# Review Dependabot PRs

## Overview

Assess each open Dependabot PR for real impact on the codebase, post a concise assessment comment, then approve/merge once confirmed. Work **one PR at a time**, pausing for the user to confirm before posting or merging each. The goal is a defensible "is this safe?" judgment, not rubber-stamping green CI.

## Workflow

1. **List the queue:**
   ```bash
   gh pr list --author "app/dependabot" --state open \
     --json number,title,createdAt,labels --limit 50
   ```

2. **For each PR, gather facts** (one call):
   ```bash
   gh pr view <n> --json title,files,additions,deletions,headRefName,\
   mergeable,mergeStateStatus,statusCheckRollup \
     --jq '{title, headRefName, additions, deletions, mergeable, mergeStateStatus,
            files: [.files[].path], checks: [.statusCheckRollup[] | {name, state: (.conclusion // .state)}]}'
   ```
   Then pull version changes + changelog from the body:
   ```bash
   gh pr view <n> --json body --jq .body > /tmp/dep-body.txt
   grep -iE "Updates \`|from .* to " /tmp/dep-body.txt
   # functional changes only (skip release/chore/sponsor noise):
   grep -oE '<code>[a-f0-9]{7}</code></a> [^<]+' /tmp/dep-body.txt | sed 's/<[^>]*>//g' | sort -u
   ```

3. **Assess impact** — see checklist below. Gauge blast radius by grepping actual usage.

4. **Write the assessment to a draft file first** (per global CLAUDE.md — never post to GitHub unconfirmed):
   `~/projects/drafts/pr-<n>-<dep>-assessment.md`. Present it in chat, get sign-off.

5. **Post + approve + merge** (Dependabot PRs need an approving review to clear branch protection):
   ```bash
   gh pr comment <n> --body-file ~/projects/drafts/pr-<n>-<dep>-assessment.md
   gh pr review <n> --approve          # only if the user authorized approving as them
   gh pr merge <n> --squash --auto     # auto-merge fires when checks+review are satisfied
   ```

## Assessment checklist

- **Scope:** dev-only (`devDependencies`) vs runtime?
- **Version jump:** patch / minor / major (semver risk). Grouped bumps should move in lockstep — confirm they do.
- **What actually changed:** read the changelog. Separate functional fixes from chores/CI/sponsor-sync. Do any changes reach *our* usage, or are they for platforms/sub-packages we don't use?
- **Blast radius:** how many files import it; is the one relevant fix actually exercised by our config?
- **CI:** which jobs are green vs skipped. Don't over-rely on green, and don't cite *expected* skips as concerns (see Gotchas).
- **Diff cleanliness:** scan `gh pr diff <n>` for unrelated changes (a stale base can make the diff appear to revert an unrelated dep).

## Gotchas

| Situation | What it means / fix |
|-----------|---------------------|
| Diff shows an **unrelated dep downgrade** (e.g. `mprocs ^0.9.6→^0.9.5`) | Stale-base artifact: branch predates a recent `main` change. `@dependabot rebase`, don't flag it as intentional. |
| `mergeStateStatus: BLOCKED`, `reviewDecision: REVIEW_REQUIRED` | Branch protection needs an approving review; auto-merge waits for it. Approve (with user OK) to unblock. |
| `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING` | Lockfile conflict — common as earlier merges land. Comment `@dependabot rebase`; it re-runs CI and (if still approved) auto-merges. |
| E2E / Playwright jobs **SKIPPED** | Often a deliberate `if: github.actor != 'dependabot[bot]'` guard — bot PRs never get E2E. Don't cite as a per-PR concern. To force E2E, re-push under a non-bot branch. |
| Merging cascades lockfile conflicts | Not guaranteed — only when branches touch overlapping `pnpm-lock.yaml` regions. Handle conflicts as they appear; don't pre-batch. |

## Confirm cadence

Default to **one PR at a time**: assess → draft → confirm → post/merge → next. Don't batch the assess-and-merge steps across PRs unless the user explicitly asks. Approving as the user is identity-bearing — confirm before doing it the first time.
