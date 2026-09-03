---
name: draft-pr-description
description: Use when a pull request needs its description written or rewritten — a new PR body, filling in the repo template, or expanding a section a reviewer found thin — and this session holds the diff, measurements, and decisions that belong in it.
argument-hint: [pr-number-or-branch]
---

# Draft PR description

`codex` writes the prose. Your job is the brief.

`codex` runs in the repo and can read it, so it can check a path or a surrounding function
if it has to. It cannot see this conversation. Every decision, rejected alternative,
measurement and caveat reaches the description only through the brief you hand it, and a
thin brief produces a description that could sit on any pull request. Give `codex` enough
direction that it never needs to go exploring: what it finds by reading code is the diff
restated, which is the one thing a reviewer can already see for themselves.

## 1. Gather

Collect before you write a word of the brief. Run these from the repo.

```bash
git diff main...HEAD
git diff --stat main...HEAD
```

For a PR that already exists, take what is live so the draft starts from the current body:

```bash
gh pr view <n> --json title,body,isDraft,files --jq '{title, isDraft, files: [.files[].path]}'
gh pr view <n> --json body --jq .body > ~/projects/drafts/pr-<n>-current.md
```

Then dig for the prior state, which is the part you cannot reconstruct from the diff:

```bash
git log --oneline --follow -12 -- <path>       # what built this file, with PR numbers
git log --oneline -S '<removed-string>' -- <path>   # when the behaviour being changed arrived
```

## 2. Write the brief

Copy the template and fill every slot:

```bash
cp ~/.claude/skills/draft-pr-description/brief-template.md ~/projects/drafts/brief-<slug>.md
```

The slots are `What changed`, `Why now`, `Prior state`, `Measurements`, `Decisions`,
`Verified, not assumed`, `Out of scope`, `Testing`, `Must appear`, `Uncertainties`. A slot
with nothing real in it gets `None.` rather than a guess.

`Must appear` is the lever for a second pass. `codex` weighs relevance and will drop a
figure it judges redundant, reporting it under `unused`. When the author wants that figure
back, list it under `Must appear` and re-run rather than editing the body by hand: the
brief stays the source of truth, and the next run does not lose the fix.

Three slots carry most of the value, and all three come from the conversation rather than
the diff. Write them from what this session actually did:

| Slot | What belongs there |
| --- | --- |
| `Decisions` | Each choice, the alternative genuinely considered, why it lost. Including the ones you talked yourself out of. |
| `Verified, not assumed` | Everything checked with a command or an API call rather than reasoned about, and the check itself. Branch protection, downstream consumers, whether a flag survives, whether a skipped job blocks a merge. |
| `Uncertainties` | Estimated versus measured, what a reviewer should doubt, figures that rest on outliers. |

`(background)` marks a brief bullet that must not reach the description at all. Reserve it
for corrections to your own earlier analysis: a number you got wrong and fixed belongs in
the brief, never in a pull request body. Method stays publishable otherwise, held to one
clause by concision rather than banned.

Scan back through the session for corrections. A number you revised, a design you priced
and rejected, an assumption that turned out wrong: those belong in `Decisions` or
`Uncertainties`. They are the details a reviewer would otherwise spend an hour
rediscovering, and they are invisible in the diff.

## 3. Run codex

```bash
~/.claude/skills/draft-pr-description/build-prompt.sh \
  ~/projects/drafts/brief-<slug>.md \
  ~/projects/drafts/pr-<slug>.md \
  /tmp/pr-description-prompt.md
```

The second argument is where `codex` writes the description. It is baked into the prompt,
and `codex` reports the path back as `draft_path`, so it must be the path you intend to
read in step 4.

It prints the prompt path and, on stderr, a manifest naming the style guide, the repo's
format document, and the template it found. **Read the manifest.** If `format doc` says
`none found` in a repo you know documents its format, the search paths in the script need
the new location, and `codex` is about to invent a format instead.

