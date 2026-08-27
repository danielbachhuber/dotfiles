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
#   DEPENDABOT_WORKSPACE     source checkout the per-PR worktrees branch from,
#                            and the fallback workspace when one cannot be
#                            created. Required.
#   DEPENDABOT_WORKTREE_ROOT directory holding the per-PR worktrees.
#                            Default "<DEPENDABOT_WORKSPACE>-dependabot".
#   DEPENDABOT_MAX_THREADS   most threads to spawn per run. Default 5.
#   DEPENDABOT_PROVIDER      provider for spawned threads. Default claude-code.
#   DEPENDABOT_MODEL         model for spawned threads. Default claude-sonnet-5.
#   DEPENDABOT_GH            path to the gh CLI, when it is not on PATH.
#   DEPENDABOT_GIT           path to the git CLI, when it is not on PATH.
#
# BB_PROJECT_ID and BB_CLI are injected by the automations plugin.

set -euo pipefail

REPO="${DEPENDABOT_REPO:?DEPENDABOT_REPO is required (owner/name)}"
WORKSPACE="${DEPENDABOT_WORKSPACE:?DEPENDABOT_WORKSPACE is required (workspace path)}"
WORKTREE_ROOT="${DEPENDABOT_WORKTREE_ROOT:-${WORKSPACE}-dependabot}"
PROJECT="${BB_PROJECT_ID:?BB_PROJECT_ID is not set; run this as a bb automation}"
MAX_THREADS="${DEPENDABOT_MAX_THREADS:-5}"
PROVIDER="${DEPENDABOT_PROVIDER:-claude-code}"
# Pinned rather than inherited. With no --model, bb falls back to the project's
# remembered default, which is whatever model was last used by hand in that
# project: a dependency review would silently ride on it.
MODEL="${DEPENDABOT_MODEL:-claude-sonnet-5}"

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

resolve_git() {
  if [ -n "${DEPENDABOT_GIT:-}" ]; then
    printf '%s' "$DEPENDABOT_GIT"
    return
  fi
  if command -v git >/dev/null 2>&1; then
    command -v git
    return
  fi
  for candidate in /opt/homebrew/bin/git /usr/local/bin/git /usr/bin/git; do
    [ -x "$candidate" ] && printf '%s' "$candidate" && return
  done
  echo "git was not found. Set DEPENDABOT_GIT to its absolute path." >&2
  exit 1
}
GIT="$(resolve_git)"

# --- The queue ---------------------------------------------------------------
#
# headRefName comes along because the per-PR worktree is checked out on it.

open_prs="$("$GH" pr list --repo "$REPO" --author "app/dependabot" --state open \
  --json number,title,headRefName --limit 50)"

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

