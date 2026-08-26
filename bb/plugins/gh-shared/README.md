# @danielb/gh-shared

The code the GitHub plugins genuinely share. Consumed as a local `file:`
dependency, so each plugin stays a separate plugin with its own identity,
settings, database and panel header icon.

## What is in here, and why only this

The four plugins were merged into one and then split apart again. Measuring
the overlap afterwards showed how little of it was real. Between `pr-sweep`
and `review-sweep`:

| File | Differing lines |
| --- | --- |
| `spawn-target.ts` | 0 |
| `store.ts` | 109 |
| `gh.ts` | 170 |
| `classify.ts` | 247 |

So this package holds the parts that were byte-identical across every plugin,
and nothing else:

- **`gh`** — `createGhRunner`, `GhUnavailableError`, `REPO_SLUG_PATTERN`. The
  one place any plugin spawns a process, and the slug validation that keeps a
  repository name from reaching a shell. Each plugin keeps its own fetching:
  pull requests fan out per repository, reviews run one GraphQL search, issues
  run a different one.
- **`projects`** — matching a repository to a bb project by its git remote.

Deliberately **not** here: the classifiers, the row types, or the stores. They
look alike and encode different rules; sharing them would couple things that
have already drifted apart once.

## Using it

```json
{ "dependencies": { "@danielb/gh-shared": "file:../gh-shared" } }
```

The code is bundled into each plugin at build time, not resolved at runtime.
So a change here reaches a plugin only when that plugin is rebuilt:

```sh
cd ~/.dotfiles/bb/plugins
for p in bb-plugin-pr-sweep bb-plugin-review-sweep bb-plugin-issue-sweep; do
  (cd $p && npm install && bb plugin build . && bb plugin reload ${p#bb-plugin-})
done
```

Until then the plugins run different vintages of this library, which is the
main cost of sharing it this way.
