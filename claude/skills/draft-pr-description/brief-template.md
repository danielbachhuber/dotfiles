# Brief: <conventional-commits title>

<!--
Fill every slot. A slot with nothing real in it gets the line "None." — never a guess,
never filler. `codex` has no access to this repo, this diff, or the conversation that
produced the change, so anything absent from this brief cannot appear in the description.

Bullets throughout. Every claim carries its evidence: a path, a line, a number, a PR
number, a command. Bare adjectives are worthless here.

Write the bullets tersely. `codex` mirrors the register it is fed, so a brief of long
compound sentences produces a description of long compound sentences. Aim for a clause per
fact, not a paragraph per bullet. Terse does not mean fewer facts: cut words, keep
substance.
-->

## What changed

<!-- One bullet per file. Path, then what the diff does to it, then why that file needed
touching. Add `file.ext:LINE` when a specific line is the point. -->

-

## Why now

<!-- The product goal, and what triggered the work: an issue number, a budget alert, an
incident, a review comment. One or two bullets. -->

-

## Prior state

<!-- How the code behaved before, and how it got that way. Cite the PRs that built it
(`git log -S`, `git log --follow`) so the reviewer can trace the evolution. This is the
section a thin brief always skips, and the one reviewers most often say was useful. -->

-

## Measurements

<!-- Every number that will appear in the description. Distinguish measured from estimated.
If a figure is dominated by a few outliers, say so here: the description must carry that
caveat.

Method belongs here too, in as few words as carry it. Keep it short rather than keep it out:
a figure a reviewer cannot place is a figure they cannot trust.

Prefix a bullet `(background)` only to keep it out of the description entirely. The case
that always earns it is a correction to your own earlier analysis. A number you got wrong
and fixed is what makes this brief trustworthy, and has no place in a pull request body. -->

-

## Decisions

<!-- Each choice made while building this, the alternative that was genuinely considered,
and why it lost. Include decisions the reviewer would otherwise ask about. -->

-

## Verified, not assumed

<!-- Things checked with a command or an API call rather than reasoned about: branch
protection, downstream consumers, whether a skipped job blocks a merge, whether a cache
survives a flag. Name the check. This is what stops a reviewer re-deriving your work. -->

-

## Out of scope

<!-- Deliberately excluded work, each with a pointer: an issue, a follow-up PR, or the
reason it is a separate decision. -->

-

## Testing

<!-- How the change was or should be verified. Exact commands. If the PR verifies itself
through CI, say how. -->

-

## Must appear

<!-- Facts that have to survive into the description, one per line, verbatim if the wording
matters. Use this for the numbers that frame the change: totals, shares, before-and-after.
`codex` weighs relevance and will drop a figure it judges redundant, and its `unused` list
is where you find out. Anything listed here it keeps. Keep the list short, or it stops
meaning anything. -->

-

## Uncertainties

<!-- What is estimated rather than measured, what could not be tested locally, what a
reviewer should be sceptical of. Empty only when genuinely empty. -->

-
