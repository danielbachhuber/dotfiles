#!/bin/bash
#
# Reproduce the installed packages and applications on a new machine.
#
# Run ./check.sh to report what is installed without changing anything.
#
# The App Store section of the Brewfile needs you to be signed in to the App
# Store first. `mas` cannot sign in for you, and will fail on those lines.
# See README.md for what this script cannot install at all.

set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# shellcheck source=node.sh
. "$DIR/node.sh"

read_list() {
  grep -v '^[[:space:]]*#' "$1" | grep -v '^[[:space:]]*$'
}

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not on PATH. Install it first: https://brew.sh" >&2
  exit 1
fi

# --- Homebrew ----------------------------------------------------------------
# Homebrew 6 refuses to load formulae from an untrusted third-party tap, and a
# Brewfile cannot express trust. Trusting each tap the Brewfile names has to
# happen first or `brew bundle` fails on those formulae.
while read -r tap; do
  echo "==> trusting $tap"
  brew trust --tap "$tap"
done < <(grep '^tap "' "$DIR/Brewfile" | sed 's/^tap "\([^"]*\)".*/\1/')

echo "==> brew bundle"
brew bundle install --file "$DIR/Brewfile"

# --- npm globals -------------------------------------------------------------
# nvm is a prerequisite rather than something installed here: its installer
# appends to the shell rc, and ~/.zshrc is a symlink into this repository, so
# running it from here would edit a tracked file. See README.md.
#
# This step is skipped rather than falling back to whatever npm is on PATH.
# That npm is usually not nvm's, and installing into its global root would put
# these packages somewhere nothing looks for them.
if use_nvm_node; then
  echo "==> npm globals into $(npm root -g)"
  # shellcheck disable=SC2046
  npm install -g $(read_list "$DIR/npm-globals.txt" | tr '\n' ' ')
else
  echo "==> skipping npm globals: nvm is not installed." >&2
  echo "    See README.md, then re-run." >&2
fi

# --- Agent CLIs --------------------------------------------------------------
# Claude Code and Codex keep versioned installs under $HOME and update
# themselves. Homebrew has casks for both, but a brew-managed copy fights the
# tool's own updater and trails it: when this was written the claude-code cask
# was on 2.1.236 against the 2.1.250 the installer gives you. So both come from
# their vendor's install script instead.
#
# The two scripts want different shells: Anthropic's is #!/bin/bash and is
# documented as `| bash`, OpenAI's as `| sh`.
#
# Already-installed CLIs are left alone. Use the tool's own update command
# rather than re-running the installer.
install_cli() {
  local label="$1" bin="$2" url="$3" shell="$4"

  if command -v "$bin" >/dev/null 2>&1; then
    echo "==> $label already installed, skipping"
    return
  fi

  echo "==> $label"
  curl -fsSL "$url" | "$shell"
}

install_cli "Claude Code" claude https://claude.ai/install.sh          bash
install_cli "Codex"       codex  https://chatgpt.com/codex/install.sh  sh

echo "done. Run ./check.sh to confirm, and see README.md for what must"
echo "still be installed by hand."
