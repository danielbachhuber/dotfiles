## Writing

- Whenever you prepare a PR description, PR comment, issue body, or issue comment on my behalf, first write the content to a markdown file in `~/projects/drafts/` so I can easily access and edit it before anything is posted. Don't post to GitHub until I've confirmed. Once the GitHub operation succeeds, delete the draft file from `~/projects/drafts/`.
  - Pull requests should be prefixed with `pull-request-`, issues with `issue-`, and replies with `reply-`. Each should then have a stable descriptive suffix, likely the branch name. If the PR or issue already exists, then include the number immediately after the prefix.
- Avoid em dashes in drafted text, except when preserving a verbatim quote.
- When synthesizing bullet points from a source, include the supporting verbatim quote beneath each bullet, with a speaker and timestamp/locator when available.
- Don't cite figures from search-result summaries. Read the underlying source and confirm the figure there first, or leave it out.
- When citing numbers from a source document, give the page number and link to the source with a page anchor (`<url>#page=NN`). Check that the PDF page index matches the printed page number. For PDFs viewed in Google Drive, which ignores page anchors, give the page number as text.
- Describe the current system on its own terms. Do not document prior-state behavior unless I explicitly ask for it.
- Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter worth varying," the mannered writer produces "a dial worth turning." Instead of "this point still matters," they write "this point earns its keep." The phrases exist to display the writer, not to convey the idea, and readers can tell. That is why mannered prose irritates: it makes the reader work harder so the writer can perform. It is also imprecise. Metaphors drag in connotations the writer did not choose and cannot control. The fix is to say what you mean. When a literal phrase is available, use it.
- Use approachable English without jargon or mannered prose and without assumed contextual references.
- When referring to a GitHub issue or pull request, always give both its full title and its number, and link the number to its URL, e.g. `Fix login redirect loop ([#123](https://github.com/owner/repo/issues/123))`. Outside GitHub, a bare `#123` isn't clickable. Use `owner/repo#123` as the link text when it's in a different repo from the one under discussion. Get the owner and repo from `gh repo view` or the git remote rather than guessing. An `/issues/<n>` URL redirects to the PR when the number is a PR. Read the title from `gh issue view` or `gh pr view` rather than paraphrasing or shortening it.

## Pull Requests

- Whenever a pull request description needs writing or rewriting, prioritize the `draft-pr-description` skill first. It owns the workflow. A repo's own PR-description skill (for example `writing-pr-descriptions` in psi-product) supplies that repo's required format and sections, so load both when both apply. A project CLAUDE.md naming its own skill is not a reason to skip `draft-pr-description`.
- When editing a pull request description, make sure to first fetch the existing description. I may have edited it in the interim and it's frustrating to have my edits blown away.
- When replying to PR review comments, push the commit first, then leave the reply. That way the reply can reference the commit SHA, and the reviewer can follow the link to the exact changeset. Use the full 40-character SHA, read back from `git rev-parse HEAD` rather than retyped from earlier output: an abbreviated SHA is easy to get a character wrong, and a SHA GitHub can't resolve renders as plain text instead of a commit link.

## GitHub Issues

- When editing an issue body, first fetch the existing body — same reason as PR descriptions.
- No headings in the body. Write the context as prose, then any bulleted considerations or scope, then the "Done is:" block.
- End every issue with a `**Done is:**` section: a short bulleted list of concrete, verifiable completion criteria. See https://danielbachhuber.com/done-is/ for the reasoning.
- Let me verify the issue content before you create it.

## Git workflow

- Do not create git commits unless I explicitly ask. Leave changes in the working tree for review.
- Push after every commit you make, so the remote stays current. Plain pushes only: anything that rewrites history, including `gh stack push`, still needs my go-ahead.
- Never force-push, amend a pushed commit, or rewrite a pushed branch unless I explicitly ask. Add follow-up commits instead.
- Stacked pull requests need rebases, never merge commits. This is the exception to the rule above. When a PR belongs to a stack (GitHub shows it as part of "stack #N"), always update it with the `gh stack` CLI, whether it conflicts with its base or is only behind:
  1. `gh stack checkout <PR URL>` checks out every branch in the stack. Use the URL, since a bare number is tried as a stack number first.
  2. `gh stack rebase` rebases the whole stack onto the latest base branch.
  3. Fix any conflicts and continue the rebase.
  4. `gh stack push` pushes every branch in the stack with `--force-with-lease`.

  Run the usual checks before step 4, and ask me before pushing, since it rewrites history on branches other people may be reviewing.
