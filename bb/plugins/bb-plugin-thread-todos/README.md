# bb-plugin-thread-todos

A shared per-thread checklist. The agent lays out its steps as it plans and
checks them off as they land; you add and check items too. The point is to see
what a thread still owes you without reading its transcript.

## Surfaces

- **Thread header** — a live `2/6` progress count, finished over total, or
  "Add todo" on a thread with no list yet. Either way it opens the panel.
  Hiding the control on an empty list kept the header clean but left no way
  in, so a thread with no list stayed that way.
- **Panel tab** — "Todo" in bb's thread panel, beside Browser and Terminal.
  The add field sits at the top; check, uncheck, add, remove, and clear the
  finished items below it.
- **Sidebar glyph** — written, but **inert on every shipped bb**. See below.

## The sidebar glyph does not work yet

A content script decorates each thread row with a `ListTodo` glyph labelled
"3 steps remaining", clearing it once nothing is open. It is feature-detected
and currently always detects absent, because no released bb implements the
API. Checked against the app bundles directly:

| Surface | 0.40.0 | 0.41.0 |
| --- | --- | --- |
| `setThreadRowStatus` | 0 | 0 |
| `contentScripts` | 0 | 0 |
| `experimental_threadList` | 0 | 0 |

Those are occurrence counts in `app/dist/assets/index-*.js`. Slot names are
preserved through minification — `threadPanelAction` appears in both — so the
zeros are real absence, not mangling. The SDK's type declarations (0.4.21)
carry all three and mark `setThreadRowStatus` optional precisely because it is
still rolling out.

Nothing to do about it here. The code stays, feature-detected, and starts
working the day a bb release ships the API. It logs to the console when it
detects the API missing, so an inert decorator is never mistaken for a broken
one. If you want a sidebar signal before then, the buildable route is a
`navPanel` with an `experimental_sidebarAccessory` count — the pattern
`pr-sweep` uses — which shows totals across threads rather than per row.

## The list is append-only

The agent has `todo_add`, `todo_complete`, and `todo_reopen`. It has nothing
that deletes or rewrites an item. That is the whole reason your own items are
safe: a stale plan restated on a later turn cannot wipe what you added.

Superseded work is completed, not removed — early steps overtaken by later ones
are expected and fine. Deletion is a panel affordance only, where a human is
looking at the row they are deleting.

`todo_add` skips anything already open on the thread, matching case- and
punctuation-insensitively, and says how many it actually created. Without that,
an agent restating its plan each turn would double the list.

## Scope

Tools and instructions are contributed to **every** thread. Which threads
sprawl is not knowable in advance, and a list that exists only where you
remembered to ask for it is not one you can trust to be complete.

Both resolve at `thread.start` / `turn.submit`, so a thread that was already
running when this plugin loaded does not see them until it restarts.

## Layout

- `todos/list.ts` — the pure core: normalizing, deduping, resolving the loose
  references a model passes, ordering, and deriving every label. No database,
  no clock, no bb API.
- `todos/store.ts` — the only module that touches SQLite. Reads rows, calls
  into `list.ts`, applies the answer.
- `todos/contract.ts` — the RPC wire schema. A field missing here is dropped by
  the server and the panel renders without it.
- `todos/cli.ts` — argv parsing for `bb todo`, pure so the grammar is testable
  without a server.
- `todos/instructions.ts` — what every thread is told about its list.
- `server.ts` — tools, RPC handlers, realtime, thread-lifecycle cleanup.
- `app.tsx` — the panel, the header count, and the content script that paints
  the sidebar.

## Why the sidebar decorator polls

`setThreadRowStatus` exists only on the content-script context, and a content
script is not a React component, so there is no hook context to subscribe to
the realtime channel from. It polls `todos_counts` every 5 seconds while the
window is visible and stands down while it is hidden. The read is one grouped
count over a small local table.

The panel and the header button do subscribe, through `useRealtime`, so the
thread you are looking at updates immediately.

## Working on it

```sh
npm install
npm test
npm run typecheck
bb plugin build && bb plugin reload thread-todos
bb plugin logs thread-todos -f
```

Unit tests cover the pure core and the store against an in-memory database.
They do not prove the tools registered — that needs a live thread, since tool
registration only shows up when a provider session starts.
