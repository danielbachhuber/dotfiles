# Default PSI dev-container image: the psi-product toolchain wrapped in the
# psi-workflow-viz network sandbox so `claude --dangerously-skip-permissions`
# can run unattended with the blast radius limited to this container.
#
# Layers, in order:
#   1. PSI toolchain (Node 22, Temurin JDK, gcloud, gh, Chromium, Playwright,
#      and the node-user pnpm globals: firebase-tools, expo, mprocs, claude).
#   2. Sandbox tooling (sudo, iptables/ipset/iproute2/dnsutils/aggregate) plus
#      the init-firewall.sh script and a NOPASSWD sudoers entry so the
#      unprivileged `node` user can apply the firewall at container start.
#
# This file is the source of truth in ~/.dotfiles/claude/psi-devcontainer/; `wts`
# copies it into each worktree's .devcontainer/ alongside init-firewall.sh.

FROM node:22-bookworm-slim

SHELL ["/bin/bash", "-c"]

ENV PNPM_HOME="/home/node/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
ENV DISABLE_TELEMETRY=1
# Helps tools (and Claude) orient that they're inside the dev container.
ENV DEVCONTAINER=true

WORKDIR /app

RUN apt-get update

# Temurin JDK (Firebase emulators need a JVM).
# https://adoptium.net/installation/linux#deb-installation-on-debian-or-ubuntu
RUN apt-get install -y wget apt-transport-https gpg
RUN wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null
RUN echo "deb https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list
# must run apt-get update again to get packages from adoptium repository
RUN apt-get update && apt-get install -y temurin-21-jdk

# Generally useful on the command line and for agents.
# coreutils provides sleep, which devcontainers require.
RUN apt-get install -y curl jq git coreutils procps tmux
# xdg-utils added because storybook complains on startup without it present (used for opening links in default browser)
RUN apt-get install -y xdg-utils
# lsof is used by server-emulate process
RUN apt-get install -y lsof
RUN apt-get update && apt-get install -y chromium

# Sandbox tooling: sudo + the networking utilities init-firewall.sh relies on.
RUN apt-get install -y sudo iptables ipset iproute2 dnsutils aggregate

# github cli client
# https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian
RUN (type -p wget >/dev/null || (apt-get install wget -y)) \
	&& mkdir -p -m 755 /etc/apt/keyrings \
	&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
	&& cat $out | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
	&& chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& mkdir -p -m 755 /etc/apt/sources.list.d \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
	&& apt-get update && apt-get install gh -y

# gcloud cli
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
	| tee /etc/apt/sources.list.d/google-cloud-sdk.list \
	&& curl https://packages.cloud.google.com/apt/doc/apt-key.gpg \
	| gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
	&& apt-get update -y \
	&& apt-get install google-cloud-cli -y

# Persist shell history across container rebuilds (mounted as a volume in
# devcontainer.json). Owned by node so the unprivileged user can write to it.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
	&& mkdir /commandhistory \
	&& touch /commandhistory/.bash_history \
	&& chown -R node /commandhistory \
	&& echo "$SNIPPET" >> /home/node/.bashrc

# Install the firewall script and let the node user run it (and only it) via
# passwordless sudo. devcontainer.json invokes it as postStartCommand.
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh \
	&& echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall \
	&& chmod 0440 /etc/sudoers.d/node-firewall

RUN corepack enable
# Playwright's --with-deps flag tries to use su to switch to root for installing
# system dependencies, but user 1000 doesn't have a password set. So we install
# Playwright's system deps separately.
RUN npx -y playwright@1.58.2 install-deps chromium
USER 1000
# Necessary because pnpm doesn't know where to put global binaries as user 1000;
# the user doesn't have a proper home directory configured.
RUN mkdir -p $PNPM_HOME
RUN corepack prepare pnpm@11.1.2 --activate
RUN pnpm add -g firebase-tools@15.2.1 @expo/cli typescript@5.9.3 mprocs@0.8.2 @anthropic-ai/claude-code@2.1.6
RUN pnpm dlx playwright@1.58.2 install chromium
CMD ["/bin/bash"]

EXPOSE 3000 4000 4500 5001 5002 5010 6006 8081 9001 9099 19000 19001 19006
