#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

ln -sf $DIR/zshrc $DIR/../.zshrc
ln -sf $DIR/vimrc $DIR/../.vimrc
rm -rf $DIR/../.vim; ln -sf $DIR/vim $DIR/../.vim
ln -sf $DIR/bashrc $DIR/../.bashrc
mkdir -p $HOME/.config/ghostty/
ln -sf $DIR/ghostty $HOME/.config/ghostty/config

# Git hooks live in the repository rather than in .git/hooks, which is not
# versioned and does not survive a fresh clone. post-merge reports bb artifacts
# a pull left stale; see bb/sync.sh.
git -C "$DIR" config core.hooksPath githooks
