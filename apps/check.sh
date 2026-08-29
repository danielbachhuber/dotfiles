#!/bin/bash
#
# Compare this machine against the Brewfile and the package lists beside it.
#
# Reports one line per expected thing with its installed version. Nothing is
# installed or changed. Exits non-zero if anything is missing.
#
# Statuses:
#   ok         installed, and current as far as Homebrew knows
#   outdated   installed, but a newer version is available
#   unmanaged  the application is in /Applications, but Homebrew did not put it
#              there and will not update it. `brew install --cask --adopt` fixes
#              this without redownloading. See README.md.
#   missing    not installed

set -uo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# shellcheck source=node.sh
. "$DIR/node.sh"
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1

missing=0
counts_ok=0 counts_outdated=0 counts_unmanaged=0 counts_missing=0

if [ -t 1 ]; then
  dim=$'\033[2m'; red=$'\033[31m'; yellow=$'\033[33m'; green=$'\033[32m'; off=$'\033[0m'
else
  dim=''; red=''; yellow=''; green=''; off=''
fi

report() { # status name version_or_note
  local status="$1" name="$2" note="${3:-}" colour=''
  case "$status" in
    ok)        colour=$green;  counts_ok=$((counts_ok + 1)) ;;
    outdated)  colour=$yellow; counts_outdated=$((counts_outdated + 1)) ;;
    unmanaged) colour=$yellow; counts_unmanaged=$((counts_unmanaged + 1)) ;;
    missing)   colour=$red;    counts_missing=$((counts_missing + 1)); missing=1 ;;
  esac
  printf '  %s%-10s%s %-28s %s%s%s\n' "$colour" "$status" "$off" "$name" "$dim" "$note" "$off"
}

read_list() { grep -v '^[[:space:]]*#' "$1" | grep -v '^[[:space:]]*$'; }

# Look a name up in a "name version" table without associative arrays, which
# the bash macOS ships (3.2) does not have.
lookup() { awk -v n="$2" '$1 == n { print $2; found = 1 } END { exit !found }' "$1"; }

# `brew outdated --verbose` prints "name (installed) < available".
lookup_available() { awk -v n="$2" '$1 == n { print $NF; found = 1 } END { exit !found }' "$1"; }

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not on PATH." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

brew list --formula --versions > "$work/formulae" 2>/dev/null
brew list --cask    --versions > "$work/casks"    2>/dev/null
# --verbose rather than --quiet: it prints "gh (2.92.0) < 2.98.0", so the
# available version can be reported alongside the installed one.
brew outdated --formula --verbose > "$work/outdated_formulae" 2>/dev/null
# --greedy for casks: without it Homebrew stays silent about anything that
# updates itself, which is nearly every application here. This script only
# reports, so it should say what is actually available and let the app's own
# updater get to it.
brew outdated --cask --greedy --verbose > "$work/outdated_casks" 2>/dev/null
brew tap > "$work/taps" 2>/dev/null

# --- Taps --------------------------------------------------------------------
# bash 3.2, which macOS ships, has no mapfile.
taps=()
while IFS= read -r line; do taps+=("$line"); done \
  < <(sed -n 's/^tap "\([^"]*\)".*/\1/p' "$DIR/Brewfile")
