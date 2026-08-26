# bb-plugin-daniel-github-workflow

One plugin for the GitHub work that needs Daniel: pull requests he authored,
reviews he owes other people, issues assigned to him, and creating new issues.

It replaced four separate plugins — `pr-sweep`, `review-sweep`, `issue-sweep`
and `new-issue` — which between them carried three copies of the same `gh`
runner, three stores over an identical schema, and 14 settings where 8 do.

## Install on a new machine

```bash
cd ~/.dotfiles/bb/plugins/bb-plugin-daniel-github-workflow
npm install
bb plugin install . --yes
```

Requires `gh` on PATH and authenticated. A missing or unauthenticated `gh` is
reported as a configuration state, not an error.

## Layout

```
server.ts        wiring only: settings, the database, one register call per domain
app.tsx          four nav panels, three thread header actions, one composer action
shared/          gh.ts, store.ts, spawn-target.ts — used by every domain
prs/             pull requests Daniel authored
reviews/         reviews Daniel owes other people
issues/          issues assigned to Daniel
new-issue/       creating an issue
```

**What is shared and what is not.** The `gh` boundary, the store and project
matching are one copy each. The *classifiers* are deliberately separate: pull
requests and reviews look alike but encode different rules, and folding them
into one parameterised engine would couple two rule sets that will drift.

Each domain owns its table prefix (`pr_`, `review_`, `issue_`), its background
service, and rpc methods named after what they act on. Those names must stay
unique across the plugin: bb rejects duplicate keys within one factory, which
is what forced the rename from three plugins that each had `listRows`.

## Development

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
bb plugin dev     # rebuild and reload on save
```

**All test fixtures are synthetic.** This repository is public. Never paste
real pull request titles, reviewer logins, repository names, or URLs into a
test.