- Do not commit brainstorming or design-spec documents; leave them available for review.
- In starting work on a new pull request in a new work tree, please draft the pull request description at the end of the initial body of work. This will give me a summary to read without having to explicitly ask for you to draft the pull request description.

## Working style

- For small, well-scoped changes, use a lightweight plan rather than creating a formal spec.
- Put temporary working files in `/tmp`, not in the repository or tool-state directories.

## Tools

- For Google Workspace access (Drive, Sheets, Gmail, Docs, Slides, Calendar, etc.), use the `gws-cli` skill. However, ~/.claude/scripts/fetch-google-doc.ts is even more helpful for Google Docs, and ~/.claude/scripts/fetch-google-slides.ts even more helpful for Google Slides. Both scripts accept the document ID as the first argument. If there's an authentication failure, inform the end user instead of trying to fetch the document instead.
- After creating or editing a Google Doc, export it to PDF and look at the rendered pages to confirm the formatting came out right. Reading the doc back as text with fetch-google-doc.ts doesn't catch layout problems. Run the export from `/tmp`, since gws rejects output paths outside the current directory: `gws drive files export --params '{"fileId":"<id>","mimeType":"application/pdf"}' -o /tmp/<name>.pdf`.
- For a headless browser (rendering JS-heavy pages, extracting metadata/taglines, detecting on-site comment platforms, screenshots), use the global Playwright tool at `~/.claude/tools/playwright/browse.mjs`. It is project-independent — no per-project install. Run it as `node ~/.claude/tools/playwright/browse.mjs <url ...>` or `--file urls.txt` (bare URLs or TSV rows whose last field is the URL); add `--jsonl out.jsonl`, `--screenshot <dir>`, `--timeout <ms>`, `--concurrency <n>`. It outputs one JSON object per URL (title, meta/og descriptions, h1, taglineGuess, commentVendors, finalUrl, screenshot path). Network access requires running it with the sandbox disabled. Playwright + Chromium are already installed there; if Chromium is missing after a version bump, run `npx playwright install chromium` from that dir. Soft anti-bot interstitials are auto-waited, but sites behind Cloudflare's *managed* challenge (e.g. "Just a moment…") will still return 403 — that's an inherent limit of headless scraping, not a misconfiguration.
- For Todoist, use the `td` CLI. Run `td --help` to see its commands. Use it instead of the claude.ai Todoist MCP connector, which often isn't authorized in agent sessions.

## bb

- When you link a file in a bb thread, such as a draft in `~/projects/drafts/`, the link text can be the filename or a partial path, but the link target must be the absolute path. For example: `[pull-request-my-branch.md](/Users/danielb/projects/drafts/pull-request-my-branch.md)`. Don't use a `~`-relative path, a path relative to the working directory, or a `file://` URL as the target. bb only renders absolute-path links as clickable files.
  - This applies to every file reference, not only links to drafts. A `file:line` code reference to a file outside the working directory, such as a skill under `~/.claude/skills/`, needs an absolute target: `[writing.md:67](/Users/danielb/.claude/skills/draft-pr-description/writing.md)`, not a bare `writing.md:67`, which bb opens relative to the worktree and fails with a 404.
  - Image embeds in a draft need absolute paths too. A `./before.png` embed shows as a broken image in the preview. Keep PR media in `~/projects/drafts/<draft-name>-media/` and embed each file by its absolute path.
- When a bb thread is about a pull request and runs in its own bb worktree, check the PR's branch out there with `gh pr checkout <number>` before starting, so I don't have to ask you to switch to it. If git says the branch is already checked out in another worktree, add `--detach`. In the project checkout, leave the current branch alone unless I ask. `bb status` shows which kind of environment the thread is in.
- If you create a new worktree partway through a bb thread (for example with `git worktree add`) and start working in it, switch the thread to it with the `update_environment_directory` tool, passing the worktree's absolute path. That way the thread's diff, terminals, and later turns follow the work. Stop the turn after the switch succeeds, as the tool requires.
