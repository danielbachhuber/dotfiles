#!/bin/bash

# Script to create a git worktree, start client and Storybook, and open editor
# Usage: psi-start-worktree.sh <branch-name>

set -e

PSI_PROJECT_DIR="$HOME/projects/psi-product"

# Check if branch name is provided
if [ -z "$1" ]; then
    echo "Error: Branch name required"
    echo "Usage: $0 <branch-name>"
    exit 1
fi

BRANCH_NAME="$1"
# Sanitize branch name for directory and file names (replace / with -)
SAFE_BRANCH_NAME="${BRANCH_NAME//\//-}"
WORKTREE_DIR="$HOME/projects/psi-product-$SAFE_BRANCH_NAME"

# Function to find an available port
find_available_port() {
    local start_port=$1
    local port=$start_port
    while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do
        ((port++))
    done
    echo $port
}

# Navigate to main project directory
cd "$PSI_PROJECT_DIR"

# Check if branch exists locally
if git show-ref --verify --quiet refs/heads/"$BRANCH_NAME"; then
    echo "Branch $BRANCH_NAME exists locally, reusing it"
    BRANCH_EXISTS=true
else
    # Check if branch exists on remote
    if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
        echo "Branch $BRANCH_NAME exists on remote, fetching it"
        git fetch origin "$BRANCH_NAME:$BRANCH_NAME"
        BRANCH_EXISTS=true
    else
        echo "Branch $BRANCH_NAME does not exist, will create it"
        BRANCH_EXISTS=false
    fi
fi

# Create worktree
if [ -d "$WORKTREE_DIR" ]; then
    echo "Worktree directory $WORKTREE_DIR already exists"
else
    if [ "$BRANCH_EXISTS" = true ]; then
        echo "Creating worktree for existing branch $BRANCH_NAME"
        git worktree add "$WORKTREE_DIR" "$BRANCH_NAME"
    else
        echo "Creating worktree with new branch $BRANCH_NAME"
        git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR"
    fi
fi

# Change to worktree directory
cd "$WORKTREE_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Find available ports
CLIENT_PORT=$(find_available_port 19006)
STORYBOOK_PORT=$(find_available_port 6006)

echo "Will use client port: $CLIENT_PORT"
echo "Will use Storybook port: $STORYBOOK_PORT"

# Create custom mprocs config for this worktree
cat > mprocs.worktree.yaml <<EOF
procs:
  client:
    shell: ./scripts/run-client-worktree.sh
  storybook:
    shell: ./scripts/run-storybook-worktree.sh
EOF

# Create custom client runner script with dynamic port
cat > scripts/run-client-worktree.sh <<EOF
#!/bin/bash
trap 'kill -TERM -\$pid 2>/dev/null; kill -KILL -\$pid 2>/dev/null; exit' SIGTERM SIGINT

export BROWSER=none
cd client && pnpm expo start --web --port $CLIENT_PORT & pid=\$!; wait \$pid
EOF
chmod +x scripts/run-client-worktree.sh

# Create custom storybook runner script with dynamic port
cat > scripts/run-storybook-worktree.sh <<EOF
#!/bin/bash
trap 'kill -TERM -\$pid 2>/dev/null; kill -KILL -\$pid 2>/dev/null; exit' SIGTERM SIGINT

cd client && pnpm storybook --no-open --port $STORYBOOK_PORT & pid=\$!; wait \$pid
EOF
chmod +x scripts/run-storybook-worktree.sh

echo "Setting up Claude Code"
claude mcp add --transport http figma https://mcp.figma.com/mcp || true
cp "$PSI_PROJECT_DIR/.claude/settings.local.json" "$WORKTREE_DIR/.claude/settings.local.json"

