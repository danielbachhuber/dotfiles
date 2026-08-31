# Todoist

Captured with [`td`](https://github.com/Doist/todoist-cli), which is installed
from `../npm-globals.txt`.

```sh
td project list
td filter list
td label list
td task list --filter "recurring"
```

Sanitised: see [README.md](README.md). Project and task identifiers are omitted
because they are account-specific, and every personal name is a placeholder.

## Projects

Seven, flat. No sections in any of them, and no labels defined at all, so the
structure carries no weight; the filters and the recurring cadence do.

| Project | Placeholder for |
| --- | --- |
| Inbox | Todoist's built-in inbox. |
| Eng Team | Direct reports and team operations. |
| Open Source | Community-facing work. |
| Code | Hands-on engineering. |
| OS Roadmap | Open source planning. |
| Acme Port | A named migration project. |
| Org Team | Organisation-level team work. |

## Filters

These contain nothing personal and are recorded verbatim. `Now` is the one
worth keeping; the rest are close to Todoist's defaults.

| Filter | Query |
| --- | --- |
| Now | `overdue \| today \| tomorrow \| ((p1 \| p2 \| p3) & no date & ( no deadline \| deadline before: 15 days)) \| #inbox` |
| Upcoming | `due after: 0 day` |
| Assigned to me | `assigned to: me` |
| Priority 1 | `priority 1` |
| Anytime | `no date` |

`Now` is the interesting one: it surfaces anything overdue, due today or
tomorrow, plus prioritised work that has no date and either no deadline or a
deadline inside fifteen days, plus the inbox. It answers "what should I be
looking at" without depending on having dated everything.

## Recurring tasks

Thirteen, and they are the real system here. The recurrence strings are
Todoist's natural-language syntax and are reproduced exactly, since that
syntax is the reusable part.

### Per direct report

Three reports, each with the same weekly pair. This is the bulk of the
recurring load and scales with headcount rather than being written once.

| Task | Priority | Recurrence |
| --- | --- | --- |
| Prepare `<report>` 1:1 topics and give them a heads up | p2 | `every tues at 12 pm`, `every mon at 8 am`, `every mon at 12 pm` |
| Review `<report>` weekly priorities | p2 | `every mon at 8 am` (all three) |

The 1:1 prep is staggered per person to sit before each meeting, while the
priorities review is batched into a single Monday morning block.

### Eng Team

| Task | Priority | Recurrence |
| --- | --- | --- |
| Schedule next four weeks of deploys | p1 | `every 4 weeks monday` |

### Org Team

| Task | Priority | Recurrence |
| --- | --- | --- |
| Capture Done for the week, and identify Up Next based on goals and priorities | p1 | `every friday` |
| Give `<person>` a heads up on discussion topics | p2 | `every other monday at 9 am` |
| Give `<person>` a heads up on discussion topics | p2 | `every tuesday at 9 am` |

The Friday capture is the input to the weekly review.

### Open Source

| Task | Priority | Recurrence |
| --- | --- | --- |
| Call for Architecture Talk agenda items | p1 | `every tues at 8 am` |
| Publish a poll to coordinate next round of releases | p2 | `every 5 mon` |

### Code

| Task | Priority | Recurrence |
| --- | --- | --- |
| Refresh `<project>` API design doc | p2 | `every monday` |

## Notes

Only p1 and p2 are in use across every recurring task. Nothing recurring is
p3 or p4.

`td settings view` currently fails: the API returns a number for
`user.features.karmaDisabled` where the CLI's schema expects a boolean, so it
exits with a validation error rather than printing settings. Account-level
preferences are therefore not captured here.
