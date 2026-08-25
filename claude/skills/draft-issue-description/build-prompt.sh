#!/usr/bin/env bash
# Assemble the codex prompt: house style, the task, then the brief.
#
#   build-prompt.sh <brief.md> <draft-out.md> [prompt-out]
#
# <draft-out.md> is where codex will write the issue body. Prints the prompt path, then a
# manifest on stderr.
#
# Unlike pull requests, this repo documents no issue format, so the format lives in
# instructions.md rather than being read from the repo.
#
# Overrides: CLAUDE_MD=/path/to/CLAUDE.md   REPO=/path/to/repo
set -euo pipefail

BRIEF="${1:?usage: build-prompt.sh <brief.md> <draft-out.md> [prompt-out]}"
DRAFT="${2:?usage: build-prompt.sh <brief.md> <draft-out.md> [prompt-out]}"
OUT="${3:-/tmp/issue-description-prompt.md}"
SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="${CLAUDE_MD:-$HOME/.claude/CLAUDE.md}"
REPO="${REPO:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

{
    echo "# House style"
    echo
    echo "The rules below are the author's own style guide. The issue must follow them."
    echo
    if [ -f "$RULES" ]; then
        awk '/^## Writing$/{f=1} f && /^## / && !/^## Writing$/{exit} f' "$RULES"
        echo
        awk '/^## GitHub Issues$/{f=1} f && /^## / && !/^## GitHub Issues$/{exit} f' "$RULES"
    else
        echo "(No style guide at $RULES. Write plainly: active voice, no filler, no em dashes.)"
    fi

    echo
    cat "$SKILL/instructions.md"
    echo
    echo "## Output path"
    echo
    echo "Write the description to this exact path:"
    echo
    echo "    $DRAFT"
    echo
    echo "# Brief"
    echo
    cat "$BRIEF"
} > "$OUT"

echo "$OUT"
{
    echo "style guide : ${RULES}$([ -f "$RULES" ] || echo ' (missing)')"
    echo "repo        : $REPO"
    echo "brief       : $BRIEF ($(wc -l < "$BRIEF" | tr -d ' ') lines)"
    echo "draft out   : $DRAFT"
} >&2