# Generate a sandboxed devcontainer for this worktree from the default kept in
# dotfiles, so Claude can run with --dangerously-skip-permissions inside it: the
# image carries the PSI toolchain and init-firewall.sh applies a default-deny
# outbound allowlist, limiting the blast radius to this container.
#
# The dotfiles dir is the source of truth (Dockerfile, init-firewall.sh,
# devcontainer.json). We copy those into the worktree's .devcontainer/ and stamp
# a distinct name so containers are distinguishable in the UI. Host ports don't
# need pre-assigning: VS Code forwards the container's loopback ports and
# auto-picks a free host port when one is taken, so several worktree containers
# can run at once. PSI_GITHUB_TOKEN is passed through from the host shell via
# devcontainer.json's containerEnv.
echo "Setting up devcontainer"
DEVCONTAINER_SRC="$HOME/.dotfiles/claude/psi-devcontainer"
if [ -d "$DEVCONTAINER_SRC" ]; then
    mkdir -p "$WORKTREE_DIR/.devcontainer"
    cp "$DEVCONTAINER_SRC/Dockerfile" "$WORKTREE_DIR/.devcontainer/Dockerfile"
    cp "$DEVCONTAINER_SRC/init-firewall.sh" "$WORKTREE_DIR/.devcontainer/init-firewall.sh"
    jq --arg name "PSI: $BRANCH_NAME" '.name = $name' \
        "$DEVCONTAINER_SRC/devcontainer.json" > "$WORKTREE_DIR/.devcontainer/devcontainer.json"
    # The repo ignores .devcontainer/devcontainer.json but not the copied
    # Dockerfile/init-firewall.sh; add them to this worktree's local git
    # excludes so they don't clutter `git status`.
    EXCLUDE_FILE="$(git -C "$WORKTREE_DIR" rev-parse --git-path info/exclude)"
    case "$EXCLUDE_FILE" in
        /*) : ;;
        *) EXCLUDE_FILE="$WORKTREE_DIR/$EXCLUDE_FILE" ;;
    esac
    mkdir -p "$(dirname "$EXCLUDE_FILE")"
    for pattern in ".devcontainer/Dockerfile" ".devcontainer/init-firewall.sh"; do
        grep -qxF "$pattern" "$EXCLUDE_FILE" 2>/dev/null || echo "$pattern" >> "$EXCLUDE_FILE"
    done
    echo "  Created .devcontainer/ from $DEVCONTAINER_SRC (name: PSI: $BRANCH_NAME)"
    if [ -z "${PSI_GITHUB_TOKEN:-}" ]; then
        echo "  WARNING: PSI_GITHUB_TOKEN is not set in this shell; git/gh inside the container won't be authenticated"
    fi
else
    echo "  Skipped: $DEVCONTAINER_SRC not found"
fi

echo "Copying necessary ignored files"
cp "$PSI_PROJECT_DIR/server/.env" "$WORKTREE_DIR/server/.env"

echo "Setting up e2e-tests/.env"
cp "$WORKTREE_DIR/e2e-tests/.env.local.example" "$WORKTREE_DIR/e2e-tests/.env"
# Point the e2e tests at this worktree's client port (the server is shared with the main repo).
sed -i '' "s|^CLIENT_BASE_URL=.*|CLIENT_BASE_URL=http://localhost:$CLIENT_PORT|" "$WORKTREE_DIR/e2e-tests/.env"
# The e2e tests must authenticate with the same PUPPET_SECRET the server is running with.
SERVER_PUPPET_SECRET=$(grep -E "^PUPPET_SECRET=" "$WORKTREE_DIR/server/.env" | cut -d'=' -f2- | tr -d "'\"")
if [ -n "$SERVER_PUPPET_SECRET" ]; then
    sed -i '' "s|^PUPPET_SECRET=.*|PUPPET_SECRET=$SERVER_PUPPET_SECRET|" "$WORKTREE_DIR/e2e-tests/.env"
fi

echo "Build shared packages"
(cd packages/shared && pnpm build)

echo ""
echo "Worktree setup complete!"
echo "  Branch: $BRANCH_NAME"
echo "  Directory: $WORKTREE_DIR"
echo "  Client: http://localhost:$CLIENT_PORT"
echo "  Storybook: http://localhost:$STORYBOOK_PORT"
echo ""
echo "Run mprocs to start the client and Storybook:"
echo "  mprocs -c mprocs.worktree.yaml"
echo ""
echo "Sandboxed devcontainer (run from $WORKTREE_DIR; Claude runs with --dangerously-skip-permissions inside):"
echo "  Build/start:  devcontainer up --workspace-folder ."
echo "  Rebuild:      devcontainer up --workspace-folder . --remove-existing-container"
echo "  Run Claude:   devcontainer exec --workspace-folder . claude --dangerously-skip-permissions"
echo "  Shell:        devcontainer exec --workspace-folder . bash"
echo "  Or in your editor: \"Reopen in Container\", then run 'claude' in a container terminal."
echo ""

# If launched from a Cursor terminal, open the worktree as a project
if [ "$TERM_PROGRAM" = "vscode" ] && command -v cursor >/dev/null 2>&1; then
    cursor "$WORKTREE_DIR"          # new window, focused on the worktree
    # cursor -r "$WORKTREE_DIR"     # ...or repoint THIS window (reloads it, ends this terminal)
fi

exec $SHELL
