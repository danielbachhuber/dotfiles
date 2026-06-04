# CLAUDE.md

## Pull Requests

- When editing a pull request description, make sure to first fetch the existing description. I may have edited it in the interim and it's frustrating to have my edits blown away.
- When replying to PR review comments, push the commit first, then leave the reply. That way the reply can reference the commit SHA, and the reviewer can follow the link to the exact changeset.
- Whenever you prepare a PR description, PR comment, issue body, or issue comment on my behalf, first write the content to a markdown file in `~/projects/drafts/` so I can easily access and edit it before anything is posted. Don't post to GitHub until I've confirmed.

## GitHub Issues

- When editing an issue body, first fetch the existing body — same reason as PR descriptions.
- No headings in the body. Write the context as prose, then any bulleted considerations or scope, then the "Done is:" block.
- End every issue with a `**Done is:**` section: a short bulleted list of concrete, verifiable completion criteria. See https://danielbachhuber.com/done-is/ for the reasoning.
- Let me verify the issue content before you create it.

## Tools

- For Google Workspace access (Drive, Sheets, Gmail, Docs, Slides, Calendar, etc.), use the `gws-cli` skill. However, ~/.claude/scripts/fetch-google-doc.ts is even more helpful for Google Docs, and ~/.claude/scripts/fetch-google-slides.ts even more helpful for Google Slides. Both scripts accept the document ID as the first argument. If there's an authentication failure, inform the end user instead of trying to fetch the document instead.
- For a headless browser (rendering JS-heavy pages, extracting metadata/taglines, detecting on-site comment platforms, screenshots), use the global Playwright tool at `~/.claude/tools/playwright/browse.mjs`. It is project-independent — no per-project install. Run it as `node ~/.claude/tools/playwright/browse.mjs <url ...>` or `--file urls.txt` (bare URLs or TSV rows whose last field is the URL); add `--jsonl out.jsonl`, `--screenshot <dir>`, `--timeout <ms>`, `--concurrency <n>`. It outputs one JSON object per URL (title, meta/og descriptions, h1, taglineGuess, commentVendors, finalUrl, screenshot path). Network access requires running it with the sandbox disabled. Playwright + Chromium are already installed there; if Chromium is missing after a version bump, run `npx playwright install chromium` from that dir. Soft anti-bot interstitials are auto-waited, but sites behind Cloudflare's *managed* challenge (e.g. "Just a moment…") will still return 403 — that's an inherent limit of headless scraping, not a misconfiguration.

## Git Worktrees

- Always use Claude Code's native git worktree support (the `EnterWorktree` / `ExitWorktree` tools, or `isolation: "worktree"` when dispatching an Agent) instead of the `superpowers:using-git-worktrees` skill. Do not invoke that skill — prefer the built-in tooling.
