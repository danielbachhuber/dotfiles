# Weekly Review

A BB nav panel that puts one week of work on one page, so the weekly journal
entry can be written from evidence rather than from memory.

It does not write the entry. It gathers what happened and gets out of the way.

## The page

Sources split into two kinds, and the page follows.

**The week spine** — everything with a date, one section per day: that day's
time entries, pull requests opened and merged, reviews, issues filed, Slack
threads, and daily notes. A pull request opened Monday and merged Thursday
appears on both days; opened and merged the same day collapses to one row.

**Where the time went** — the body of the page, opening with every theme and
its hours on one list, then each theme in full. Grouped by what the work was
about rather than by how it was booked. One-on-ones, Open Source Roadmap,
Phase 3 review, Code review, and an Everything else for the tail. Under each
theme the days it happened on, and under each day how long, what kind of time
it was booked as, what it was, and the notes taken in it.

The grouping is read out of the entries themselves and needs no model. An entry
naming an issue takes that item's title; one reading `<something> w/ <person>`
takes the something, unless that something is just a word for a meeting, in
which case it is a one-on-one. Themes sharing a run of significant words then
merge, which is what puts "Architecture Talk", "Architecture Talk Prep" and
"Prep Architecture Talk" together across three different Harvest categories.
Grouped hours and the tail add up to the week's total exactly.

## Meeting notes

Two sources sit under a meeting: the day's own notes, and the reference doc
that covers it. Both can appear on the same row.

Daily notes are MCP-only, so a script cannot reach them. **Collect notes**
sends an agent, which pulls each day in the range, splits it into one entry per
meeting — a daily note is already written that way, a top-level bullet per
conversation — and records them with `bb weekly-review notes`.

Matching is deterministic first. `Open Source Roadmap w/ Marius` and
`Open Source Roadmap w/ Marius Scheffel` are the same conversation and the page
sees that itself. When the two records disagree entirely — logged as
`Phase 3 review`, written up as `PSI deadline check-in` — the agent sets
`meeting` to the time entry verbatim, and that wins over any rule.
`bb weekly-review meetings <monday>` prints the week's entries and flags the
ones nothing has matched, which is the list the agent is sent to resolve.

The reference docs are mostly running 1:1 documents — one per person, newest
entry first, each under a `## August 31st` heading. A time entry reading
`1:1 w/ Rob` on that day is that meeting, so its section is what was discussed,
and the page shows it inline.

Two rules decide the match, both strict. A doc whose label appears in the entry
is that meeting. Otherwise a doc about one person matches an entry naming that
person — but only when the entry reads like a meeting. `1:1 w/ Brendan` and
`Review Brendan's project plan` both name Brendan; attaching a 1:1's notes to
the second would read as a record of a conversation that never happened.

Notes are routinely written up a day either side of the meeting, so the nearest
dated section within three days wins. The doc and its heading are shown with
the text rather than hidden behind it, so a near match reads as what it is.

## Sources

| Source | How | Day-attributable |
|---|---|---|
| Harvest time entries | `hrvst` | yes, `spent_date` |
| PRs authored | `gh search prs` (created ∪ merged) | yes |
| PRs reviewed | `gh search prs --reviewed-by` | approximately, via `updatedAt` |
| Issues created | `gh search issues` | yes |
| Issues assigned | `gh search issues --assignee` | no — current snapshot |
| Todoist completed | `td completed list` | no |
| Todoist incomplete | `td task list` | no — overdue and near-term reach the digest |
| Reference docs | a script that prints a Google Doc as text | no |
| Slack | by hand | yes |
| Daily notes | agent step, over MCP | yes |

## Two kinds of state, kept apart

**Sources — the database.** What a week is gathered from identifies a person:
a repository, a username, a Harvest project, a list of 1:1 documents. It lives
in the plugin's own SQLite database, which bb keeps under
`<dataDir>/plugins/weekly-review/` — never committed, and deleted with the
plugin. Edit it on this plugin's page in Tools, or from the CLI:

```sh
bb weekly-review source list
bb weekly-review source set repo octocat/acme-widgets
bb weekly-review source set author octocat
bb weekly-review source set harvestProjectId 12345678
bb weekly-review source add-doc 1AbCdEf... Annual goals
bb weekly-review source remove-doc "Annual goals"
```

**Weeks — files.** A gathered week is a JSON blob on disk (see Storage below),
where an agent can read it without going through this plugin.

**Settings — paths only.** `bb plugin config weekly-review` holds where `gh`,
`hrvst`, `td`, and the Google Doc script are, plus where weeks are written. A
path is not a fact about anyone, so those are safe as declarative settings.

