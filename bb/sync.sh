#!/bin/bash
#
# Bring the running bb installation back in line with this checkout.
#
# `setup.sh` reproduces bb on a new machine and deliberately skips anything
# already registered, so it does nothing after a `git pull`. This script covers
# the other half: an artifact that is already installed but no longer matches
# the source it came from.
#
# Automations are snapshotted: bb takes its own copy of the script body under
# ~/.bb/plugins/automations/scripts/. A pull changes the source and the
# snapshot keeps running the old body, silently. That is how the Dependabot
# sweep spent two commits running a script that no longer existed here.
#
# Plugins moved to danielbachhuber/bb-plugins and are kept current by that
# repository's own sync.sh, so automations are all this script has to check.
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

# --- Report ------------------------------------------------------------------

detect_automations

if [ -z "$stale_automations" ]; then
  [ "$CHECK_ONLY" = yes ] || echo "bb: everything is current."
  exit 0
fi

count=$(printf '%s' "$stale_automations" | grep -c . || true)
echo "bb: ${count} artifact(s) no longer match this checkout"

while IFS=$'\t' read -r id project name source; do
  [ -z "$id" ] && continue
  printf '  automation  %-22s snapshot differs from %s\n' "$name" "${source#"$DIR"/}"
done < <(printf '%s' "$stale_automations")

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

exit "$failed"
