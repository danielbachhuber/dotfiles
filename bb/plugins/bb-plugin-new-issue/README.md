# bb-plugin-new-issue

Adds a **New issue** row to the BB sidebar. The page it opens asks for a
project and a few lines about what the issue should cover, then spawns a
thread that runs the `draft-issue-description` skill against that project's
repo and opens it.

The plugin only writes the brief. The skill owns the rest: gathering the
triggering comment, pinning code references to permalinks, drafting to
`~/projects/drafts/`, and waiting for you to verify before anything is filed.

## Agent selection

The form embeds BB's own `experimental_ProviderModelPicker`, so the catalog,
defaults, and capability reconciliation match every other composer in the app.
It opens on the selected project's remembered execution options
(`projects.defaultExecutionOptions`), and re-seeds when you switch projects.
When a project has none saved, it falls back to Claude Code's default model,
or the first available provider's if Claude Code is not installed.

`draft-issue-description` is a user-level Claude Code skill at
`~/.claude/skills/draft-issue-description/`, so a thread on any other provider
cannot resolve it by name. The picker still lets you choose one — the form
warns instead of blocking, and the selection is forwarded to `threads.spawn`
unchanged.

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

- `server.ts` — five RPC methods: `projects_list`, `execution_defaults`, and
  `issue_thread_create` (which calls `bb.sdk.threads.spawn` with the project's
  default environment and the picker's selection), plus `thread_is_ours` and
  `issue_create_send` behind the Create issue button. `deriveTitle` and
  `buildPrompt` are exported so they can be tested directly.
- `app.tsx` — the `navPanel` registration and the form, plus the composer
  customization and thread-header action sharing one `useCreateIssue` hook.
- `components/ui/` — vendored shadcn source. Yours to edit; add more with
  `npx shadcn add @bb/<name>`.
