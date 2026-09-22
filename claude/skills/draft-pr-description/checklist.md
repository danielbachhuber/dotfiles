# Before you write

Answer each question below from the diff, the history, and this session. A question with
nothing real behind it gets "None." Never a guess, never filler: an invented answer here
becomes an invented claim in the description.

Every answer carries its evidence: a path, a line, a number, a PR number, a command. Bare
adjectives are worthless.

## What changed

One line per file. Path, then what the diff does to it, then why that file needed touching.
Add `file.ext:LINE` when a specific line is the point.

## Why now

The product goal, and what triggered the work: an issue number, a budget alert, an incident,
a review comment.

## Prior state

How the code behaved before, and how it got that way. Cite the PRs that built it
(`git log -S`, `git log --follow`) so the reviewer can trace the evolution. This is the part
a thin description always skips, and the one reviewers most often say was useful.

## Measurements

Every number that will appear in the description. Distinguish measured from estimated. If a
figure is dominated by a few outliers, the description must carry that caveat.

Decide where each figure goes. A figure that is the case for the change belongs with the
prior state; a figure describing what the change achieves belongs with the result. A number
in the wrong section argues in the wrong place.

Know the method for each figure, in as few words as carry it. A figure a reviewer cannot
place is a figure they cannot trust.

## Decisions

Each choice made while building this, the alternative that was genuinely considered, and why
it lost. Include decisions the reviewer would otherwise ask about, and the ones you talked
yourself out of.

## Verified, not assumed

Things checked with a command or an API call rather than reasoned about: branch protection,
downstream consumers, whether a skipped job blocks a merge, whether a cache survives a flag.
Name the check. This is what stops a reviewer re-deriving your work.

## Out of scope

Deliberately excluded work, each with a pointer: an issue, a follow-up PR, or the reason it
is a separate decision.

## Testing

How the change was or should be verified. Exact commands. If the PR verifies itself through
CI, say how.

## Media

Before/after screenshots or screencasts, if any: the local path and the caption for each.
Know which is before and which is after; the labels are the whole argument. Note how a
recording was produced (an artificial delay, a reverted line) so the description can carry
that caveat.

## Uncertainties

What is estimated rather than measured, what could not be tested locally, what a reviewer
should be sceptical of.

## Corrections

A number you revised, a design you priced and rejected, an assumption that turned out wrong.
The rejected design and the wrong assumption belong under Decisions or Uncertainties. A
correction to your own earlier analysis stays out of the description entirely.
