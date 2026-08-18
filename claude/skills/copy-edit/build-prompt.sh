#!/usr/bin/env bash
# Assemble the codex prompt: house writing rules, then the copy-edit brief, then the text to edit.
#
#   build-prompt.sh <file-to-edit> [prompt-out]
#
# Prints the path it wrote. Override the style guide with CLAUDE_MD=/path/to/CLAUDE.md.
set -euo pipefail

TARGET="${1:?usage: build-prompt.sh <file-to-edit> [prompt-out]}"
OUT="${2:-/tmp/copy-edit-prompt.md}"
SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="${CLAUDE_MD:-$HOME/.claude/CLAUDE.md}"

{
    echo "# House style"
    echo
    echo "The rules below are the author's own style guide. The copy edit must follow them."
    echo

    if [ -f "$RULES" ]; then
        # The "## Writing" section, up to the next second-level heading.
        awk '/^## Writing$/{f=1} f && /^## / && !/^## Writing$/{exit} f' "$RULES"
    else
        echo "(No style guide found at $RULES. Edit for clarity and brevity.)"
    fi

    echo
    cat "$SKILL/instructions.md"
    echo
    cat "$TARGET"
} > "$OUT"

echo "$OUT"
