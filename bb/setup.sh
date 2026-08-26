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

# --- User-level skills -------------------------------------------------------
# ~/.bb/skills is bb's own skills tier. Link it here, but never delete real
# skills: only an existing symlink or an empty directory is replaced.
mkdir -p "$HOME/.bb"
skills_target="$HOME/.bb/skills"
if [ -L "$skills_target" ] || [ ! -e "$skills_target" ]; then
  ln -sfn "$DIR/skills" "$skills_target"
  echo "linked $skills_target -> $DIR/skills"
elif [ -d "$skills_target" ] && [ -z "$(ls -A "$skills_target")" ]; then
  rmdir "$skills_target"
  ln -s "$DIR/skills" "$skills_target"
  echo "linked $skills_target -> $DIR/skills"
else
  echo "warning: $skills_target exists and is not empty; leaving it alone." >&2
fi

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
