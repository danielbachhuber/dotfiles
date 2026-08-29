# Shared by setup.sh and check.sh. Not executable on its own.
#
# `npm` on the default PATH is not nvm's. /Users/.../.local/bin/npm is a
# symlink into another tool's bundled Node, and it wins because zshrc prepends
# ~/.local/bin last. Its global root is ~/.local/lib/node_modules, while the
# packages in npm-globals.txt live under nvm's Node.
#
# So neither script may use whichever npm it happens to find: setup.sh would
# install into the wrong root and check.sh would report everything missing.
# nvm is a shell function rather than a binary, hence the source.
use_nvm_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    return 1
  fi

  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || return 1
  nvm use default >/dev/null 2>&1 || return 1
}
