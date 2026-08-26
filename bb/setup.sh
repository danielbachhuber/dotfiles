#!/bin/bash
#
# Reproduce the bb configuration on a new machine.
#
# bb keeps its settings in ~/.bb/bb.db rather than in files, so there is
# nothing to symlink: this script replays the configuration through the CLI.
# See README.md for what must never be committed here.

set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if ! command -v bb >/dev/null 2>&1; then
  echo "bb is not on PATH. Install bb first: https://getbb.app" >&2
  exit 1
fi

# --- Skills -----------------------------------------------------------------
# Nothing to do here. BB reads user skills from each provider's own directory
# (~/.claude/skills for claude-code, ~/.codex/skills/.system for codex,
# ~/.hermes/skills for acp-hermes-agent), not from ~/.bb/skills. The
# building-bb-plugins skill therefore lives in ../claude/skills/ and is
# symlinked into ~/.claude/skills like every other skill in this repository.

# --- Plugins -----------------------------------------------------------------
# A path install builds against dependencies that are already on disk, so each
# plugin needs its own npm install before bb can build its bundles.
installed="$(bb plugin list --json 2>/dev/null || echo '[]')"

for plugin in "$DIR"/plugins/*/; do
  [ -f "$plugin/package.json" ] || continue
  # plugins/ also holds shared libraries the plugins depend on. A bb plugin is
  # the thing with a "bb" manifest block; anything else is not installable.
  jq -e '.bb | type == "object"' "$plugin/package.json" >/dev/null 2>&1 || continue
  id="$(basename "$plugin")"
  id="${id#bb-plugin-}"

  if printf '%s' "$installed" | grep -q "\"$id\""; then
    echo "==> $id (already installed, skipping)"
    continue
  fi

  echo "==> $id"
  ( cd "$plugin" && npm install --silent && bb plugin install . --yes )
done

# --- Automations -------------------------------------------------------------
# Automations are rows in bb.db like everything else, so they are reproduced
# here rather than symlinked. The script bodies live in automations/; bb keeps
# its own snapshot copy, so re-run this section (or the printed refresh command)
# after editing one.
#
# Which repositories get swept is deliberately not in this file: this repository
# is public and a private repo name cannot be committed to it. Define the sweeps
# in ../environment.local, as a JSON array of {project, repo, workspace}:
#
#   export BB_DEPENDABOT_SWEEPS='[
#     {"project": "Acme Widgets",
#      "repo": "octocat/acme-widgets",
#      "workspace": "/Users/you/projects/acme-widgets"}
#   ]'
#
# "project" is the bb project name as `bb project list` shows it; the ID is
# generated per machine, so it is resolved here rather than hardcoded.

if [ -f "$DIR/../environment.local" ]; then
  # shellcheck source=/dev/null
  . "$DIR/../environment.local"
fi

register_dependabot_sweep() {
  local project_name="$1" repo="$2" workspace="$3"

  local project_id
  project_id="$(bb project list --json | jq -r --arg n "$project_name" \
    '.[] | select(.name == $n) | .id' | head -1)"
  if [ -z "$project_id" ]; then
    echo "==> dependabot sweep: no bb project named \"$project_name\", skipping" >&2
    return
  fi

  if bb plugin run automations list --project "$project_id" --json 2>/dev/null \
    | jq -e '.[] | select(.name == "Dependabot sweep")' >/dev/null; then
    echo "==> dependabot sweep for $project_name (already registered, skipping)"
    return
  fi

  echo "==> dependabot sweep for $project_name"
  bb plugin run automations create --project "$project_id" \
    --name "Dependabot sweep" \
    --cron "0 7,14 * * 1-5" \
    --timezone "America/Los_Angeles" \
    --script-file "$DIR/automations/dependabot-sweep.sh" \
    --interpreter bash \
    --timeout 300000 \
    --env-json "$(jq -nc --arg repo "$repo" --arg workspace "$workspace" \
      '{DEPENDABOT_REPO: $repo, DEPENDABOT_WORKSPACE: $workspace}')"
}

if [ -n "${BB_DEPENDABOT_SWEEPS:-}" ]; then
  while IFS=$'\t' read -r project repo workspace; do
    [ -z "$project" ] && continue
    register_dependabot_sweep "$project" "$repo" "$workspace"
  done < <(printf '%s' "$BB_DEPENDABOT_SWEEPS" \
    | jq -r '.[] | [.project, .repo, .workspace] | @tsv')
fi

# --- Settings → General ------------------------------------------------------
# Every preference lives in bb.db. Add the ones worth carrying between
# machines here; nothing is customized today. For example:
#
#   bb settings general defaultProviderId claude-code
#   bb settings general steerActiveThreadOnEnter true
#   bb settings general providerOrder '["claude-code","codex"]'

# --- Keyboard overrides ------------------------------------------------------
# Same idea; `bb settings keyboard list` shows the effective bindings.
#
#   bb settings keyboard set thread.new 'mod+shift+o'

echo "done."
