# Diff Viewed

Adds a **Viewed** checkbox to every file in bb's changes panel. Checking one
collapses the file, dims its header, and remembers it for that thread until the
file's diff changes.

Without it, the only way to track what you have already reviewed is to collapse
files by hand — and bb's collapse state is in-memory React state, so it resets
whenever the panel remounts.

## How it works

bb owns the diff card header. `experimental_diffRenderer` replaces a diff's
*body*, and the header's `statSlot` / `actionSlot` are internal, so the checkbox
cannot come from a normal plugin slot. It comes from a content script instead,
which is what the SDK sanctions for decorating existing app-shell DOM.

The script anchors only on things bb emits deliberately:

| Anchor | Used for |
| --- | --- |
| `[data-secondary-panel-tab-content]` | Scoping to the changes panel |
| `[data-timeline-file-diff]` | Skipping timeline diffs |
| `aria-label="Collapse <path>"` | Reading each card's file path |
| `aria-expanded` | Reading and driving collapse |

No minified class names. If bb changes the header and the anchors stop
matching, the plugin decorates nothing and bb behaves exactly as it does
without it.

`viewed/dom.test.ts` holds a fixture of the header DOM as bb renders it. After
a bb upgrade, that is the test that fails first; re-read
`GitDiffCardHeader-*.js` in bb's `app/dist/assets` and update the fixture and
`viewed/dom.ts` together.

## What a mark is keyed on

`threadId` + file path + a fingerprint of the diff. The fingerprint is the
`+N -M` count from the card header, which is the only per-file signal the header
DOM carries. So a rebase, new hunks, or a reverted file clears the mark; an edit
that adds and removes the same number of lines does not. Marks for files that
leave the diff are pruned when the panel next loads.

Marks live in the plugin's kv storage, so they survive a reload. Another window
picks up a change when it regains focus — realtime subscription is a React-side
API and a content script has no component to hang it on.

## Layout

| Path | Holds |
| --- | --- |
| `viewed/marks.ts` | Pure logic: keying, fingerprinting, record changes |
| `viewed/dom.ts` | Reading and decorating bb's card headers |
| `server.ts` | RPC contract and kv storage boundary |
| `app.tsx` | The content script: sync loop, observers, cleanup |

## Development

```sh
npm install
npm test
npm run typecheck
bb plugin build && bb plugin reload diff-viewed
```

The RPC surface against a running server:

```sh
BASE=$(node -p "require(process.env.HOME+'/.bb/bb-app-runtime.json').serverUrl")
curl -s -X POST -H "content-type: application/json" -H "origin: $BASE" \
  -d '{"threadId":"thr_x"}' "$BASE/api/v1/plugins/diff-viewed/rpc/viewed_list"
```