if [ ${#taps[@]} -gt 0 ]; then
  echo "Taps"
  for tap in "${taps[@]}"; do
    if grep -qx "$tap" "$work/taps"; then report ok "$tap"; else report missing "$tap"; fi
  done
  echo
fi

# --- Formulae ----------------------------------------------------------------
echo "Formulae"
while read -r name; do
  short="${name##*/}"
  if version="$(lookup "$work/formulae" "$short")"; then
    if available="$(lookup_available "$work/outdated_formulae" "$short")"; then
      report outdated "$short" "$version -> $available"
    else
      report ok "$short" "$version"
    fi
  else
    report missing "$short"
  fi
done < <(sed -n 's/^brew "\([^"]*\)".*/\1/p' "$DIR/Brewfile")
echo

# --- Casks -------------------------------------------------------------------
cask_tokens=()
while IFS= read -r line; do cask_tokens+=("$line"); done \
  < <(sed -n 's/^cask "\([^"]*\)".*/\1/p' "$DIR/Brewfile")
if [ ${#cask_tokens[@]} -gt 0 ]; then
  echo "Applications"
  # One API call for every token, so an unadopted cask can still be matched to
  # the bundle sitting in /Applications.
  brew info --cask --json=v2 "${cask_tokens[@]}" 2>/dev/null \
    | jq -r '.casks[] | "\(.token)\t\(.version)\t\([.artifacts[]? | select(type == "object") | .app[]?] | join(","))"' \
    > "$work/cask_apps" 2>/dev/null

  for token in "${cask_tokens[@]}"; do
    if version="$(lookup "$work/casks" "$token")"; then
      if available="$(lookup_available "$work/outdated_casks" "$token")"; then
        report outdated "$token" "$version -> $available"
      else
        report ok "$token" "$version"
      fi
      continue
    fi

    app="$(awk -F'\t' -v t="$token" '$1 == t { print $3 }' "$work/cask_apps" | cut -d, -f1)"
    if [ -n "$app" ] && [ -d "/Applications/$app" ]; then
      # Homebrew did not install it, so its version has to come from the bundle.
      # Most of these update themselves, and a stalled updater is the thing
      # worth noticing, so compare against what the cask offers.
      have="$(defaults read "/Applications/$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
      # Cask versions carry a build after a comma; the bundle rarely does.
      want="$(awk -F'\t' -v t="$token" '$1 == t { print $2 }' "$work/cask_apps" | cut -d, -f1)"

      if [ -z "$have" ]; then
        report unmanaged "$token" "$app present"
      elif [ "$have" = "$want" ]; then
        report unmanaged "$token" "$have"
      else
        report unmanaged "$token" "$have, cask has $want"
      fi
    else
      report missing "$token"
    fi
  done
  echo
fi

# --- App Store ---------------------------------------------------------------
echo "App Store"
if command -v mas >/dev/null 2>&1; then
  mas list > "$work/mas" 2>/dev/null
else
  : > "$work/mas"
fi
while IFS=$'\t' read -r name id; do
  if [ -s "$work/mas" ] && grep -q "^$id " "$work/mas"; then
    report ok "$name" "$(awk -v i="$id" '$1 == i { print $NF }' "$work/mas" | tr -d '()')"
  elif [ -d "/Applications/$name.app" ]; then
    # mas is the source of truth, but it is itself installed from the Brewfile.
    # Fall back to the bundle so this section still says something useful.
    report ok "$name" "installed"
  else
    report missing "$name"
  fi
done < <(sed -n 's/^mas "\([^"]*\)", id: \([0-9]*\).*/\1\t\2/p' "$DIR/Brewfile")
echo

# --- npm globals -------------------------------------------------------------
echo "npm globals"
# Reported against nvm's Node specifically. Falling back to whatever npm is on
# PATH would look at a different global root and call everything missing.
if use_nvm_node; then
  npm ls -g --depth=0 2>/dev/null | sed -n 's/^[+`]-- //p' > "$work/npm"
  while read -r pkg; do
    version="$(sed -n "s|^${pkg}@||p" "$work/npm" | head -1)"
    if [ -n "$version" ]; then report ok "$pkg" "$version"; else report missing "$pkg"; fi
  done < <(read_list "$DIR/npm-globals.txt")
else
  echo "  nvm is not installed, so these cannot be checked. See README.md."
  # Not verifiable is not the same as fine; exit non-zero either way.
  missing=1
fi
echo

# --- Agent CLIs --------------------------------------------------------------
echo "Agent CLIs"
check_cli() { # label binary
  if command -v "$2" >/dev/null 2>&1; then
    report ok "$1" "$("$2" --version 2>/dev/null | head -1)"
  else
    report missing "$1"
  fi
}
check_cli "claude" claude
check_cli "codex"  codex
echo

printf '%d ok, %d outdated, %d unmanaged, %d missing\n' \
  "$counts_ok" "$counts_outdated" "$counts_unmanaged" "$counts_missing"

exit $missing
