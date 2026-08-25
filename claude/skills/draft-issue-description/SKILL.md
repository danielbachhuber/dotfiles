---
name: draft-issue-description
description: Use when a GitHub issue needs drafting or rewriting — filing follow-up work a reviewer flagged as out of scope, turning something noticed mid-task into a tracked issue, or tightening an issue body that reads as an analysis dump.
argument-hint: [issue-number-or-topic]
---

# Draft issue description

`codex` writes the prose. Your job is the brief.

`codex` runs in the repo and can read it, so it can check a path or a caller if it has to. It
cannot see this conversation. The trigger, the reasoning, and the completion criteria reach
the issue only through the brief you hand it. Give it enough that it never needs to go
looking: what it finds by reading code is the current state restated, and the current state
is the easy half of an issue.

The hard half is the argument. An issue says what exists, why leaving it is a cost, what is
believed and on what basis, and what "done" would look like. Most issues here are
investigations, so the honest form is usually a question with criteria that allow the answer
to be no.

## 1. Gather

The commonest trigger is a review comment raising work that is out of scope for the pull
request it sits on. Fetch it rather than paraphrasing from memory:

```bash
gh api repos/<owner>/<repo>/pulls/comments/<comment-id> \
  --jq '{path, line, user: .user.login, url: .html_url, body}'
```

The comment id is the digits in a `#discussion_r<id>` link. For an issue comment or a
top-level review, use `issues/comments/<id>` or `pulls/<n>/reviews`.

Then establish the current state, with callers:

```bash
rg -n '<symbol>' --type ts
git log --oneline -S '<symbol>' -- <path>    # when it arrived, and in which PR
```

Rewriting an existing issue? Take what is live first, so the draft starts from the current
body:

```bash
gh issue view <n> --json title,body --jq .body > /tmp/issue-<n>-current.md
```

## 2. Turn every code reference into a permalink

A bare `path/to/file.ts` in an issue is dead the moment the line moves. Pin each one:

```bash
~/.claude/skills/draft-issue-description/permalink.sh client/component/constructor.tsx 22
~/.claude/skills/draft-issue-description/permalink.sh client/util/legacy-comment.ts 29-34
```

It resolves `origin/HEAD` to a full SHA and warns if the path does not exist at that ref.
Do this **before** writing the brief, and put the links in the brief: unlike a pull request
diff link, nothing here has to wait on a number that does not exist yet.

## 3. Write the brief

```bash
cp ~/.claude/skills/draft-issue-description/brief-template.md /tmp/brief-<slug>.md
```

Slots: `Title`, `Where this came from`, `What exists now`, `Why it needs doing`, `What we
think is true`, `Unknowns`, `Scope`, `Done is`, `Must appear`, `Notes`. A slot with nothing
real in it gets `None.`

Four carry the weight, and none of them can be read off the code:

| Slot | What belongs there |
| --- | --- |
| `Why it needs doing` | The concrete cost of leaving it. A wrong result a real user sees, a blocked migration, an endpoint nothing owns. "Tech debt" is not a reason. |
| `What we think is true` | The hypothesis, flagged as one, with what would falsify it. |
| `Unknowns` | What must be worked out before the work can be scoped. If the issue is really a question, this is the issue. |
| `Done is` | Criteria you would accept as finished. Write them as you want them to read. |

Keep the bullets terse. `codex` mirrors the register it is fed, so a clause per fact
produces a tight issue and a paragraph per bullet produces the analysis dump this skill
exists to avoid.

`Done is` criteria are about code and answers. A recorded decision counts. Updating a
tracking document or an inventory does not belong in the criteria, even when the work will
in fact update one.

## 4. Run codex

```bash
~/.claude/skills/draft-issue-description/build-prompt.sh /tmp/brief-<slug>.md ~/projects/drafts/issue-<slug>.md
```

It prints the prompt path and a manifest on stderr. There is no repo format document for
issues, so the format lives in `instructions.md` with a worked example; the manifest only
confirms the style guide was found.

```bash
codex exec - --sandbox workspace-write --add-dir ~/projects/drafts --skip-git-repo-check \
  --output-schema ~/.claude/skills/draft-issue-description/schema.json \
  --output-last-message /tmp/issue-description-result.json \
  < /tmp/issue-description-prompt.md > /tmp/issue-description-run.log 2>&1
```

Two plain commands, not a pipeline: a worktree-isolated session refuses compound commands it
cannot verify. If the result file is missing or `jq` cannot parse it, read the log.

