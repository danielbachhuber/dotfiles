# Diff Viewed

Two things for bb's changes panel, both of which bb keeps only in memory:

1. A **Viewed** checkbox on every file. Checking one collapses the file, dims
   its header, and remembers it for that thread until the file's diff changes.
2. Persistence for the toolbar's **line wrap** and **stacked/split** settings,
   so a diff opens the way you last read one.

Collapse all is deliberately left alone — it is an action, not a setting.

## How it works

bb owns the diff card header. `experimental_diffRenderer` replaces a diff's
*body*, and the header's `statSlot` / `actionSlot` are internal, so the checkbox
cannot come from a normal plugin slot. It comes from a content script instead,
which is what the SDK sanctions for decorating existing app-shell DOM.

The script anchors only on things bb emits deliberately:

| Anchor | Used for |
| --- | --- |
| `[data-timeline-file-diff]` | Skipping timeline diffs |
| `aria-label="Collapse <path>"` | Reading each card's file path |
| `aria-expanded` | Reading and driving collapse |
| `[data-testid="git-diff-toolbar-actions"]` | Finding the toolbar, and knowing the changes panel is open |
| `aria-label="Wrap diff lines"` and `"Disable diff line wrap"` | The wrap button, whose label flips with its state |
| `aria-label="Stacked diff view"` / `"Split diff view"` | The view-mode pair |
| `aria-pressed` | Reading every toolbar control's state |

No minified class names. If bb changes the header and the anchors stop
matching, the plugin decorates nothing and bb behaves exactly as it does
without it.

There is deliberately no "card must be inside container X" check. bb's file
card list carries no attribute of its own, and `data-secondary-panel-tab-content`
— which reads like the right one — is the *tab strip's* inner container, not a
tab's content. Requiring it matched nothing on any screen. The structural checks
in `resolveCard` carry that weight instead: the collapse button must be the
first child of the header's left span, and the header row must have exactly two
children and `justify-between`.

`viewed/dom.test.ts` holds fixtures of the header and toolbar DOM as bb renders
them. After a bb upgrade, those are the tests that fail first; re-read
`GitDiffCardHeader-*.js` and `ThreadSecondaryPanel-*.js` in bb's
`app/dist/assets` and update the fixtures and `viewed/dom.ts` together.

## What a mark is keyed on

`threadId` + file path + a fingerprint of the diff. The fingerprint is the
`+N -M` count from the card header, which is the only per-file signal the header
DOM carries. So a rebase, new hunks, or a reverted file clears the mark; an edit
that adds and removes the same number of lines does not. Marks for files that
leave the diff are pruned when the panel next loads.

Marks live in the plugin's kv storage, so they survive a reload. Another window
picks up a change when it regains focus — realtime subscription is a React-side
API and a content script has no component to hang it on.

## Toolbar preferences

Wrap and view mode are stored once, globally: they are how you read a diff, not
facts about a thread.

They are restored by clicking bb's own buttons, because the state lives in React
and there is nothing else to set. That also settles a conflict — bb picks
stacked or split from the panel's width until you override it, and the click
*is* that override, so bb stops second-guessing the restored choice. Applying
once per toolbar mount is therefore enough.

"Never chosen" is stored distinctly from "stacked", which is what keeps bb's
width-driven default in charge until you actually pick something.

## Layout

| Path | Holds |
| --- | --- |
| `viewed/marks.ts` | Pure logic: keying, fingerprinting, record changes |
| `viewed/prefs.ts` | Pure logic: which toolbar buttons to click, and when to save |
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
