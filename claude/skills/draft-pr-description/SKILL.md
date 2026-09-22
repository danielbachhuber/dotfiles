---
name: draft-pr-description
description: Use when a pull request needs its description written or rewritten — a new PR body, filling in the repo template, or expanding a section a reviewer found thin — and this session holds the diff, measurements, and decisions that belong in it.
argument-hint: [pr-number-or-branch]
---

# Draft PR description

You write the description from what this session knows. The diff is the one thing a
reviewer can already read for themselves, so a description that restates it adds nothing.
The value is in what the diff cannot show: every decision, rejected alternative,
measurement and caveat from this session, and the prior state the change replaces.

## 1. Gather

Collect before you write a word. Run these from the repo.

```bash
git diff main...HEAD
git diff --stat main...HEAD
```

For a PR that already exists, take what is live so the draft starts from the current body:

```bash
gh pr view <n> --json title,body,isDraft,files --jq '{title, isDraft, files: [.files[].path]}'
gh pr view <n> --json body --jq .body > ~/projects/drafts/pull-request-<n>-current.md
```

Then dig for the prior state, which is the part you cannot reconstruct from the diff:

```bash
git log --oneline --follow -12 -- <path>       # what built this file, with PR numbers
git log --oneline -S '<removed-string>' -- <path>   # when the behaviour being changed arrived
```

## 2. Find the repo's format

A repo that documents its own PR format outranks anything this skill would invent. Look for
a format document and a template:

```bash
ls docs/contributing/writing-pr-descriptions.md docs/contributing/pull-requests.md CONTRIBUTING.md 2>/dev/null
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md docs/pull_request_template.md 2>/dev/null
```

Read the first format document and the first template found. If the repo has its own
PR-description skill, load it too. If you find nothing in a repo you know documents its
format, look for where it moved before inventing a structure.

## 3. Work through the checklist

Read `checklist.md` in this skill's directory and answer each question. You do not need to
write the answers to a file. Three carry most of the value, and all three come from the
conversation rather than the diff:

| Question | What belongs there |
| --- | --- |
| `Decisions` | Each choice, the alternative genuinely considered, why it lost. Including the ones you talked yourself out of. |
| `Verified, not assumed` | Everything checked with a command or an API call rather than reasoned about, and the check itself. Branch protection, downstream consumers, whether a flag survives, whether a skipped job blocks a merge. |
| `Uncertainties` | Estimated versus measured, what a reviewer should doubt, figures that rest on outliers. |

Scan back through the session for corrections. A number you revised, a design you priced
and rejected, an assumption that turned out wrong: the design and the assumption belong in
the description. They are the details a reviewer would otherwise spend an hour
rediscovering, and they are invisible in the diff. A correction to your own earlier analysis
does not.

Where the checklist turns up something you have not measured or checked, go do it now, or
carry it into the description as an uncertainty.

## 4. Write the draft

Read `writing.md` in this skill's directory, then write the body to
`~/projects/drafts/pull-request-<slug>.md` (`pull-request-<n>-<slug>.md` for a PR that
already exists). Settle the title at the same time.

## 5. Fact-check before showing it

Read the draft back and check it against the code, not against your memory of the session.

- **Invented facts.** Any claim you cannot point to a command, a line, or a session
  decision behind. This is the failure to hunt for hardest, because it reads as confident.
- **Dropped caveats.** A number that appears without the qualifier it needs.
- **Overclaiming.** "Fixes", "removes", "resolves" where the evidence only supports
  "reduces".
- **Lost structure.** Headings from the repo template, or an expander the format requires.
- **Claims you can check in under a minute.** Check them. A job name, a `needs:` edge, a
  file path, whether a downstream workflow really is scoped to one branch.

## 6. Add the diff links

The draft names files by path, because the pull request number usually does not exist when the
body is drafted. Once it does, turn the notable paths into diff-view links so a reviewer
lands on the hunk rather than the whole file:

```bash
~/.claude/skills/draft-pr-description/difflink.sh 5765 .github/workflows/e2e.yml 32
```

Link the one or two files that need real review, not every path in the body. Splice them in
with Edit.

## 7. Lay out before/after media

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
  --body-file ~/projects/drafts/pull-request-<slug>.md \
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

Then convert, keeping the whole recorded window:

```bash
ffmpeg -i video.webm -vf "fps=24" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart before.mp4
```

**Do not crop to a region of the window.** Ship the whole thing. A tighter frame looks
like it buys legibility in a narrow table cell, but a screencast moves vertically as the app
changes state, so a window framed on the moment that proves the point silently cuts the
beats around it, and the reader loses the context that makes the moment legible at all.
Resolution is the lever for legibility, not framing: `deviceScaleFactor` plus a matching
viewport, and the reader expands the player if they need more.

Trimming *time* is fine and often worth it: `-ss <seconds>` before `-i` drops a dead lead-in
such as page load or login. That removes nothing from the frame.

A before video usually means running the same recording twice against one dev stack, once
with the change and once with it reverted. Revert by rewriting the lines, not by stashing:
the stash stack is shared across worktrees.

## 8. Show, then apply

Relay the title, the body, and anything you flagged. Then wait.

Editing a live PR body is a GitHub write, and it needs its own approval even when the
description was requested. Re-fetch before applying, in case it was edited meanwhile.

```bash
gh pr edit <n> --repo <owner>/<repo> --body-file ~/projects/drafts/pull-request-<slug>.md
gh pr create --repo <owner>/<repo> --title "<title>" --body-file ~/projects/drafts/pull-request-<slug>.md
```

Add `--attach` for any media (step 7), and re-read the body afterwards: an appended asset
means the reference was not substituted and still needs splicing.

Delete the draft from `~/projects/drafts/` once the GitHub operation succeeds.

## Revising one section

A reviewer asking for more detail in one section does not need a whole regenerated body,
which would churn prose the author already approved. Work through only the checklist
questions that section draws on, write that section alone, and splice it in with Edit.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Description restates the diff and nothing else | The diff is the one thing a reviewer can already read. The description earns its place through the prior state, the decisions, and what was verified. |
| Session decisions left out | The repo is readable later; the conversation is not. An alternative you priced and rejected is lost unless the description records it. |
| Numbers without provenance | A figure with no method and no caveat comes back as a confident claim the reviewer cannot check. |
| Regenerating a whole body to fix one section | Splice one section. Wholesale regeneration rewrites prose the author already signed off. |
| Skipping the format lookup | Without the repo's format document, the body arrives in the wrong shape. |
| Fact-checked from memory | Re-run the greps behind the load-bearing claims. A confident sentence built on a stale fact is the expensive failure. |
| Posting because the prose reads well | Fluent and wrong is the expected failure. Check every claim against its evidence. |
| Reciting how a number was measured | Provenance is one clause, not a sentence of sample sizes and API limits. Only a correction to your own earlier analysis is banned outright. |
| Before/after media as two labelled paragraphs | A two-column `Before` / `After` table. Side by side is the layout that answers the reviewer's actual question. |
| Bare video URL inside a table cell | It renders as a plain link. `<video src="URL" controls></video>` in the cell, then confirm with a `<video` count against `body_html`. |
| Trusting `--attach` order to label the assets | Download each asset with the gh token and compare hashes. A swapped before/after argues the opposite of the truth. |
| Raising `video.size` alone to get a sharper recording | It scales down into that canvas, never up: you get the page in a corner surrounded by filler. Raise `deviceScaleFactor` *and* the viewport, and check a frame. |
| Cropping the screencast to the interesting region | Ship the whole window. The layout moves as the app changes state, so a frame chosen on one beat cuts the others. Trim time with `-ss` instead. |
