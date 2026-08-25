#!/usr/bin/env bash
# Print the PR diff-view URL for a file, so a reviewer lands on what changed rather than on
# the whole file.
#
#   difflink.sh <pr-number> <path> [new-side-line]
#   difflink.sh 5765 .github/workflows/e2e.yml 32
#
# The anchor is the SHA-256 of the repo-relative path, which is how GitHub names diff
# hunks. Pass a line number to land on that line of the new side.
set -euo pipefail

PR="${1:?usage: difflink.sh <pr-number> <path> [line]}"
PATH_ARG="${2:?usage: difflink.sh <pr-number> <path> [line]}"
LINE="${3:-}"

SLUG="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
HASH="$(printf '%s' "$PATH_ARG" | shasum -a 256 | cut -d' ' -f1)"

printf 'https://github.com/%s/pull/%s/changes#diff-%s%s\n' \
    "$SLUG" "$PR" "$HASH" "${LINE:+R$LINE}"
