#!/bin/bash
#
# Spawn one bb thread per open Dependabot pull request.
#
# Registered as a bb script automation (see ../setup.sh). Script automations run
# on the bb server with no model tokens: this file only decides which PRs still
# need a thread, and hands each one to an agent thread that does the reviewing.
#
# Silence is meaningful. An exit-0 run with empty output is recorded as a
# skipped silent tick, so a sweep that finds nothing new stays out of the run
# log entirely.
#
# Configuration arrives as script variables (`--env-json`):
#
#   DEPENDABOT_REPO          owner/name to sweep. Required.
#   DEPENDABOT_WORKSPACE     workspace path spawned threads attach to. Required.
#   DEPENDABOT_MAX_THREADS   most threads to spawn per run. Default 5.
#   DEPENDABOT_PROVIDER      provider for spawned threads. Default claude-code.
#   DEPENDABOT_GH            path to the gh CLI, when it is not on PATH.
#
# BB_PROJECT_ID and BB_CLI are injected by the automations plugin.

set -euo pipefail

REPO="${DEPENDABOT_REPO:?DEPENDABOT_REPO is required (owner/name)}"
WORKSPACE="${DEPENDABOT_WORKSPACE:?DEPENDABOT_WORKSPACE is required (workspace path)}"
PROJECT="${BB_PROJECT_ID:?BB_PROJECT_ID is not set; run this as a bb automation}"
MAX_THREADS="${DEPENDABOT_MAX_THREADS:-5}"
PROVIDER="${DEPENDABOT_PROVIDER:-claude-code}"

BB="${BB_CLI:-bb}"

# The server's PATH is not a login shell's, so gh is often missing from it even
# when it is installed. Resolve it the way the sweep plugins do: an explicit
# setting first, then PATH, then the usual install locations.
resolve_gh() {
  if [ -n "${DEPENDABOT_GH:-}" ]; then
    printf '%s' "$DEPENDABOT_GH"
    return
  fi
  if command -v gh >/dev/null 2>&1; then
    command -v gh
    return
  fi
  for candidate in /opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh; do
    [ -x "$candidate" ] && printf '%s' "$candidate" && return
  done
  echo "gh was not found. Set DEPENDABOT_GH to its absolute path." >&2
  exit 1
}
GH="$(resolve_gh)"

# --- The queue ---------------------------------------------------------------

open_prs="$("$GH" pr list --repo "$REPO" --author "app/dependabot" --state open \
  --json number,title --limit 50)"

[ "$(printf '%s' "$open_prs" | jq 'length')" -eq 0 ] && exit 0

# --- What already has a thread -----------------------------------------------
#
# bb itself is the record of which PRs have been picked up, so there is no state
# file to keep in sync. Archived threads count: a PR that was reviewed and put
# away must not come back on the next sweep. Hidden threads count too, in case
# one was spawned by something other than this script.
#
# The match runs against `owner/name#number`, which the spawn prompt opens with
# so that bb captures it in the thread's fallback title. Deliberately not the
# display title: that reads "<package> #<number>", and a bare "#5790" would also
# match an unrelated thread that happens to mention that number.

thread_titles() {
  "$BB" thread list --project "$PROJECT" --include-hidden --json "$@" \
    | jq -r '.[] | (.title // ""), (.titleFallback // "")'
}
existing="$( { thread_titles; thread_titles --archived; } || true )"

# --- Spawn -------------------------------------------------------------------

# Dependabot writes two title shapes, and the package is the useful part of
# both: a single bump ("bump jose from 6.2.8 to 6.2.10") and a grouped one
# ("bump the sentry group across 1 directory with 2 updates"). Anything that
# matches neither keeps its title, so an unrecognized shape is still legible.
dependabot_package() {
  local title="${1#*): }"
  case "$title" in
    "bump the "*" group "*) title="${title#bump the }"; printf '%s group' "${title%% group *}" ;;
    "bump "*" from "*)      title="${title#bump }";     printf '%s' "${title%% from *}" ;;
    *)                      printf '%s' "$title" ;;
  esac
}

spawned=0
skipped_for_cap=0

while IFS=$'\t' read -r number title; do
  [ -z "$number" ] && continue

  if printf '%s\n' "$existing" | grep -qF "${REPO}#${number}"; then
    continue
  fi

  if [ "$spawned" -ge "$MAX_THREADS" ]; then
    skipped_for_cap=$((skipped_for_cap + 1))
    continue
  fi

  url="https://github.com/${REPO}/pull/${number}"
  package="$(dependabot_package "$title")"
  prompt="${REPO}#${number} is a Dependabot pull request: ${url}

Title: ${title}

Use the review-dependabot-prs skill. This thread covers that one PR and no
others: gather the facts, assess the real impact on this codebase, and write the
assessment to a draft file. Stop there. Do not post the comment, approve, or
merge until I have read the draft and told you to."

  if "$BB" thread spawn \
    --project "$PROJECT" \
    --title "Dep: ${package} #${number}" \
    --prompt "$prompt" \
    --environment "$WORKSPACE" \
    --provider "$PROVIDER" >/dev/null; then
    echo "Spawned a thread for ${package} #${number}"
    spawned=$((spawned + 1))
  else
    echo "Failed to spawn a thread for ${package} #${number}" >&2
  fi
done < <(printf '%s' "$open_prs" | jq -r '.[] | [.number, .title] | @tsv')

# A cap that truncates quietly reads as "everything is handled" when it is not.
if [ "$skipped_for_cap" -gt 0 ]; then
  echo "${skipped_for_cap} more open Dependabot PR(s) were left for the next sweep (cap: ${MAX_THREADS})."
fi

exit 0
