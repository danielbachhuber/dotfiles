# Task

Write a pull request description from the brief below, and save it to the output path named
at the end of this task.

The brief is your primary source, and it should be complete enough to write from directly.
You may read files in the repository to confirm a path, check a surrounding function, or
resolve an ambiguity. Do that sparingly and report it: needing to go looking means the
brief had a gap, and naming the gap is more useful to the author than quietly filling it.

What you cannot see is the conversation that produced this change. Decisions, rejected
alternatives, measurements and their caveats exist only in the brief. Do not infer them
from the code.

## What to do

1. Write the description as markdown to the output path. That file is the deliverable.
2. Return JSON matching the supplied schema.

**Write exactly one file, at the output path.** The repository is writable in this sandbox
so that you can reach the drafts directory. Do not create, edit, or delete anything else,
and do not run `git` commands that change state.

## What the JSON carries

- `title` — a Conventional Commits title, `type(scope): subject`. Imperative, no trailing
  period. Take the brief's title if it is already well formed; tighten it if not.
- `draft_path` — the absolute path you wrote, which must equal the output path given.
- `outline` — the headings you wrote, in order.
- `unused` — brief facts you deliberately left out, one line each, with the reason. This
  lets the author check that nothing load-bearing was dropped.
- `gaps` — what the brief did not say that the description needed, including anything you
  had to read the repository to resolve. Be specific: "no before/after number for the lint
  job", not "more detail on performance".

## How to write the body

Follow the target format supplied above this task, and the author's house style. Where the
format document and these notes disagree, the format document wins.

Front-load. A reviewer should be able to stop reading as soon as they have what they need:
the goal, then the approach, then the detail. Put the detail a reviewer opens on demand
inside `<details>` expanders.

Use the brief's own numbers, paths, and PR references. A description that could be pasted
onto a different pull request says nothing about this one.

Every fact under `Must appear` in the brief has to be in the body. Those are the author's
non-negotiables, usually the totals that frame the change. Never move one to `unused`.

Carry every caveat the brief records. If a figure rests on three outlier branches, the
description says so where the figure appears, not in a footnote. If something was
estimated rather than measured, the word "estimated" appears.

Claim only what the brief supports, or what you confirmed by reading the code. Never write
that the change fixes, removes, or resolves something unless the brief says it does. If the
work is partial, say what is left.

Name changed files by their repo-relative path in backticks. Do not build links to the
diff: the pull request number usually does not exist yet, and the author inserts those
afterwards. A missing pull request number is not a gap, so do not report it as one.

Prefer prose to bullet fragments for anything explanatory. Reserve bullets for genuine
lists: affected files, alternatives, out-of-scope items.

Scale to the diff. A two-file change gets a short body and no expanders. Sections with
nothing real to say are omitted, not padded.

The file holds raw markdown, ready to post: no wrapping code fence, no preamble, no
closing summary.