# `--json` reports archived threads alongside the rest, unlike the human table,
# so one call is the whole picture. The archived flag is carried through: the
# dedupe below wants every thread, and the archive phase wants only the ones
# still on the board, or it would re-archive the same threads every sweep.
all_threads="$("$BB" thread list --project "$PROJECT" --include-hidden --json \
  | jq -r '.[] | [.id, .status, (.archivedAt | tostring),
                  ((.title // "") + " " + (.titleFallback // ""))] | @tsv' || true)"
existing="$(printf '%s\n' "$all_threads" | cut -f4)"

# The PR number the thread is about, or nothing if it is not one of ours.
thread_pr_number() {
  case "$1" in
    *"${REPO}#"*)
      local rest="${1#*"${REPO}#"}"
      printf '%s' "${rest%%[!0-9]*}"
      ;;
  esac
}

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

# A checkout of the pull request branch itself, so that bb shows the PR and its
# CI state in the thread header.
#
# bb reads a thread's pull request by running bare `gh pr view` in the
# environment's working directory, and that resolves the *local* branch name.
# Only a checkout whose local branch is named after the PR head qualifies: the
# shared workspace sits on main, and a bb-managed worktree branched from the
# head gets a `bb/thr_...` branch that matches no pull request. So the sweep
# creates the worktree itself and hands the thread an unmanaged workspace.
#
# Prints the path on success and nothing on failure; the caller falls back to
# the shared workspace so a sweep still produces threads when, say, the branch
# is already checked out somewhere else.
ensure_pr_worktree() {
  local number="$1" head="$2"
  local dir="${WORKTREE_ROOT}/pr-${number}"

  if [ -d "$dir" ]; then
    printf '%s' "$dir"
    return 0
  fi
  mkdir -p "$WORKTREE_ROOT" || return 1

  # Stale metadata from a directory removed by hand would block `worktree add`.
  "$GIT" -C "$WORKSPACE" worktree prune >/dev/null 2>&1 || true

  "$GIT" -C "$WORKSPACE" fetch --quiet origin \
    "+refs/heads/${head}:refs/remotes/origin/${head}" >/dev/null 2>&1 || return 1
  "$GIT" -C "$WORKSPACE" worktree add --quiet -B "$head" "$dir" \
    "origin/${head}" >/dev/null 2>&1 || return 1

  printf '%s' "$dir"
}

spawned=0
skipped_for_cap=0

while IFS=$'\t' read -r number title head; do
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

  workspace="$(ensure_pr_worktree "$number" "$head")"
  if [ -z "$workspace" ]; then
    workspace="$WORKSPACE"
    echo "Could not create a checkout of ${head} for #${number}; the thread gets the shared workspace and no pull request card." >&2
  fi

  prompt="${REPO}#${number} is a Dependabot pull request: ${url}

Title: ${title}

This thread's workspace is a checkout of the pull request branch, kept for
reading the code the bump lands in. Leave it alone otherwise: no commits, no
pushes, no branch switching. The sweep deletes it once the PR closes.

Use the review-dependabot-prs skill. This thread covers that one PR and no
others: gather the facts, assess the real impact on this codebase, and write the
assessment to a draft file. Stop there. Do not post the comment, approve, or
merge until I have read the draft and told you to.

When you point me at that draft file, link it with its absolute path
(/Users/danielb/projects/drafts/...), not a \"~\"-relative one — bb only
renders absolute-path links as clickable.

Once the PR has actually landed, this thread is done, so file it away yourself
rather than leaving it for the twice-daily sweep. Confirm it first: gh pr view
${number} --json state must report MERGED. If the merge is only queued behind
auto-merge, leave the thread alone and the sweep will archive it once it lands.
When it is merged, write your closing summary first, then as your very last
action run: bb thread archive --self

That command interrupts the turn it runs in, which is why it goes last. The
summary you have already written survives."

  if "$BB" thread spawn \
    --project "$PROJECT" \
    --title "Dep: ${package} #${number}" \
    --prompt "$prompt" \
    --environment "$workspace" \
    --provider "$PROVIDER" \
    --model "$MODEL" >/dev/null; then
    echo "Spawned a thread for ${package} #${number}"
    spawned=$((spawned + 1))
  else
    echo "Failed to spawn a thread for ${package} #${number}" >&2
  fi
done < <(printf '%s' "$open_prs" | jq -r '.[] | [.number, .title, .headRefName] | @tsv')

# A cap that truncates quietly reads as "everything is handled" when it is not.
if [ "$skipped_for_cap" -gt 0 ]; then
  echo "${skipped_for_cap} more open Dependabot PR(s) were left for the next sweep (cap: ${MAX_THREADS})."
fi

# --- Archive what has landed ------------------------------------------------
#
# Once the PR is merged the thread has nothing left to say, so it should not sit
# in the sidebar waiting to be filed by hand. Only merged counts: a closed PR
# usually means Dependabot superseded it, and that is worth a look before the
# thread disappears.
#
# Only idle threads are archived. A thread still mid-review keeps working, and
# the next sweep will pick it up once it settles.

merged="$("$GH" pr list --repo "$REPO" --author "app/dependabot" --state merged \
  --limit 100 --json number --jq '.[].number')"

archived=0
just_archived=""
while IFS=$'\t' read -r id status archived_at text; do
  [ -z "$id" ] && continue
  [ "$archived_at" = "null" ] || continue
  [ "$status" = "idle" ] || continue

  number="$(thread_pr_number "$text")"
  [ -z "$number" ] && continue
  printf '%s\n' "$merged" | grep -qx "$number" || continue

  if "$BB" thread archive "$id" >/dev/null 2>&1; then
    echo "Archived the thread for #${number}, merged."
    archived=$((archived + 1))
    just_archived="${just_archived}${number}
"
  else
    echo "Failed to archive the thread for #${number} (${id})." >&2
  fi
done < <(printf '%s\n' "$all_threads")

# --- Retire the checkouts that have nothing left to review -------------------
#
# A per-PR worktree outlives its usefulness the moment the pull request stops
# being open, but only once its thread is off the board too: an agent may still
# be reading the code while the merge lands. Removing the directory leaves the
# archived thread's transcript intact; only its workspace goes away, so bb
# reports the workspace as unavailable if the thread is reopened later.

if [ -d "$WORKTREE_ROOT" ]; then
  open_numbers="$(printf '%s' "$open_prs" | jq -r '.[].number')"

  # Threads still on the board, minus the ones this run just filed away.
  live_numbers=""
  while IFS=$'\t' read -r id status archived_at text; do
    [ -z "$id" ] && continue
    [ "$archived_at" = "null" ] || continue
    number="$(thread_pr_number "$text")"
    [ -z "$number" ] && continue
    printf '%s\n' "$just_archived" | grep -qx "$number" && continue
    live_numbers="${live_numbers}${number}
"
  done < <(printf '%s\n' "$all_threads")

  for dir in "$WORKTREE_ROOT"/pr-*; do
    [ -d "$dir" ] || continue
    number="${dir##*/pr-}"
    case "$number" in "" | *[!0-9]*) continue ;; esac

    printf '%s\n' "$open_numbers" | grep -qx "$number" && continue
    printf '%s\n' "$live_numbers" | grep -qx "$number" && continue

    branch="$("$GIT" -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    # No --force: a dirty worktree means the review left something behind, and
    # that is worth seeing rather than deleting on a schedule.
    if "$GIT" -C "$WORKSPACE" worktree remove "$dir" >/dev/null 2>&1; then
      case "$branch" in
        "" | HEAD) ;;
        *) "$GIT" -C "$WORKSPACE" branch -D "$branch" >/dev/null 2>&1 || true ;;
      esac
      echo "Removed the checkout for #${number}; its pull request is no longer open."
    else
      echo "Left ${dir} in place: it has uncommitted changes or is in use." >&2
    fi
  done
fi

exit 0
