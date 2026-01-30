#!/bin/bash

# Script to delete a git worktree and stop its services
# Usage: psi-delete-worktree.sh [branch-name]
#        When run from inside a worktree directory, branch-name is optional.

set -e

PSI_PROJECT_DIR="$HOME/projects/psi-product"

# Determine worktree to delete: from argument or current directory
if [ -n "$1" ]; then
    BRANCH_NAME="$1"
    SAFE_BRANCH_NAME="${BRANCH_NAME//\//-}"
    WORKTREE_DIR="$HOME/projects/psi-product-$SAFE_BRANCH_NAME"
else
    CURRENT_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || true
    if [ -z "$CURRENT_TOPLEVEL" ]; then
        echo "Error: Branch name required (not inside a git repository)"
        echo "Usage: $0 [branch-name]"
        exit 1
    fi
    if [ "$CURRENT_TOPLEVEL" = "$PSI_PROJECT_DIR" ]; then
        echo "Error: You are in the main repository, not a worktree. Specify branch name to delete."
        echo "Usage: $0 <branch-name>"
        exit 1
    fi
    if git -C "$PSI_PROJECT_DIR" worktree list | grep -q "$CURRENT_TOPLEVEL"; then
        WORKTREE_DIR="$CURRENT_TOPLEVEL"
    else
        echo "Error: Current directory is not a worktree of $PSI_PROJECT_DIR. Specify branch name."
        echo "Usage: $0 <branch-name>"
        exit 1
    fi
fi

# Remove worktree if it exists
if [ -d "$WORKTREE_DIR" ]; then
    echo "Removing worktree at $WORKTREE_DIR"
    cd "$PSI_PROJECT_DIR"
    git worktree remove "$WORKTREE_DIR" --force
    echo "Worktree removed"
else
    echo "Worktree directory not found at $WORKTREE_DIR"
fi

cd "$PSI_PROJECT_DIR"

echo ""
echo "Cleanup complete!"

exec $SHELL