# bb

Configuration for [bb](https://getbb.app), the agentic IDE.

## ⚠️ This repository is public

`danielbachhuber/dotfiles` is a public GitHub repository. Nothing here may
contain a credential, a real private repository or project name, or any content
copied out of a thread. Test fixtures use invented names (`acme-widgets`,
`octocat`) for the same reason.

Nothing under `~/.bb` belongs in this directory. That includes:

| Path | Why it can never be committed |
| --- | --- |
| `~/.bb/auth.json`, `~/.bb/auth-secret` | Session credentials. |
| `~/.bb/bb.db` | Every thread's full content, plus settings and project paths. |
| `~/.bb/plugins/*/secrets/` | Plugin secret settings and per-plugin HTTP tokens. |
| `~/.bb/plugins/*/data.db` | Plugin state, which may cache private data. |
| `~/.bb/thread-storage/`, `~/.bb/attachments/`, `~/.bb/logs/` | Thread content and attachments. |
| `~/.bb/host-id`, `~/.bb/telemetry-id` | Machine identifiers. |

## What lives here

bb keeps its own configuration in `~/.bb/bb.db` rather than in files, so there
is nothing to symlink the way `claude/settings.json` is symlinked. General
preferences, keybindings, provider order, the project list, and plugin
registrations are all rows in that database, next to the credentials above.

The versionable form of that configuration is therefore `setup.sh`, which
reproduces it through the `bb` CLI on a new machine:

- `plugins/` — first-party plugins, installed from these directories with
  `bb plugin install .` so bb loads them via a `path:` source.
- `skills/` — user-level bb skills, symlinked to `~/.bb/skills`.
- Settings → General and keyboard overrides, applied as `bb settings` calls.
  Nothing is customized today; add a line to `setup.sh` when that changes.

Secrets that bb reads from the environment (`BB_INFERENCE`,
`BB_TRANSCRIPTION`, and any provider keys) belong in `../environment.local`,
which `.gitignore` keeps out of this repository. Non-sensitive values can go in
`../environment`.

## Usage

```sh
./setup.sh
```

It is idempotent: already-installed plugins are skipped, and an existing
non-empty `~/.bb/skills` is left alone rather than replaced.

## Building plugins

Preferences for plugins in this directory, each one learned the hard way.
Start from the `bb-plugin-authoring` skill for the API; this is what that skill
does not tell you.

### Reuse BB's own components

The single biggest lever. `@get-bb/plugin-sdk/app` exports the real thing for
most surfaces, and a hand-rolled version will look wrong, behave differently,
and have to be thrown away later:

| Instead of building | Use |
| --- | --- |
| A textarea plus a "Start thread" button | `experimental_NewThreadComposer` |
| A chat transcript or reply box | `ThreadChat` |
| A provider/model/reasoning picker | `experimental_ProviderModelPicker` |
| A permission-mode dropdown | `experimental_PermissionModePicker` |
| A syntax highlighter or diff view | `experimental_SourceCode`, `experimental_Diff` |
| A markdown renderer | `Markdown` |
| A provider name lookup | `experimental_useProviders()` |

`NewThreadComposer` in particular brings @-mentions, attachments, voice, the
environment and branch-from pickers, permission mode, draft persistence, and
the project's remembered execution defaults — all of which a custom form
silently lacks. Alias the `experimental_` names on import; JSX reads a
lowercase-initial name as an intrinsic element.

Reach for a vendored shadcn component only for chrome BB does not own.

### Spawned threads need the right provider

Skills are provider-scoped. A user-level Claude Code skill in
`~/.claude/skills/` cannot be resolved by a thread running on Codex — the agent
reports the skill as unavailable and improvises, which is worse than failing.
So never let a spawned thread silently inherit BB's global default provider.

Either pin it (pr-sweep's "Provider for spawned threads" setting, defaulting to
`claude-code`), or put the choice in front of the user and say in the UI which
provider the skill needs. Deciding it invisibly is the failure mode.

### Scope surfaces to your own threads

`threads.spawn` stamps `originPluginId` automatically. Any composer action,
thread-header action, or message action should check it and render nothing
elsewhere, so the plugin never appears in unrelated threads. Re-check it in the
handler too: what the frontend chooses to draw is not an authorization
decision.

### Structure

- Canonical source lives here and is activated with a path install
  (`npm install && bb plugin install . --yes`). `npm install` is required
  because `app.tsx` is compiled at install time; `server.ts` loads as
  TypeScript with no build step.
- Put plugin logic in a directory named for the plugin's domain (`sweep/`), not
  `lib/` — the scaffold uses `lib/` for vendored shadcn support files, and
  mixing owned logic there blurs which files are safe to regenerate.
- Keep a deterministic core with no network, filesystem, bb API, or model, so
  it is testable in isolation, and confine I/O to one named boundary module.
  Spend no model tokens on work that pure functions can do.
- Once the rpc contract outgrows a few methods, give it its own file that
  `app.tsx` imports as a type.
- Report missing external tooling as `bb.status.needsConfiguration`, not as an
  error.
- Dependencies: packages BB shims at runtime (react, sonner, vaul, the portal
  radix families, clsx, tailwind-merge, cva) are **devDependencies** — a second
  copy of a singleton breaks things. Everything else your source imports,
  including `zod`, is a **dependency**.

### Look up the API; do not guess it

The bundled declarations are the contract, and guessing costs more time than
reading them:

```sh
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts       # backend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts   # frontend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-testing-app.d.ts
```

Icon names are not free-form: they must exist in `components/ui/icon.tsx`
(`CORE_ICON_MAP`) or `components/ui/icon-registry.ts` (`EXTENDED_ICON_NAMES`).
`AlertTriangle` is real; `TriangleAlert` is not.

### Testing

`@get-bb/plugin-sdk/testing` and `/testing/app` are the harness. Things that
cost time the first time:

- `loadPluginApp(() => import("./app"))` needs the **thunk** — a static import
  binds the runtime too early.
- `harness.inspection.sdk.callsTo(path)` returns argument *lists*
  (`callsTo("threads.spawn")[0][0]` is the args object).
- Call `cleanup()` in `afterEach`, or slots stack up and queries match twice.
- Radix `Select` mirrors its value into a hidden native `<select>`, so text
  appears twice — query the `combobox` role by its accessible name.
- Radix opens on `pointerdown`, which jsdom does not synthesize. Prefer
  asserting the contract (which rpc fired for which id) over driving the popup.
- Peer deps the harness needs: `better-sqlite3`, `cron-parser`, `jsdom`,
  `react`, `react-dom`, `@testing-library/react`.

### Verify against a running server, not just tests

Unit tests pass against stubs. Before calling a plugin done, exercise the real
wire:

```sh
bb plugin build && bb plugin reload <id>
bb plugin list          # status, handler stats, last errors
bb plugin logs <id> -f

BASE=$(node -p "require(process.env.HOME+'/.bb/bb-app-runtime.json').serverUrl")
curl -s -X POST -H "content-type: application/json" -H "origin: $BASE" \
  -d 'null' "$BASE/api/v1/plugins/<id>/rpc/<method>"
```

`bb plugin dev` does the build-and-reload loop on save.
