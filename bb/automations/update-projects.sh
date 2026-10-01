#!/bin/bash
#
# Fast-forward every bb project on this machine to its default branch, then run
# the project's sync script if it has one. Meant to run on a schedule, once per
# machine, as a bb script automation registered by ../setup.sh:
#
#   bb automation create --project proj_personal --name "Update projects" \
#     --cron "*/15 5-15 * * *" --timezone America/Los_Angeles --interpreter bash \
#     --timeout 600000 --script 'exec ~/.dotfiles/bb/automations/update-projects.sh'
#
# The path is passed inline rather than with --script-file: bb stores a snapshot
# of a script file, so later changes to this one would never run.
#
# The projects are whatever `bb project list` has a checkout for on this host,
# so a repository is covered as soon as it is added to bb. The default branch is
# origin's HEAD (main, master, trunk, or anything else).
#
# It only fast-forwards. A checkout on another branch or with uncommitted
# changes is someone's work in progress, and is skipped without comment so that
# a long-lived edit does not make every run noisy. A checkout that has diverged
# from origin is reported and left alone. Nothing is stashed, reset, or merged.
#
# The sync script is `sync.sh` at the repository root, or `bb/sync.sh`. It runs
# when `sync.sh --check` reports drift, even if nothing was pulled, so a build
# that failed last time is retried. A run with nothing pulled and nothing to
# sync prints nothing, which bb records as a silent tick.
#
# Exits non-zero only when a sync script fails. A fetch that fails (offline) or
# a diverged branch is printed but does not count as a failed run, since three
# failures in a row pause the automation for every project.

set -uo pipefail

# The bb server's PATH is not a login shell's.
for dir in /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
done
export PATH

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is not on PATH." >&2
  exit 1
fi

# Only checkouts on the host this runs on. Paths are often identical across
# machines, so existence alone would not tell another host's source apart.
host_id="$(cat "${BB_DATA_DIR:-$HOME/.bb}/host-id" 2>/dev/null)"
if [ -z "$host_id" ]; then
  echo "Could not determine this bb host." >&2
  exit 1
fi

paths="$(bb project list --json | jq -r --arg host "$host_id" \
  '[.[].sources[] | select(.type == "local_path" and .hostId == $host) | .path]
   | unique | .[]')" || { echo "Could not list bb projects." >&2; exit 1; }

failed=0

update_project() {
  local dir="$1" name default branch before sync check

  name="$(basename "$dir")"
  git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || return 0
  git -C "$dir" remote get-url origin >/dev/null 2>&1 || return 0

  default="$(git -C "$dir" symbolic-ref --short -q refs/remotes/origin/HEAD)"
  default="${default#origin/}"
  if [ -z "$default" ]; then
    for candidate in main master trunk; do
      if git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$candidate"; then
        default="$candidate"
        break
      fi
    done
  fi
  [ -n "$default" ] || return 0

  branch="$(git -C "$dir" symbolic-ref --short -q HEAD)"
  [ "$branch" = "$default" ] || return 0

  # Untracked files are left out: a pull can proceed around them.
  [ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ] || return 0

  if ! git -C "$dir" fetch --quiet origin "$default" 2>/dev/null; then
    echo "$name: could not fetch origin/$default." >&2
    return 0
  fi

  before="$(git -C "$dir" rev-parse HEAD)"
  if ! git -C "$dir" merge --ff-only --quiet "origin/$default" >/dev/null 2>&1; then
    echo "$name: $default has diverged from origin/$default; left alone." >&2
    return 0
  fi
  if [ "$before" != "$(git -C "$dir" rev-parse HEAD)" ]; then
    echo "$name: pulled"
    git -C "$dir" log --oneline "$before..HEAD" | sed 's/^/  /'
  fi

  sync=""
  for candidate in sync.sh bb/sync.sh; do
    if [ -x "$dir/$candidate" ]; then
      sync="$dir/$candidate"
      break
    fi
  done
  [ -n "$sync" ] || return 0

  # --check is offline and prints nothing when everything is current. A script
  # that does not understand it fails here, and gets the full run instead.
  if check="$("$sync" --check 2>&1)" && [ -z "$check" ]; then
    return 0
  fi

  echo "$name: running ${sync#"$dir"/}"
  if ! "$sync" 2>&1 | sed 's/^/  /'; then
    echo "$name: ${sync#"$dir"/} failed." >&2
    return 1
  fi
}

while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  update_project "$dir" || failed=1
done <<< "$paths"

exit "$failed"
