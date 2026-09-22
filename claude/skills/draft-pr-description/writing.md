# Writing the description

Follow the repo's format document and template if it has them, and the house style in the
`## Writing` section of `~/.claude/CLAUDE.md`. Where the format document and these notes
disagree, the format document wins.

With no format document, use these sections, omitting any with nothing real to say: Summary,
Background, Approach, Changes, Decisions, Testing. With a template, use its headings, and
omit a section rather than padding it.

## The title

A Conventional Commits title, `type(scope): subject`. Imperative, no trailing period.

## The body

Front-load. A reviewer should be able to stop reading as soon as they have what they need:
the goal, then the approach, then the detail. Put the detail a reviewer opens on demand
inside `<details>` expanders.

Use the session's own numbers, paths, and PR references. A description that could be pasted
onto a different pull request says nothing about this one.

Give a figure the provenance it needs to be believed, and give it one clause. "Measured from
draft-state timeline events rather than the current draft flag" earns its place; a sentence
reciting sample sizes, API limits and query shape does not.

Never mention a correction to an earlier analysis.

Carry every caveat. If a figure rests on three outlier branches, the description says so
where the figure appears, not in a footnote. If something was estimated rather than
measured, the word "estimated" appears.

Claim only what you verified. Never write that the change fixes, removes, or resolves
something unless it does. If the work is partial, say what is left.

When there are before/after screenshots or screencasts, lay them out as a two-column
markdown table with `Before` and `After` as the headers, one media reference per column, and
a one-line caption row beneath. Never a stack of labelled paragraphs. Use local file
references, each in its own cell: images as `![alt](./name.png)`, videos as
`<video src="./name.mp4" controls></video>`. Those get replaced with uploaded asset URLs
when the PR is created or edited.

Name changed files by their repo-relative path in backticks. Diff links wait until the pull
request number exists.

Prefer prose to bullet fragments for anything explanatory. Reserve bullets for genuine
lists: affected files, alternatives, out-of-scope items.

Say each thing once, in as few words as carry it. The checklist answers are written to be
complete, not to be published: expect to state their facts in a fraction of the words. A
sentence that needs three subordinate clauses is two sentences. Never pad a section to look
substantial.

Scale to the diff. A two-file change gets a short body and no expanders.

The file holds raw markdown, ready to post: no wrapping code fence, no preamble, no title
line, no closing summary.