## 5. Fact-check before showing it

```bash
jq -r '.title, "headings: \(.has_headings)"' /tmp/issue-description-result.json
jq -r '.done_is[] | "- \(.)"' /tmp/issue-description-result.json
jq -r 'if (.gaps|length)==0 then "(no gaps)" else .gaps[] | "gap: \(.)" end' /tmp/issue-description-result.json
jq -r 'if (.unused|length)==0 then "(all used)" else .unused[] | "unused: \(.)" end' /tmp/issue-description-result.json
grep -n '^#' ~/projects/drafts/issue-<slug>.md || echo "no headings, good"
```

`has_headings` must be false, and the `grep` is the check that matters because it does not
depend on `codex` reporting honestly. A heading means the format rule did not bind: fix the
brief or re-run rather than deleting headings by hand, or the next run reintroduces them.

Verify the permalinks mechanically. Every one is a claim about where code lives:

```bash
~/.claude/skills/draft-issue-description/check-links.sh ~/projects/drafts/issue-<slug>.md
```

It fails on a blob missing at its pinned SHA or a branch name where a SHA belongs, and warns
when an `#L` anchor lands on a line that does not mention the identifier the link text names.
That warning catches a link pointing a few lines off the symbol it claims, which reads as
correct and is not.

Then check the body against the code, not only against the brief. The brief can be wrong, and
`codex` can read the repo and still land a claim slightly off.

- **Overstated confidence.** A hypothesis promoted to a fact. This is the failure that costs
  someone a day.
- **Invented criteria.** A `Done is` bullet the brief did not set.
- **Dropped criteria.** One the brief did set.
- **Bare code references.** Any path or symbol that should have been a permalink.
- **Claims you can check in under a minute.** Check them. "Its only caller", "nothing else
  uses it", and "already converts back" are each one `rg` away.

Then decide where the fix goes. The test is not how big the error is. It is whether the
brief was right:

| What you found | Where the fix goes |
| --- | --- |
| Wording, a link repeated four times, a vague noun where the real identifier reads better, a dropped backtick | Edit the draft yourself. The brief was right and the prose slipped. |
| A wrong or missing fact, an invented or dropped criterion, a hypothesis written as fact, the wrong structure | Fix the brief and re-run. |

Editing the body to paper over a brief defect leaves the brief wrong, so the next run
reproduces it. That is the one case where a hand edit costs more than a re-run.

## 6. Show, then create

Relay the title, the body, the criteria, the gaps, and anything you flagged. Then wait. The
author verifies issue content before it is created.

```bash
gh issue create --repo <owner>/<repo> --title "<title>" --body-file ~/projects/drafts/issue-<slug>.md
```

Set the issue type afterwards. It is not a reliable default, and `gh` has no `--type` flag,
so it takes GraphQL:

```bash
gh api graphql -f query='query{repository(owner:"OWNER",name:"REPO"){issueTypes(first:20){nodes{id name}}}}'
gh api graphql -f query='mutation($issue:ID!,$type:ID!){updateIssue(input:{id:$issue,issueTypeId:$type}){issue{number issueType{name}}}}' \
  -f issue="$(gh issue view <n> --repo <owner>/<repo> --json id --jq .id)" -f type='<issue-type-id>'
```

Delete the draft from `~/projects/drafts/` once the issue exists. Leave the brief in `/tmp`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Headings in the body | An issue is prose, then optional bullets, then `**Done is:**`. `grep -n '^#'` before showing it. |
| An analysis dump filed as an issue | Two paragraphs and three criteria is a normal good issue. If the investigation is the deliverable, the issue is the question, not the findings. |
| Hypothesis written as fact | Keep "it looks like" in the brief and the body. Certainty the author does not have sends the assignee down the wrong path. |
| Bare paths and backticked symbols | Run `permalink.sh` first and put the links in the brief. A line number without a SHA is wrong within a week. |
| Criteria that cannot be checked | "Improve X" is not done-able. Name the observable state: the endpoint is gone, the answer is recorded, the reader sees Romansh. |
| Bookkeeping as a criterion | Updating an inventory or tracking doc is a consequence, not a criterion. |
| Paraphrasing the review comment that triggered it | Fetch it and quote the sentence. The reviewer's own words carry the intent. |
| Fact-checked only against the brief | The brief can be wrong. `check-links.sh` catches a permalink pointing near but not at its symbol; the "only caller" claims need an `rg`. |
| Creating the issue before the author has read it | The author verifies issue content first, every time. |
