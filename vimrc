set nocompatible
filetype off
" set rtp+=~/.vim/bundle/Vundle/
" call vundle#rc()

" This is the Vundle package, which can be found on GitHub.
" For GitHub repos, you specify plugins using the
" 'user/repository' format
" Plugin 'gmarik/vundle'

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

" Don't make noise
set noerrorbells

" Show statusline
" set laststatus=2
" set statusline=%F%m%r%h%w[%L][%{&ff}]%y[%p%%][%04l,%04v]

" Indentation / formatting
set smartindent
set tabstop=4
set shiftwidth=4
set noexpandtab
" WordPress likes real tabs, so let's assume all php is that way
autocmd FileType php setlocal noexpandtab shiftwidth=4
" Real tabs in JS as well
autocmd FileType js setlocal noexpandtab shiftwidth=4
" Spaces for YML
autocmd FileType yml setlocal noexpandtab shiftwidth=2 tabstop=2
autocmd FileType *.feature setlocal noexpandtab shiftwidth=2 tabstop=2