```bash
codex exec - --sandbox workspace-write \
  -c 'sandbox_workspace_write.writable_roots=["/Users/danielb/projects/drafts"]' \
  --skip-git-repo-check \
  --output-schema ~/.claude/skills/draft-pr-description/schema.json \
  --output-last-message /tmp/pr-description-result.json \
  < /tmp/pr-description-prompt.md > /tmp/pr-description-run.log 2>&1
```

**`codex` writes the draft file itself, so the sandbox has to let it.** `--sandbox
read-only` fails in a way that looks like success: exit 0, a well-formed result JSON, a
sensible `outline`, and a `gaps` entry saying the write was blocked. No file is created.
`workspace-write` alone is not enough either, because `~/projects/drafts` sits outside the
repo and only `writable_roots` reaches it.

Two plain commands, not a pipeline: a worktree-isolated session refuses compound commands
it cannot verify. Expect up to a couple of minutes. `codex` echoes the prompt to stdout,
which is why stdout goes to the log. If the result file is missing or `jq` cannot parse
it, read `/tmp/pr-description-run.log`.

## 4. Fact-check before showing it

The description is already on disk: `codex` wrote it at the path you passed as
`<draft-out.md>`. The result JSON carries only metadata — `title`, `draft_path`,
`outline`, `unused`, `gaps` — and **no `body` field**. Never pipe `jq -r .body` into the
draft path: it truncates the file `codex` just wrote to the single word `null`.

```bash
jq -r '.title, .draft_path' /tmp/pr-description-result.json
jq -r 'if (.gaps | length) == 0 then "(no gaps)" else .gaps[] | "- \(.)" end' /tmp/pr-description-result.json
jq -r 'if (.unused | length) == 0 then "(all used)" else .unused[] | "- \(.)" end' /tmp/pr-description-result.json
```

Confirm `draft_path` matches the path you asked for and the file is non-trivial
(`wc -l`) before reading it. A one-line draft means the write was blocked, not that
`codex` was terse.

Check the body against the code, not only against the brief. The brief can be wrong, and
`codex` can read the repo and still land a claim slightly off.

- **Invented facts.** Any claim with no line in the brief behind it. This is the failure
  to hunt for hardest, because it reads as confident.
- **Dropped caveats.** A number that appears in the body without the qualifier the brief
  attached to it.
- **Overclaiming.** "Fixes", "removes", "resolves" where the brief only supports "reduces".
- **Lost structure.** Headings from the repo template, or an expander the format requires.
- **Claims you can check in under a minute.** Check them. A job name, a `needs:` edge, a
  file path, whether a downstream workflow really is scoped to one branch.

Then decide where the fix goes. The test is not how big the error is. It is whether the
brief was right:

| What you found | Where the fix goes |
| --- | --- |
| Wording, a link repeated four times, a vague noun where the real identifier reads better, a dropped backtick | Edit the draft yourself. The brief was right and the prose slipped. |
| A wrong or missing fact, an invented or dropped criterion, a hypothesis written as fact, the wrong structure | Fix the brief and re-run. |

Editing the body to paper over a brief defect leaves the brief wrong, so the next run
reproduces it. That is the one case where a hand edit costs more than a re-run.

`gaps` is the useful half of the output. It names what to go measure before the next run,
and flags anything `codex` had to read the repo to resolve, which is a brief that needed
one more line.

## 5. Add the diff links

`codex` names files by path, because the pull request number usually does not exist when the
body is drafted. Once it does, turn the notable paths into diff-view links so a reviewer
lands on the hunk rather than the whole file:

```bash
~/.claude/skills/draft-pr-description/difflink.sh 5765 .github/workflows/e2e.yml 32
```

Link the one or two files that need real review, not every path in the body. Splice them in
with Edit.

## 6. Lay out before/after media

Anything visual, a screenshot or a screencast, goes in a two-column table with `Before` and
`After` as the headers: one media cell per column, and an optional caption row beneath it.
Not a stack of labelled paragraphs. The reviewer's whole question is what changed, and
side by side is the only layout that answers it at a glance.

```markdown
| Before | After |
|:------:|:-----:|
| ![before](./before.png) | ![after](./after.png) |
| Keystrokes land in the field mid-post. | The field is locked until the post completes. |
```

