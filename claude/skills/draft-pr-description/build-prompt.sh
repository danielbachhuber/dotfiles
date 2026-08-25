#!/usr/bin/env bash
# Assemble the codex prompt: house style, the repo's PR format, the task, then the brief.
#
#   build-prompt.sh <brief.md> <draft-out.md> [prompt-out]
#
# <draft-out.md> is where codex will write the description. Prints the prompt path, then a
# manifest on stderr so the caller can see whether a repo format document was found.
#
# Overrides: CLAUDE_MD=/path/to/CLAUDE.md   REPO=/path/to/repo
set -euo pipefail

BRIEF="${1:?usage: build-prompt.sh <brief.md> <draft-out.md> [prompt-out]}"
DRAFT="${2:?usage: build-prompt.sh <brief.md> <draft-out.md> [prompt-out]}"
OUT="${3:-/tmp/pr-description-prompt.md}"
SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="${CLAUDE_MD:-$HOME/.claude/CLAUDE.md}"
REPO="${REPO:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"

# A repo that documents its own PR format outranks anything this skill would invent.
FORMAT_DOC=""
for candidate in \
    "docs/contributing/writing-pr-descriptions.md" \
    "docs/contributing/pull-requests.md" \
    "CONTRIBUTING.md"; do
    if [ -f "$REPO/$candidate" ]; then
        FORMAT_DOC="$REPO/$candidate"
        break
    fi
done
TEMPLATE=""
for candidate in \
    ".github/pull_request_template.md" \
    ".github/PULL_REQUEST_TEMPLATE.md" \
    "docs/pull_request_template.md"; do
    if [ -f "$REPO/$candidate" ]; then
        TEMPLATE="$REPO/$candidate"
        break
    fi
done

{
    echo "# House style"
    echo
    echo "The rules below are the author's own style guide. The description must follow them."
    echo
    if [ -f "$RULES" ]; then
        # The "## Writing" section, up to the next second-level heading.
        awk '/^## Writing$/{f=1} f && /^## / && !/^## Writing$/{exit} f' "$RULES"
    else
        echo "(No style guide at $RULES. Write plainly: active voice, no filler, no em dashes.)"
    fi

    echo
    echo "# Target format"
    echo
    if [ -n "$FORMAT_DOC" ]; then
        echo "This repository documents its own PR description format. Follow it exactly."
        echo
        cat "$FORMAT_DOC"
    else
        echo "This repository documents no PR format. Use these sections, omitting any with"
        echo "nothing real to say: Summary, Background, Approach, Changes, Decisions, Testing."
    fi

    if [ -n "$TEMPLATE" ]; then
        echo
        echo "# Repository pull request template"
        echo
        echo "Use these section headings. Omit a section rather than padding it."
        echo
        cat "$TEMPLATE"
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
    echo "format doc  : ${FORMAT_DOC:-none found}"
    echo "template    : ${TEMPLATE:-none found}"
    echo "brief       : $BRIEF ($(wc -l < "$BRIEF" | tr -d ' ') lines)"
    echo "draft out   : $DRAFT"
} >&2
