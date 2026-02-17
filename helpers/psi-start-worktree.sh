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

# Hide worktree-generated files from git status. Git does not read info/exclude
# in worktree admin dirs, so use .gitignore and assume-unchanged on it.
echo "Adding worktree-specific generated files to git exclude"
echo "\n" >> .gitignore
for entry in "mprocs.worktree.yaml" "scripts/run-client-worktree.sh" "scripts/run-storybook-worktree.sh"; do
    grep -qFx "$entry" .gitignore 2>/dev/null || echo "$entry" >> .gitignore
done
if git ls-files --error-unmatch .gitignore &>/dev/null; then
    git update-index --assume-unchanged .gitignore
fi

echo "Setting up Claude Code"
claude mcp add --transport http figma https://mcp.figma.com/mcp || true
cp "$PSI_PROJECT_DIR/.claude/settings.local.json" "$WORKTREE_DIR/.claude/settings.local.json"

echo "Copying necessary ignored files"
cp "$PSI_PROJECT_DIR/server/.env" "$WORKTREE_DIR/server/.env"

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

exec $SHELL
