#!/bin/bash
# Default-deny outbound firewall for the PSI dev container.
#
# Applied at container start (postStartCommand in devcontainer.json) so that
# `claude --dangerously-skip-permissions` can run unattended: anything Claude
# does can only reach the allowlisted hosts below.
#
# Allowlisting is driven by dnsmasq rather than a static IP snapshot. dnsmasq
# runs as the container's resolver and, via its `ipset=` directives, adds the
# resolved IPs of the allowed domains (and their subdomains) to the
# `allowed-domains` ipset as they are looked up. iptables then permits egress
# only to that set. Because the set is populated from live DNS, CDN-backed hosts
# whose IPs rotate (e.g. nodejs.org behind Cloudflare) stay reachable, and a
# transient DNS hiccup at startup no longer permanently drops a domain — it is
# re-added on the next lookup. The ipset remains the kernel enforcement target
# (a pure DNS allowlist wouldn't stop a process from dialing a raw IP).
#
# To allow another host: add it to ALLOWED_DOMAINS below and recreate the
# container (devcontainer up --remove-existing-container, or "Rebuild Container").
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# Domains allowed out of the container. dnsmasq matches each entry AND all of its
# subdomains, so e.g. github.com also covers api.github.com / codeload.github.com.
ALLOWED_DOMAINS=(
    github.com               # git + gh + api/codeload/uploads.github.com
    githubusercontent.com    # objects/raw/avatars.githubusercontent.com
    registry.npmjs.org
    nodejs.org               # pnpm devEngines downloads a managed Node (husky hooks)
    anthropic.com            # api.anthropic.com + statsig.anthropic.com
    sentry.io
    statsig.com
    marketplace.visualstudio.com
    vscode.blob.core.windows.net
    update.code.visualstudio.com
    fonts.googleapis.com
    fonts.gstatic.com
    exp.host
    expo.dev                 # api/u/cdn.expo.dev
    # --- Optional: add for firebase-tools / gcloud auth + deploy, then rebuild ---
    # googleapis.com accounts.google.com
)

# Republish the forwarded host SSH agent on a node-owned socket. The forwarded
# socket (mounted at /ssh-agent-host via devcontainer.json) is owned by the host
# uid and unreadable by the unprivileged node user; this script runs as root, so
# socat can bridge it to /ssh-agent (SSH_AUTH_SOCK) for ssh/git. The private key
# never enters the container — only signing is forwarded. Unix-socket only, so
# the firewall rules below don't affect it. No-op when no agent is forwarded.
SSH_AGENT_HOST_SOCK=/ssh-agent-host
SSH_AGENT_NODE_SOCK=/ssh-agent
if [ -S "$SSH_AGENT_HOST_SOCK" ]; then
    rm -f "$SSH_AGENT_NODE_SOCK"
    setsid socat "UNIX-LISTEN:$SSH_AGENT_NODE_SOCK,fork,user=node,mode=600" "UNIX-CONNECT:$SSH_AGENT_HOST_SOCK" >/dev/null 2>&1 &
    echo "SSH agent republished at $SSH_AGENT_NODE_SOCK"
else
    echo "No forwarded SSH agent at $SSH_AGENT_HOST_SOCK; skipping agent proxy"
fi

# Capture the upstream resolver(s) and host.docker.internal's address BEFORE we
# repoint resolv.conf at dnsmasq. dnsmasq forwards to the same upstream the
# container already used (e.g. OrbStack's 0.250.250.200), so internal names keep
# resolving; host.docker.internal's IP is allowlisted directly below so the Figma
# desktop MCP on host.docker.internal:3845 stays reachable.
UPSTREAM_NS=$(awk '/^nameserver/ {print $2}' /etc/resolv.conf | tr '\n' ' ')
HOST_INTERNAL_IP=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1; exit}' || true)
echo "Upstream resolver(s): ${UPSTREAM_NS:-<none>}; host.docker.internal: ${HOST_INTERNAL_IP:-<none>}"

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# Allow DNS (to the upstream resolver), SSH, and localhost before any restrictions.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Create the ipset dnsmasq will populate (CIDR-capable).
ipset create allowed-domains hash:net

# Configure dnsmasq: forward to the captured upstream, listen only on loopback,
# and add each allowed domain's resolved IPs to the ipset. Then point the
# container's resolver at dnsmasq so every lookup flows through it.
{
    echo "no-resolv"
    for ns in $UPSTREAM_NS; do echo "server=$ns"; done
    echo "listen-address=127.0.0.1"
    echo "bind-interfaces"
    for domain in "${ALLOWED_DOMAINS[@]}"; do echo "ipset=/$domain/allowed-domains"; done
} > /etc/dnsmasq.d/allowlist.conf
echo "Starting dnsmasq..."
pkill -x dnsmasq 2>/dev/null || true
sleep 0.2
dnsmasq --conf-file=/etc/dnsmasq.d/allowlist.conf
printf 'nameserver 127.0.0.1\n' > /etc/resolv.conf

# Allowlist host.docker.internal directly — its IP isn't learned via the domain
# lookups above, and it usually sits outside the host /24 below.
if [ -n "$HOST_INTERNAL_IP" ]; then
    ipset add -exist allowed-domains "$HOST_INTERNAL_IP"
    echo "Allowlisted host.docker.internal ($HOST_INTERNAL_IP)"
fi

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

# Allow the whole host /24. Needed for the VS Code server, the Figma desktop MCP
# on host.docker.internal:3845, and forwarded ports. This means a sandboxed
# Claude could reach other services on the host LAN — an accepted tradeoff.
HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow established connections, then only the dnsmasq-populated allowlist;
# REJECT everything else for immediate feedback.
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

# Verify GitHub API access (also confirms dnsmasq is populating the ipset).
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
