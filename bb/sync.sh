#!/bin/bash
#
# Bring the running bb installation back in line with this checkout.
#
# `setup.sh` reproduces bb on a new machine and deliberately skips anything
# already registered, so it does nothing after a `git pull`. This script covers
# the other half: an artifact that is already installed but no longer matches
# the source it came from.
#
# The two classes drift in opposite directions.
#
#   Plugins are installed as `path:` sources pointing straight at
#   plugins/<name>, so a pull changes the source in place. What goes stale is
#   the build in dist/, not a copy.
#
#   Automations are snapshotted: bb takes its own copy of the script body under
#   ~/.bb/plugins/automations/scripts/. A pull changes the source and the
#   snapshot keeps running the old body, silently. That is how the Dependabot
#   sweep spent two commits running a script that no longer existed here.
#
# Skills are symlinked by setup.sh, so a pull is already live for them and
# there is nothing to do.
#
# Usage:
#   sync.sh            report drift and apply it
#   sync.sh --check    report drift and change nothing
#
# --check is what the post-merge hook runs. It must stay fast and offline: no
# npm, no network, no writes. It prints nothing when everything is current, so
# a pull that touches no bb artifact stays quiet.

set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SNAPSHOT_ROOT="$HOME/.bb/plugins/automations/scripts"

CHECK_ONLY=no
case "${1:-}" in
  --check) CHECK_ONLY=yes ;;
  "") ;;
  *) echo "usage: sync.sh [--check]" >&2; exit 2 ;;
esac

if ! command -v bb >/dev/null 2>&1; then
  # A machine without bb is not a machine with stale bb artifacts. Say so when
  # asked directly; stay silent when a git hook is asking.
  [ "$CHECK_ONLY" = yes ] && exit 0
  echo "bb is not on PATH. Install bb first: https://getbb.app" >&2
  exit 1
fi

# --- Detection: automations --------------------------------------------------
#
# bb names its snapshot after the source file with a UUID spliced in
# ("dependabot-sweep.33ccdfa8-….sh"), so the source is recovered by cutting at
# the first dot. An automation whose source is not in this repository is left
# alone: it was registered by hand and this script does not own it.

stale_automations=""   # id \t projectId \t name \t source path

