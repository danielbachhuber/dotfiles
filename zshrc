#!/bin/zsh

autoload -U add-zsh-hook

# Path to your oh-my-zsh installation.
export ZSH=$HOME/.oh-my-zsh

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
ZSH_CUSTOM=$HOME/.dotfiles/oh-my-zsh-themes
ZSH_THEME="dannybachhuber"

# Autoload .nvmrc files.
NVM_AUTOLOAD=1

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
DISABLE_AUTO_TITLE="true"

iterm_tab_title() {
  echo -ne "\e]0;${PWD##*/}\a"
}
add-zsh-hook precmd iterm_tab_title

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
if [[ $OSTYPE == *"darwin"* ]]
then
	plugins=(git macos autojump nvm)
else
	plugins=(git autojump)
fi

source $ZSH/oh-my-zsh.sh

# if [[ $OSTYPE == *"darwin"* ]]
# then
# 	export WORKON_HOME=~/.venv
# 	mkdir -p $WORKON_HOME
# 	source /usr/local/bin/virtualenvwrapper.sh
# fi

# User configuration

export PATH=$HOME/bin:/opt/homebrew/bin:/usr/local/opt/:/usr/local/bin:/opt/subversion/bin:/Library/PostgreSQL/9.4/bin:$PATH
# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# ssh
# export SSH_KEY_PATH="~/.ssh/dsa_id"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

### Added by the Heroku Toolbelt
export PATH="/usr/local/heroku/bin:$PATH"

source $HOME/.dotfiles/aliases
source $HOME/.dotfiles/environment

# added by travis gem
[ -f /Users/danielbachhuber/.travis/travis.sh ] && source /Users/danielbachhuber/.travis/travis.sh

export PATH="$HOME/.yarn/bin:$PATH"

export PATH="$HOME/.pyenv/bin:$PATH"
eval "$(pyenv init --path)"
eval "$(pyenv init -)"

export PATH="$HOME/.cargo/bin:$PATH"

export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
export CPPFLAGS="-I/opt/homebrew/opt/openjdk@17/include"

export NVM_DIR="$HOME/.nvm"
unset npm_config_prefix
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
export PATH="/usr/local/opt/curl-openssl/bin:$PATH"
export PATH="/usr/local/opt/openssl/bin:$PATH"
export PATH="$HOME/wp-cli/vendor/bin:$PATH"
export PATH="$HOME/.composer/vendor/bin:$PATH"

alias wp="$HOME/projects/wp-cli-dev/vendor/bin/wp"

# pnpm
export PNPM_HOME="/Users/danielbachhuber/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
# pnpm end

export PATH=$(pyenv root)/shims:$PATH

# Added by LM Studio CLI (lms)
export PATH="$PATH:/Users/danielbachhuber/.lmstudio/bin"
