set nocompatible
filetype off
set rtp+=~/.vim/bundle/vundle/
call vundle#rc()

" This is the Vundle package, which can be found on GitHub.
" For GitHub repos, you specify plugins using the
" 'user/repository' format
Plugin 'gmarik/vundle'

" We could also add repositories with a ".git" extension
" Plugin 'scrooloose/nerdtree.git'

" To get plugins from Vim Scripts, you can reference the plugin
" by name as it appears on the site
" Plugin 'Buffergator'

" Now we can turn our filetype functionality back on
filetype plugin indent on

" Enable syntax highlighting
syntax on

" Colorscheme
colorscheme flattr

" Make backup more flexible
set backup
set backupdir=~/.vim/tmp
set directory=~/.vim/tmp

" Indentation / formatting
set smartindent