`gh pr create` and `gh pr edit` upload the files themselves via `--attach` (gh 2.99+), so
nothing needs to be committed to the repo or hosted anywhere:

```bash
gh pr create --repo <owner>/<repo> --title "<title>" \
  --body-file ~/projects/drafts/pr-<slug>.md \
  --attach ./before.png --attach ./after.png
```

Three properties of that upload decide whether the table renders:

- **Reference rewriting is path-literal.** `--attach ./before.png` substitutes a body
  reference written exactly `./before.png`. Attach an absolute path against a `./before.png`
  reference and nothing is substituted: gh appends the asset to the end of the body instead.
  Either `cd` to the media directory and attach relative paths, or plan on the splice below.
  gh resolves the branch from the working directory, so that `cd` has to stay inside the
  repo.
- **A video is appended, never substituted.** For a screencast the flow is always: attach,
  read the appended `https://github.com/user-attachments/assets/<id>` URLs back out of the
  body, splice them into the table, then `gh pr edit --body-file` again.
- **A bare video URL becomes a player only when it is alone on its own line.** In a table
  cell it degrades to a plain link, which is exactly the thing you were trying to avoid. Use
  the HTML element in the cell instead:

  ```markdown
  | <video src="https://github.com/user-attachments/assets/<id>" controls></video> | <video src="https://github.com/user-attachments/assets/<id>" controls></video> |
  ```

  Images are the easy case: `![alt](URL)` works in a cell as written.

Never trust attach order to tell you which uploaded asset is which. The labels are the
entire point of the table, and a swapped pair argues the opposite of the truth. Confirm by
hash:

```bash
T=$(gh auth token)
curl -sL -H "Authorization: Bearer $T" -o /tmp/check.mp4 \
  "https://github.com/user-attachments/assets/<id>"
md5 /tmp/check.mp4 ./before.mp4
```

Then check what GitHub rendered, not what you wrote:

```bash
gh api repos/<owner>/<repo>/pulls/<n> -H "Accept: application/vnd.github.html+json" \
  --jq .body_html | grep -c '<video'
```

Two hits means two players. Zero, with the table present, means a bare URL in a cell
quietly became a link.

Playwright records webm, which GitHub will not play, and records at CSS-pixel resolution by
default, which looks soft once GitHub scales it into a table cell. Record at 2x and convert:

```javascript
test.use({
    viewport: { width: 1600, height: 920 },
    deviceScaleFactor: 2,
    video: { mode: 'on', size: { width: 1600, height: 920 } },
});
```

The three have to agree, and the trap is that they interact:

- `deviceScaleFactor: 2` genuinely doubles captured detail, but a react-native-web app then
  lays itself out for **half** the viewport width. At `viewport: 800` with `dsf: 2` you get a
  crisp 400px-wide mobile layout, not a crisp desktop one. Double the viewport to get the
  layout you wanted at twice the pixels.
- `video.size` is a canvas, and Playwright scales the capture *down* into it, never up. Set
  it larger than the capture and you get the page in the top-left corner with grey filler
  around it. Set it to match `viewport`.
- Confirm both by reading a frame, not by reading the dimensions. `ffprobe` reporting
  1600x920 tells you nothing about whether those are real pixels or filler:
  `ffmpeg -i video.webm -ss <t> -frames:v 1 frame.png`, then look at it.

Then convert, and crop to the part of the screen the change is actually about. In a
two-column table each player displays at roughly half the body width, so cropping away
chrome and whitespace buys more legibility than resolution does:

```bash
ffmpeg -i video.webm -vf "crop=<w>:<h>:<x>:<y>,fps=24" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart before.mp4
```

Width and height both have to be even for h264.

**A crop is a claim about every frame, not the one you sampled.** A screencast moves
vertically as the app changes state, so a window framed on the moment that proves the point
can cut the beats around it. Check the crop against the first frame, the last frame, and the
moment itself, and measure rather than eyeball: sample frames at 1fps and take the union
bounding box of the genuinely dark pixels, which is what a reader has to be able to read.

```bash
ffmpeg -i video.webm -vf "fps=1,format=rgb24" /tmp/f-%03d.ppm
# then union the bbox of pixels with all channels < ~140 across those frames
```