detect_automations() {
  local projects project id name script_file base source snapshot
  projects="$(bb project list --json 2>/dev/null | jq -r '.[].id' 2>/dev/null || true)"
  [ -z "$projects" ] && return 0

  while read -r project; do
    [ -z "$project" ] && continue
    while IFS=$'\t' read -r id name script_file; do
      [ -z "$id" ] && continue

      base="${script_file%%.*}"
      source="$DIR/automations/${base}.sh"
      [ -f "$source" ] || continue

      snapshot="$SNAPSHOT_ROOT/$id/$script_file"
      [ -f "$snapshot" ] || continue

      if ! cmp -s "$source" "$snapshot"; then
        stale_automations="${stale_automations}${id}	${project}	${name}	${source}
"
      fi
    done < <(bb automation list --project "$project" --json 2>/dev/null \
      | jq -r '.[] | select(.execution.mode == "script")
               | [.id, .name, .execution.scriptFile] | @tsv' 2>/dev/null || true)
  done < <(printf '%s\n' "$projects")
}

# --- Detection: plugins ------------------------------------------------------
#
# A plugin is stale when anything it is built from is newer than its dist/.
# "Built from" includes its `file:` dependencies, which are bundled at build
# time rather than resolved at runtime: an edit to gh-shared has to rebuild
# every plugin that carries it, and reading the dependency out of package.json
# derives that fan-out instead of hardcoding a list that will go out of date.

stale_plugins=""   # directory \t plugin id \t what changed

# Source means what git tracks and what the build actually reads. Neither is
# what is simply on disk: a plugin writes runtime data inside its own directory
# (weekly-review keeps data/weeks/ there), so a plain find treats every write it
# makes as a reason to rebuild it, and prose is tracked but never compiled.
newest_source_mtime() {
  ( cd "$1" 2>/dev/null || exit 0
    git ls-files -z -- ':(exclude)*.md' 2>/dev/null \
      | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1 )
}

# The same, for a directory that is itself pruned as a source tree. Passing
# dist/ to newest_source_mtime prunes the very root it was handed.
newest_mtime() {
  find "$1" -type f -print0 2>/dev/null \
    | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1
}

# The sibling directories a plugin bundles, as `file:../<dir>` dependency specs.
file_dep_dirs() {
  jq -r '[(.dependencies // {}), (.devDependencies // {})]
         | add | values | .[]
         | select(type == "string" and startswith("file:../"))
         | sub("^file:\\.\\./"; "")' "$1/package.json" 2>/dev/null || true
}

detect_plugins() {
  local plugin id dist_mtime src_mtime reason dep dep_dir dep_mtime
  for plugin in "$DIR"/plugins/*/; do
    plugin="${plugin%/}"
    [ -f "$plugin/package.json" ] || continue
    jq -e '.bb | type == "object"' "$plugin/package.json" >/dev/null 2>&1 || continue

    id="$(basename "$plugin")"; id="${id#bb-plugin-}"

    dist_mtime="$(newest_mtime "$plugin/dist" 2>/dev/null || true)"
    if [ -z "$dist_mtime" ]; then
      stale_plugins="${stale_plugins}${plugin}	${id}	never built
"
      continue
    fi

    reason=""
    src_mtime="$(newest_source_mtime "$plugin")"
    if [ -n "$src_mtime" ] && [ "$src_mtime" -gt "$dist_mtime" ]; then
      reason="source changed"
    fi

    while read -r dep; do
      [ -z "$dep" ] && continue
      dep_dir="$DIR/plugins/$dep"
      [ -d "$dep_dir" ] || continue
      dep_mtime="$(newest_source_mtime "$dep_dir")"
      if [ -n "$dep_mtime" ] && [ "$dep_mtime" -gt "$dist_mtime" ]; then
        if [ -z "$reason" ]; then reason="$dep changed"; else reason="$reason, $dep changed"; fi
      fi
    done < <(file_dep_dirs "$plugin")

    [ -n "$reason" ] && stale_plugins="${stale_plugins}${plugin}	${id}	${reason}
"
  done
  return 0
}

# --- Report ------------------------------------------------------------------

detect_automations
detect_plugins

if [ -z "$stale_automations" ] && [ -z "$stale_plugins" ]; then
  [ "$CHECK_ONLY" = yes ] || echo "bb: everything is current."
  exit 0
fi

count=$(( $(printf '%s' "$stale_automations" | grep -c . || true) \
        + $(printf '%s' "$stale_plugins" | grep -c . || true) ))
echo "bb: ${count} artifact(s) no longer match this checkout"

while IFS=$'\t' read -r id project name source; do
  [ -z "$id" ] && continue
  printf '  automation  %-22s snapshot differs from %s\n' "$name" "${source#"$DIR"/}"
done < <(printf '%s' "$stale_automations")

while IFS=$'\t' read -r plugin id reason; do
  [ -z "$plugin" ] && continue
  printf '  plugin      %-22s %s\n' "$id" "$reason"
done < <(printf '%s' "$stale_plugins")

if [ "$CHECK_ONLY" = yes ]; then
  echo "Run: ${DIR}/sync.sh"
  exit 0
fi

# --- Apply: automations ------------------------------------------------------
#
# The update re-passes interpreter, timeout, and env rather than letting them
# default. DEPENDABOT_WORKTREE_ROOT, for one, was set by hand after the
# automation was registered and exists nowhere but bb's own record of it, so
# reconstructing the call from setup.sh would quietly drop it.
#
# Pausing first is a precaution, not a guarantee: an update sometimes fires a
# run immediately, which for the Dependabot sweep means threads nobody asked
# for. The run log is checked either side so that a run that does fire is
# reported rather than discovered later.

apply_automation() {
  local id="$1" project="$2" name="$3" source="$4"
  local row interpreter timeout env was_enabled before after

  row="$(bb automation list --project "$project" --json \
    | jq -c --arg id "$id" '.[] | select(.id == $id)')"
  interpreter="$(printf '%s' "$row" | jq -r '.execution.interpreter // "bash"')"
  timeout="$(printf '%s' "$row" | jq -r '.execution.timeoutMs // empty')"
  env="$(printf '%s' "$row" | jq -c '.execution.env // {}')"
  was_enabled="$(printf '%s' "$row" | jq -r '.enabled')"

  before="$(bb automation runs "$id" --project "$project" --limit 1 --json 2>/dev/null \
    | jq -r '.runs[0].id // ""' || true)"

  echo "==> automation ${name}"
  # Only pause what was running, or a resume would enable an automation the
  # user had deliberately switched off.
  [ "$was_enabled" = true ] && bb automation pause "$id" --project "$project" >/dev/null

  bb automation update "$id" --project "$project" \
    --script-file "$source" \
    --interpreter "$interpreter" \
    ${timeout:+--timeout "$timeout"} \
    --env-json "$env" >/dev/null

  [ "$was_enabled" = true ] && bb automation resume "$id" --project "$project" >/dev/null

  after="$(bb automation runs "$id" --project "$project" --limit 1 --json 2>/dev/null \
    | jq -r '.runs[0].id // ""' || true)"
  if [ -n "$after" ] && [ "$after" != "$before" ]; then
    echo "    the update fired a run (${after}); check what it did" >&2
  fi
  return 0
}

failed=0

while IFS=$'\t' read -r id project name source; do
  [ -z "$id" ] && continue
  apply_automation "$id" "$project" "$name" "$source" || { failed=1; echo "    failed" >&2; }
done < <(printf '%s' "$stale_automations")

# --- Apply: plugins ----------------------------------------------------------
#
# The order matters and is not interchangeable. `npm install` refreshes the
# gh-shared copy but replaces the harvest copy with a symlink, which puts a
# second React in the tree; `harvest:sync` reinstates the copy with
# --install-links. `tsc --noEmit` then catches a `file:` dependency that is
# still stale, which is the failure that otherwise reaches the panel as a
# runtime "is not a function". A plugin that does not typecheck is not built
# and not reloaded, so a broken pull cannot take a working panel down with it.

apply_plugin() {
  local plugin="$1" id="$2"
  echo "==> plugin ${id}"
  (
    cd "$plugin"
    npm install --silent
    if jq -e '.scripts["harvest:sync"]' package.json >/dev/null 2>&1; then
      npm run --silent harvest:sync
    fi
    npx tsc --noEmit -p tsconfig.json
    bb plugin build >/dev/null
    # Staleness is "is dist older than what it was built from", and npm rewrites
    # package-lock.json as part of the install above, which can land after the
    # build it preceded. Stamping the artifacts this build just produced makes
    # dist unambiguously newer than its own inputs, so one run converges instead
    # of leaving the next check reporting work it already did.
    find dist -type f -print0 | xargs -0 touch
  ) || return 1
  bb plugin reload "$id" >/dev/null
  return 0
}

while IFS=$'\t' read -r plugin id reason; do
  [ -z "$plugin" ] && continue
  apply_plugin "$plugin" "$id" || { failed=1; echo "    failed; left as it was" >&2; }
done < <(printf '%s' "$stale_plugins")

exit "$failed"
