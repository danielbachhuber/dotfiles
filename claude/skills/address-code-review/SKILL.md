---
name: address-code-review
description: Use when working through review feedback on a pull request — a reviewer requested changes, left inline comments, or the user asks to address, respond to, or work on a PR review.
---

# Address Code Review

## Overview

Work a reviewer's comments one at a time, in an isolated worktree. Each comment gets its own diff, the user's approval, and its own commit. Push once at the end, then reply to each addressed comment with the commit SHA and nothing else.

**The user approves every change before it becomes a commit.** Never batch the walkthrough, and never post to GitHub before the push.

## 1. Check out the PR in a worktree

Use the native `EnterWorktree` tool (not the `superpowers:using-git-worktrees` skill). A fresh worktree branches from `origin/main`, so check out the PR branch inside it:

```bash
gh pr view <n> --json number,title,headRefName,body,url
git fetch origin <headRef>
git checkout -B <headRef> origin/<headRef>
```

The session is now worktree-isolated: run every git command from the worktree root, with no `-C` redirect and no `cd` into a subdirectory first. A worktree-isolated session refuses both.

## 2. Read the review

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews \
  --jq '.[] | "=== \(.id) \(.user.login) [\(.state)]\n\(.body)"'

gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate \
  --jq '.[] | "=== \(.id) | \(.user.login) | \(.path):\(.line // .original_line) | reply_to \(.in_reply_to_id // "none")\n\(.diff_hunk)\n---\n\(.body)\n"'
```

Keep the comment ids. Replies go to `/comments/<id>/replies`, never to a top-level PR comment.

## 3. Consider the feedback

**REQUIRED SUB-SKILL:** Use `superpowers:receiving-code-review` before writing any code. Verify each claim against the codebase first, and push back with technical reasoning where the reviewer lacks context. Where a claim is checkable, check it: this beats reasoning about it in prose.

Sort the comments into three buckets:

- **Code change** — gets a diff, a commit, and a bare-SHA reply.
- **Question or discussion** — gets a prose reply, no commit.
- **Out of scope** — offer to file an issue rather than growing the PR.

## 4. Walk the changes, one comment at a time

Do the work first, then write one message. For each code-change comment:

1. Read what you need, make the edit, and run `git diff -- <path>` — all tool calls.
2. **Then**, with no further tool calls, write a single message containing:
   - the reviewer's comment quoted verbatim, with its id
   - what you concluded about it
   - the full diff, inline, in a fenced `diff` block
   - the commit subject you would use
3. Stop and wait for a yes.

**Everything the user needs to judge the change goes in that one final message.** Two different things bury it otherwise, and both have happened:

- **Content left in tool output.** Tool results collapse to "Ran 1 shell command", so a diff shown only that way is invisible. Copy it into the message text.
- **Content written before a tool call.** Anything you say and then follow with a tool call is folded into the collapsed "Worked for 2m 8s" section. A quote written at the top of the turn and followed by one more command ends up hidden, while the diff below the last command stays visible — so the user sees a change with no sign of what it was for.

The order to hold: finish every tool call, then write. If you realise mid-message that you need to check something, check it and then rewrite the whole message, quote included. Never continue below a tool call and assume what you already wrote is still on screen.

Show one comment's diff per message. The user asked for incremental, which means they see one change, respond, and then see the next.

## 5. Commit on approval

Verify before committing, in the packages you touched:

```bash
pnpm typecheck && pnpm lint && pnpm test <affected-spec>
pnpm check-format   # from the repo root
```

One commit per comment. Conventional Commits subject, narrowest accurate scope, no issue references. Body says what the reviewer found and what changed.

Never amend and never force-push: the branch is already on the remote, so every fix is a new commit on top.

If the user redirects the change ("can't we drop this entirely?"), redo the edit, show the new diff, and wait again. Their redirection replaces your version, so do not commit the version they rejected.

## 6. Push, then reply

Push once, after the last commit:

```bash
git push origin <headRef>
```

Then reply per comment. **A comment addressed by a commit gets the SHA and nothing else:**

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies -f body='b2de47ae27' --jq '.html_url'
```

No "Fixed in", no summary. The SHA links to the commit, and the commit message carries the explanation.

Prose replies (questions, pushback, out-of-scope) are different: write them to `~/projects/drafts/pr-<n>-review-replies.md` first, show them in chat, and post only after the user confirms. Delete the draft once posted.

## Order matters

Push before replying, always. A reply posted before the push names a SHA the remote does not have, so the link is dead.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Diff shown only in tool output | Paste it inline as a fenced `diff` block |
| Quote written, then another tool call | Finish every tool call first, then write the whole message |
| Final message shows a diff but not the comment | Both belong in the same message, quote first |
| All diffs in one message | One comment per message, wait between each |
| Reply before push | Push first, so the SHA resolves |
| Prose around the SHA | Bare SHA only for a commit-addressed comment |
| Top-level PR comment | Reply in the thread via `/comments/<id>/replies` |
| Commit before approval | Show the diff, wait for a yes |
| `git -C` or `cd` in a worktree session | Run git from the worktree root |
| Fixing an out-of-scope suggestion | Offer to file an issue instead |
