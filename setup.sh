#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

ln -sf $DIR/zshrc $DIR/../.zshrc
ln -sf $DIR/vim $DIR/../.vimrc
ln -sf $DIR/bashrc $DIR/../.bashrc
