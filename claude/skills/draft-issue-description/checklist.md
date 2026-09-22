# Before you write

Answer each question below. A question with nothing real behind it gets "None." Never a
guess, never filler. Every code reference is a SHA-pinned permalink from `permalink.sh`, not
a bare path.

## Title

One line. Favour the honest shape of the work: "Figure out how to retire X", "See whether X
can be removed", or a plain statement of the defect. Not a command dressed up as a plan.

## Where this came from

The trigger, with a link: a review comment, a Slack thread, an incident, something noticed
while doing other work. Quote the relevant sentence rather than paraphrasing it, and name
who raised it.

## What exists now

The current code, as fact, with a permalink per symbol. Who calls what, what reads what,
what the only remaining caller is. This is the part a reader needs before the argument makes
sense.

## Why it needs doing

The cost of leaving it alone. Be concrete: a wrong result for a real user, a blocked
migration, an endpoint nothing owns. "Tech debt" is not a reason.

## What we think is true

The hypothesis, flagged as one. Most issues here are investigations, so the honest framing
is "it looks like X, because Y" rather than "X". Say what would falsify it.

## Unknowns

What has to be worked out before the work can be scoped or finished. An issue that is
really a question should read like one.

## Scope

Bounds worth stating: what is deliberately included, what is deliberately not, related work
that stays separate and where it is tracked.

## Done is

Concrete, verifiable completion criteria, one per line.

Criteria are about code and answers, not bookkeeping. A recorded decision counts. Updating a
tracking doc or inventory does not belong here.
