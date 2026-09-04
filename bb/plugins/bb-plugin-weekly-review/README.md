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

**Where the time went** — one section per Harvest category, most hours first,
with every entry underneath it: each meeting and how long it ran, each stretch
of development and which issue it was against. A meeting carries the notes
someone took in it, lifted out of whichever reference doc holds them.

**Standing context** — everything without one: completed tasks (Todoist exposes
no completion timestamp, so they sit at week level), issues assigned to you with
the ones untouched for 30 days flagged, the near-term backlog, and links to the
reference docs.

A footer reports the status of every source. A source that fails is recorded and
rendered as not gathered, rather than crashing the run — a broken credential
should never read as a quiet week.

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
| Todoist incomplete | `td task list` | no — backlog |
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

## The interpretation step

Everything above is deterministic and runs without a model. Grouping forty
pull request titles into three bodies of work is not, so that is a separate
step with its own button.

Pressing **Interpret** hands the gathered week to an agent in a spawned thread:
the whole digest, inline, with an editable prompt around it. The agent writes
JSON and records it with `bb weekly-review interpret <monday> --file <path>`,
which validates it against a schema and puts it on the page. A failed
validation reports what was wrong in a form the agent can act on and try again.

The result lands beside the week as `overview.json`. Delete that file and the
deterministic page is exactly what it was.

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
bb weekly-review prompt [interpret|notes] [reset]
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