When the ink runs outside the window only during a dead lead-in, trim the time range
instead of loosening the crop: `-ss <seconds>` before `-i`. Widening to include a beat that
does not matter spends the reader's pixels on it. Starting a few seconds in usually costs
nothing, because page load and navigation are never the point.

A before video usually means running the same recording twice against one dev stack, once
with the change and once with it reverted. Revert by rewriting the lines, not by stashing:
the stash stack is shared across worktrees.

## 7. Show, then apply

Relay the title, the body, the gaps, and anything you flagged. Then wait.

Editing a live PR body is a GitHub write, and it needs its own approval even when the
description was requested. Re-fetch before applying, in case it was edited meanwhile.

```bash
gh pr edit <n> --repo <owner>/<repo> --body-file ~/projects/drafts/pr-<slug>.md
gh pr create --repo <owner>/<repo> --title "<title>" --body-file ~/projects/drafts/pr-<slug>.md
```

Add `--attach` for any media (step 6), and re-read the body afterwards: an appended asset
means the reference was not substituted and still needs splicing.

Delete the brief and draft files from `~/projects/drafts/` once the GitHub operation
succeeds.

## Revising one section

A reviewer asking for more detail in one section does not need a whole regenerated body,
which would churn prose the author already approved. Fill only the relevant brief slots,
tell `codex` in the brief title that it is drafting that section alone, and splice the
result in with Edit.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Brief describes the diff and nothing else | The diff is the one thing a reviewer can already read. The brief earns its place through `Prior state`, `Decisions`, and `Verified`. |
| Session decisions left out | The repo is readable; the conversation is not. An alternative you priced and rejected is invisible unless you write it down. |
| Numbers without provenance | A figure with no method and no caveat comes back as a confident claim the reviewer cannot check. |
| `codex` exits 0 and the draft is missing or one line | The sandbox blocked the write. `--sandbox workspace-write` plus `writable_roots` covering `~/projects/drafts`; read `gaps`, which says so. |
| `jq -r .body` into the draft path | The schema has no `body`. `codex` already wrote the file; that pipe overwrites it with `null`. |
| Skipping the manifest on stderr | Without the repo's format document, `codex` invents a structure and the body arrives in the wrong shape. |
| Regenerating a whole body to fix one section | Splice one section. Wholesale regeneration rewrites prose the author already signed off. |
| Fact-checked only against the brief | The brief can be wrong. Re-run the greps behind the load-bearing claims; a confident sentence built on a stale fact is the expensive failure. |
| Posting because the prose reads well | Fluent and wrong is the expected failure. Check every claim against a brief line. |
| Verbose brief, verbose description | `codex` mirrors the register it is fed. Write brief bullets as a clause per fact; tightening the brief tightens the output more reliably than asking for brevity in the prompt. |
| Reciting how a number was measured | Provenance is one clause, not a sentence of sample sizes and API limits. Only a correction to your own earlier analysis is banned outright, with `(background)`. |
| Hand-patching a fact `codex` dropped | Put it under `Must appear` and re-run. Editing the body leaves the brief wrong, so the next run drops it again. |
| Filling empty slots with plausible text | `None.` is a valid answer and a useful signal. Invented content in the brief becomes invented content in the description. |
| Before/after media as two labelled paragraphs | A two-column `Before` / `After` table. Side by side is the layout that answers the reviewer's actual question. |
| Bare video URL inside a table cell | It renders as a plain link. `<video src="URL" controls></video>` in the cell, then confirm with a `<video` count against `body_html`. |
| Trusting `--attach` order to label the assets | Download each asset with the gh token and compare hashes. A swapped before/after argues the opposite of the truth. |
| Raising `video.size` alone to get a sharper recording | It scales down into that canvas, never up: you get the page in a corner surrounded by filler. Raise `deviceScaleFactor` *and* the viewport, and check a frame. |
| Crop offsets picked from one frame | The layout moves as the app changes state. Union the ink bbox across frames, and trim a dead lead-in with `-ss` rather than widening the window. |
