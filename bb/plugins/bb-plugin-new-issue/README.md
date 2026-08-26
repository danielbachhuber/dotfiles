# bb-plugin-new-issue

Adds a **New issue** row to the BB sidebar. The page it opens asks for a
project and a few lines about what the issue should cover, then spawns a
thread that runs the `draft-issue-description` skill against that project's
repo and opens it.

The plugin only writes the brief. The skill owns the rest: gathering the
triggering comment, pinning code references to permalinks, drafting to
`~/projects/drafts/`, and waiting for you to verify before anything is filed.

## The form

The page renders BB's own `experimental_NewThreadComposer` — the same compose
surface as the New thread screen — rather than a hand-rolled textarea. That
brings @-mentions, attachments, voice, the provider/model/reasoning picker, the
environment and branch-from pickers, permission mode, and draft persistence,
and it resolves the project's remembered execution defaults natively.

On submit the composer hands back a `NewThreadRequest`, which the backend
forwards to `threads.spawn` verbatim after prepending the
`draft-issue-description` instruction as a leading prompt item. The user's own
text, mentions, and attachments reach the agent exactly as composed.

`draft-issue-description` is a user-level Claude Code skill at
`~/.claude/skills/draft-issue-description/`, so a thread on any other provider
cannot resolve it by name. The composer owns the provider choice, so the page
says so in its intro copy rather than warning after the fact.

## The "Create issue" button

Once a thread has drafted an issue, `draft-issue-description` waits for you to
confirm before it files anything. The button sends that confirmation for you,
so you do not have to type it. The composer is untouched — use it whenever you
want to suggest changes to the draft instead.

It renders in two places: the composer action row (hidden by BB in the
compact/mobile layout) and the thread header action row. Both appear only in
threads this plugin spawned, matched on `originPluginId`; the send RPC
re-checks that server-side, so the plugin cannot post into a thread it did not
start.

## Development

```sh
npm install
npm run typecheck
npm test
bb plugin install .   # once
bb plugin dev         # rebuild + reload on save
```

## Layout

- `server.ts` — three RPC methods: `issue_thread_create` (forwards the
  composer's request to `bb.sdk.threads.spawn`), plus `thread_is_ours` and
  `issue_create_send` behind the Create issue button. `ISSUE_INSTRUCTION`,
  `extractNotes`, and `deriveTitle` are exported so they can be tested
  directly.
- `app.tsx` — the `navPanel` registration wrapping `NewThreadComposer`, plus
  the composer customization and thread-header action sharing one
  `useCreateIssue` hook.
- `components/ui/` — vendored shadcn source. Yours to edit; add more with
  `npx shadcn add @bb/<name>`.
