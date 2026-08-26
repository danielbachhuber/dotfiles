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
  id="$(basename "$plugin")"
  id="${id#bb-plugin-}"

  if printf '%s' "$installed" | grep -q "\"$id\""; then
    echo "==> $id (already installed, skipping)"
    continue
  fi

  echo "==> $id"
  ( cd "$plugin" && npm install --silent && bb plugin install . --yes )
done

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
