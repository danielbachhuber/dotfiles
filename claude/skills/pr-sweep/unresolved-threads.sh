#!/usr/bin/env bash
# Lists unresolved review threads on one PR, and marks each as before or after the last push.
# A thread created before the last push may already be answered; one created after is untouched.
#
# Usage: unresolved-threads.sh <pr-number> [owner/repo]
set -euo pipefail

number="${1:?usage: unresolved-threads.sh <pr-number> [owner/repo]}"

if [[ -n "${2:-}" ]]; then
  owner="${2%%/*}"
  repo="${2##*/}"
else
  read -r owner repo <<<"$(gh repo view --json owner,name --jq '"\(.owner.login) \(.name)"')"
fi

gh api graphql -F owner="$owner" -F repo="$repo" -F number="$number" -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) { nodes { commit { committedDate } } }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          comments(first: 1) {
            nodes { author { login } createdAt path body }
          }
        }
      }
    }
  }
}' --jq '
  .data.repository.pullRequest as $pr
  | ($pr.commits.nodes[0].commit.committedDate // "") as $lastPush
  | [$pr.reviewThreads.nodes[] | select(.isResolved == false) | .comments.nodes[0] + {outdated: .isOutdated}] as $open
  | "last push: \($lastPush)",
    "\($open | length) unresolved thread(s):",
    ($open[]
      | "  \(if .createdAt > $lastPush then "AFTER-PUSH " else "before-push" end)  \(.author.login)  \(.path)\(if .outdated then " (outdated)" else "" end)\n    \(.body | split("\n")[0][0:100])")
'
