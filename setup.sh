#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

ln -sf $DIR/zshrc $DIR/../.zshrc
ln -sf $DIR/vimrc $DIR/../.vimrc
rm -rf $DIR/../.vim; ln -sf $DIR/vim $DIR/../.vim
ln -sf $DIR/bashrc $DIR/../.bashrc