## The entry, and feedback on it

The weekly entry is written by hand, in a Google Doc, and stays that way. This
plugin reads that document and never writes to it. The whole point of the
feedback step is that it does not have to.

Set the doc with `bb weekly-review source set journalDocId <id>`. The entry for
a week is the last dated section falling inside it — the doc uses the same
`## September 4, 2026` headings the 1:1 documents do — and it is read fresh
every time the page loads, because the entry is written after the week is
gathered and a copy taken at gather time would always be the empty template.

**Check my entry** sends an agent the entry as written and the week's digest,
and asks two questions: what happened that the entry does not mention, and
where does the entry say something the evidence says more about. The second is
where the value is — a line reading "worked on feature toggles" is true, and
the digest knows it took 3.3 hours across three days and closed four issues.

**Check my entry** opens the thread it started. The assessment is a
conversation to have while the entry is being rewritten, not a report to
receive: ask which findings matter, push back, ask for the evidence behind a
line. The agent re-reads the document before answering anything that depends on
what it currently says, and records a fresh assessment when enough has changed
to warrant one. The page keeps a link back to that thread.

It proposes no replacement prose, and never edits the document. Feedback lands
beside the week as `feedback.json`, stamped with the heading of the entry it
was given on, so feedback on a draft you have since rewritten shows as stale
rather than quietly wrong.

```sh
bb weekly-review entry <monday>                          # what the agent will read
bb weekly-review feedback <monday> --file <path-to-json>  # how it records the result
```

## The interpretation step

Everything above is deterministic and runs without a model, including the
grouping. What is left for an agent is the part evidence cannot supply for
itself: what kind of week this was, and where the time should go next.

Pressing **Interpret** hands the gathered week to an agent in a spawned thread:
the whole digest, inline, with an editable prompt around it. The agent writes
JSON and records it with `bb weekly-review interpret <monday> --file <path>`,
which validates it against a schema and puts it on the page. A failed
validation reports what was wrong in a form the agent can act on and try again.

The result lands beside the week as `overview.json`. Delete that file and the
page loses a summary and a list of what to do next, and nothing else.

The prompt is editable on this plugin's page in Tools, or with
`bb weekly-review prompt reset` to restore the default. `{{DIGEST}}` and
`{{COMMAND}}` are substituted before the thread is spawned. Read what the agent
will see with `bb weekly-review digest <monday>`.

## Slack

Slack is reachable over MCP rather than from a script and has no gathering step
yet. Drop `slack.json` into the week's directory by hand and it will be read:

```json
[{ "day": "2026-08-31", "channel": "standup",
   "summary": "…", "permalink": "https://…" }]
```

## CLI

```
bb weekly-review list
bb weekly-review generate [<monday>|--from YYYY-MM-DD --to YYYY-MM-DD]
bb weekly-review path [<monday>]
bb weekly-review digest <monday>
bb weekly-review interpret <monday> --file <path-to-json>
bb weekly-review meetings <monday>
bb weekly-review notes <monday> --file <path-to-json>
bb weekly-review entry <monday>
bb weekly-review feedback <monday> --file <path-to-json>
bb weekly-review prompt [interpret|notes|feedback] [reset]
bb weekly-review source list | set <key> <value> | add-doc <id> <label> | remove-doc <id|label>
```

Weeks are identified by their Monday, which is also the directory name.
`generate` with no argument does the current week, Monday through today.

## Storage

`data/weeks/<monday>/`, gitignored, alongside the plugin:

```
data/weeks/2026-08-31/
  week.json        everything the gather produced
  overview.json    the agent's reading of the week (optional)
  feedback.json    the agent's read of your written entry (optional)
  docs/*.txt       cached text of the reference docs
  reflect.json     written by the agent step (optional)
  slack.json       written by the agent step (optional)
```

Files rather than rows, so an agent can read a week without going through this
plugin, and so a bad parse costs one week rather than the store. Gitignored, and
set the `weeksDir` setting to put them somewhere else entirely. The source
definitions that decide what a week contains are the opposite case — small, and
personally identifying — so they go in the database instead.

## Development

```sh
npm install
npx tsc --noEmit
bb plugin build . && bb plugin reload weekly-review
```

`review/` holds the logic and is deliberately free of BB: pure date and
bucketing functions, one fetcher per source that shells out to a CLI, the
file-backed week store, and the database-backed source store. `server.ts` wires
them together; `app.tsx` draws the panel and the sources editor.
