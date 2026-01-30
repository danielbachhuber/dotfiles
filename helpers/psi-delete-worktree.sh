#!/bin/bash

# Script to delete a git worktree and stop its services
# Usage: psi-delete-worktree.sh <branch-name>

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

# Remove worktree if it exists
if [ -d "$WORKTREE_DIR" ]; then
    echo "Removing worktree at $WORKTREE_DIR"
    cd "$PSI_PROJECT_DIR"
    git worktree remove "$WORKTREE_DIR" --force
    echo "Worktree removed"
else
    echo "Worktree directory not found at $WORKTREE_DIR"
fi

echo ""
echo "Cleanup complete!"
