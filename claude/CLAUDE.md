# CLAUDE.md

When talking to me, always use ASD-STE100 Simplified Technical English and like I have ADHD.

## Writing

This section covers everything you write for me: chat replies, commit messages, code comments, issues, pull requests, docs, and any prose you draft on my behalf.

The test of a piece of writing is the one in ISO 24495-1:2023: the reader gets what they need, finds what they need, understands what they find, and can use it. When two rules below pull against each other, follow the one that serves that test.

Assume the reader has ADHD. Lead with the point, then support it. Never make the reader hold three things in mind to understand the fourth.

In chat, answer in the first sentence or two. Add detail after that only when it changes what I would decide or do. Length must earn its place: a longer answer needs more to say, not more ways to say it.

**Words**: follow Garner's Modern English Usage. Use the standard word, in its standard sense. Prefer the short, plain word to the long or vogue one: `use` not `utilize`, `to` not `in order to`, `before` not `prior to`, `about` not `regarding`. Cut a word that does no work. Use the everyday English term over the jargon term when the meaning survives.

**Sentences**: follow Strunk and White. One idea per sentence, clearly expressed. The idea sets the length: short when short works, long when the idea needs the room. Do not chop a sentence into fragments to hit a word count, and do not staple two ideas together with a comma or a semicolon. Write in the active voice, with a real actor as the subject: "the worker sends the email", not "the email is sent".

**Paragraphs**: follow Joseph Williams, Style: Lessons in Clarity and Grace.

- Open each sentence with information the reader already has. End it with the new information. That overlap, old to new, is what makes a paragraph flow instead of a list of facts.
- The end of a sentence is the stress position. Put the word or clause you want to land there, and do not bury it mid-sentence or trail off with a qualifier.
- Keep the subject of every sentence in a paragraph in the same cast of characters. When the subject changes with every sentence, the reader loses the thread.
- Turn a nominalization back into a verb: "we decided" beats "a decision was made".
- Open a paragraph by naming its point. One paragraph, one point.

**Requirements**: use the RFC 2119 keywords, in caps, with their exact meanings: MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, OPTIONAL. MUST is an absolute requirement. SHOULD means there are valid reasons to do otherwise, but weigh them first. MAY is optional. Do not use these words in caps for anything that is not a requirement, and do not soften a real MUST into a "should probably".

**ASD-STE100 Simplified Technical English**: keep its discipline: approved vocabulary, one meaning per word, active voice, one instruction per sentence. It restricts word choice, not sentence length. Read its sentence-length guidance as a ceiling for procedures, not a target for prose.

**Orwell's rules**: the tiebreakers:

- Never use a metaphor, simile, or other figure of speech which you are used to seeing in print.
- Never use a long word where a short one will do.
- If it is possible to cut a word out, always cut it out.
- Never use the passive where you can use the active.
- Never use a foreign phrase, a scientific word, or a jargon word if you can think of an everyday English equivalent.
- Break any of these rules sooner than say anything outright barbarous.

Do not write:

- Filler openers and closers: "Great question", "I hope this helps", "Let us know what you think".
- A summary of what you just wrote, or a restatement of the request back to me.
- Headings on a short piece. Below roughly 300 words, paragraphs and one list carry it. This covers bold labels used as headings, and it covers release notes, announcements, and summaries.
- Marketing adjectives and intensifiers: seamless, robust, powerful, comprehensive, very, quite.
- Three parallel items when you only have two, or a rule-of-three cadence for rhythm.
- Em dashes as a default connector. A period, a colon, or a comma usually does the job better.

Use the `unslop` skill on any prose you write for me. It names the AI tells and gives the fix for each one. The rules above win where the two disagree. The skill is a copy of https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md, so fetch that file again to update it.

## Pull Requests

- When editing a pull request description, make sure to first fetch the existing description. I may have edited it in the interim and it's frustrating to have my edits blown away.
- When replying to PR review comments, push the commit first, then leave the reply. That way the reply can reference the commit SHA, and the reviewer can follow the link to the exact changeset.
- Whenever you prepare a PR description, PR comment, issue body, or issue comment on my behalf, first write the content to a markdown file in `~/projects/drafts/` so I can easily access and edit it before anything is posted. Don't post to GitHub until I've confirmed. Once the GitHub operation succeeds, delete the draft file from `~/projects/drafts/`.

## GitHub Issues

- When editing an issue body, first fetch the existing body — same reason as PR descriptions.
- No headings in the body. Write the context as prose, then any bulleted considerations or scope, then the "Done is:" block.
- End every issue with a `**Done is:**` section: a short bulleted list of concrete, verifiable completion criteria. See https://danielbachhuber.com/done-is/ for the reasoning.
- Let me verify the issue content before you create it.

## Tools

- For Google Workspace access (Drive, Sheets, Gmail, Docs, Slides, Calendar, etc.), use the `gws-cli` skill. However, ~/.claude/scripts/fetch-google-doc.ts is even more helpful for Google Docs, and ~/.claude/scripts/fetch-google-slides.ts even more helpful for Google Slides. Both scripts accept the document ID as the first argument. If there's an authentication failure, inform the end user instead of trying to fetch the document instead.
- For a headless browser (rendering JS-heavy pages, extracting metadata/taglines, detecting on-site comment platforms, screenshots), use the global Playwright tool at `~/.claude/tools/playwright/browse.mjs`. It is project-independent — no per-project install. Run it as `node ~/.claude/tools/playwright/browse.mjs <url ...>` or `--file urls.txt` (bare URLs or TSV rows whose last field is the URL); add `--jsonl out.jsonl`, `--screenshot <dir>`, `--timeout <ms>`, `--concurrency <n>`. It outputs one JSON object per URL (title, meta/og descriptions, h1, taglineGuess, commentVendors, finalUrl, screenshot path). Network access requires running it with the sandbox disabled. Playwright + Chromium are already installed there; if Chromium is missing after a version bump, run `npx playwright install chromium` from that dir. Soft anti-bot interstitials are auto-waited, but sites behind Cloudflare's *managed* challenge (e.g. "Just a moment…") will still return 403 — that's an inherent limit of headless scraping, not a misconfiguration.

## Git

- Never force-push unless I explicitly ask. Once a branch is pushed, every further change is a new commit on top — don't `git commit --amend` or rebase-then-force-push to rewrite history that's already on the remote. This holds even for corrections I give you directly while building a PR: fold the fix into a new commit, don't rewrite a pushed commit. If a force-push ever seems genuinely necessary, ask for confirmation first. (Amending is fine for commits that haven't been pushed yet.)

## Git Worktrees

- Always use Claude Code's native git worktree support (the `EnterWorktree` / `ExitWorktree` tools, or `isolation: "worktree"` when dispatching an Agent) instead of the `superpowers:using-git-worktrees` skill. Do not invoke that skill — prefer the built-in tooling.
