---
name: draft-issue-description
description: Use when a GitHub issue needs drafting or rewriting — filing follow-up work a reviewer flagged as out of scope, turning something noticed mid-task into a tracked issue, or tightening an issue body that reads as an analysis dump.
argument-hint: [issue-number-or-topic]
---

# Draft issue description

You write the issue from what this session knows. The current state of the code is the
easy half of an issue.

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
Do this **before** writing: unlike a pull request diff link, nothing here has to wait on a
number that does not exist yet.

## 3. Work through the checklist

Read `checklist.md` in this skill's directory and answer each question. You do not need to
write the answers to a file. Four carry the weight, and none of them can be read off the
code:

| Question | What belongs there |
| --- | --- |
| `Why it needs doing` | The concrete cost of leaving it. A wrong result a real user sees, a blocked migration, an endpoint nothing owns. "Tech debt" is not a reason. |
| `What we think is true` | The hypothesis, flagged as one, with what would falsify it. |
| `Unknowns` | What must be worked out before the work can be scoped. If the issue is really a question, this is the issue. |
| `Done is` | Criteria you would accept as finished. |

`Done is` criteria are about code and answers. A recorded decision counts. Updating a
tracking document or an inventory does not belong in the criteria, even when the work will
in fact update one.

## 4. Write the draft

Read `writing.md` in this skill's directory, then write the body to
`~/projects/drafts/issue-<slug>.md`. Settle the title at the same time.

## 5. Fact-check before showing it

```bash
grep -n '^#' ~/projects/drafts/issue-<slug>.md || echo "no headings, good"
```

A heading means the body is in the wrong shape. Rework that part into prose or bullets.

Verify the permalinks mechanically. Every one is a claim about where code lives:

```bash
~/.claude/skills/draft-issue-description/check-links.sh ~/projects/drafts/issue-<slug>.md
```

It fails on a blob missing at its pinned SHA or a branch name where a SHA belongs, and warns
when an `#L` anchor lands on a line that does not mention the identifier the link text names.
That warning catches a link pointing a few lines off the symbol it claims, which reads as
correct and is not.

Then check the body against the code, not against your memory of the session.

- **Overstated confidence.** A hypothesis promoted to a fact. This is the failure that costs
  someone a day.
- **Criteria that drifted.** A `Done is` bullet that is not one of your checklist answers,
  or an answer that did not make it in.
- **Bare code references.** Any path or symbol that should have been a permalink.
- **Claims you can check in under a minute.** Check them. "Its only caller", "nothing else
  uses it", and "already converts back" are each one `rg` away.

## 6. Show, then create

Relay the title, the body, the criteria, and anything you flagged. Then wait. The
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

Delete the draft from `~/projects/drafts/` once the issue exists.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Headings in the body | An issue is prose, then optional bullets, then `**Done is:**`. `grep -n '^#'` before showing it. |
| An analysis dump filed as an issue | Two paragraphs and three criteria is a normal good issue. If the investigation is the deliverable, the issue is the question, not the findings. |
| Hypothesis written as fact | Keep "it looks like" in the body. Certainty the author does not have sends the assignee down the wrong path. |
| Bare paths and backticked symbols | Run `permalink.sh` before writing. A line number without a SHA is wrong within a week. |
| Criteria that cannot be checked | "Improve X" is not done-able. Name the observable state: the endpoint is gone, the answer is recorded, the reader sees Romansh. |
| Bookkeeping as a criterion | Updating an inventory or tracking doc is a consequence, not a criterion. |
| Paraphrasing the review comment that triggered it | Fetch it and quote the sentence. The reviewer's own words carry the intent. |
| Fact-checked from memory | `check-links.sh` catches a permalink pointing near but not at its symbol; the "only caller" claims need an `rg`. |
| Creating the issue before the author has read it | The author verifies issue content first, every time. |
