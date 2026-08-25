#!/usr/bin/env bash
# Print a SHA-pinned GitHub permalink for a file, so the reference still points at the code
# the issue was written about after the branch moves.
#
#   permalink.sh <path> [line[-line]] [ref]
#   permalink.sh client/component/constructor.tsx 22
#   permalink.sh client/util/legacy-comment.ts 29-34
#   permalink.sh docs/architecture/api-v2/endpoints-to-remove.md
#
# Resolves <ref> (default origin/HEAD, falling back to HEAD) to a full commit SHA. A branch
# name or a tag in a permalink rots; a SHA does not.
set -euo pipefail

FILE="${1:?usage: permalink.sh <path> [line[-line]] [ref]}"
LINES="${2:-}"
REF="${3:-}"

if [ -z "$REF" ]; then
    REF="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo HEAD)"
fi
SHA="$(git rev-parse "$REF")"
SLUG="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

# Warn rather than fail: a path may be new on this branch and still worth linking.
if ! git cat-file -e "$SHA:$FILE" 2>/dev/null; then
    echo "warning: $FILE does not exist at $REF ($SHA) — link will 404" >&2
fi

ANCHOR=""
if [ -n "$LINES" ]; then
    case "$LINES" in
        *-*) ANCHOR="#L${LINES%%-*}-L${LINES##*-}" ;;
        *)   ANCHOR="#L$LINES" ;;
    esac
fi

printf 'https://github.com/%s/blob/%s/%s%s\n' "$SLUG" "$SHA" "$FILE" "$ANCHOR"
