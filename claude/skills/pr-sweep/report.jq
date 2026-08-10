# Turns `gh pr list` JSON into markdown table rows, worst problem first.
# Only PRs needing attention produce a row.

def bad: ["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"];

# Titles longer than this wrap in a terminal and break the table.
def trunc(n): if (. | length) > n then (.[0:n] + "…") else . end;

[
  .[]
  | [.statusCheckRollup[]?] as $checks
  | [$checks[] | (.conclusion // .state // "") as $c | select(bad | index($c))] as $failing
  | [$checks[] | select((.status != null and .status != "COMPLETED") or .state == "PENDING" or .state == "EXPECTED")] as $pending
  | [$checks[] | select(.conclusion == "CANCELLED")] as $cancelled
  # Both signals are needed. reviewDecision misses comment-only reviews; latestReviews misses a
  # reviewer who was re-requested after asking for changes.
  | ([.latestReviews[]? | .state]) as $states
  # A review that still stands and wants something.
  | (($states | index("CHANGES_REQUESTED")) or ($states | index("COMMENTED"))) as $liveFeedback
  # Changes were requested, that review no longer stands, and a reviewer is on the hook again: the
  # ball is with the reviewer, so this is not the user's work. reviewDecision stays
  # CHANGES_REQUESTED until a new review lands, so it cannot tell the two apart on its own.
  | (.reviewDecision == "CHANGES_REQUESTED"
      and ($liveFeedback | not)
      and ((.reviewRequests | length) > 0)) as $awaitingRereview
  | ($liveFeedback or (.reviewDecision == "CHANGES_REQUESTED" and ($awaitingRereview | not))) as $hasFeedback
  | [
      (if (.mergeable == "CONFLICTING" or .mergeStateStatus == "DIRTY") then "merge conflict" else empty end),
      (if (.mergeable == "UNKNOWN") then "mergeability unknown" else empty end),
      (if ($failing | length) > 0 then "CI failing" else empty end),
      (if $hasFeedback then (if .reviewDecision == "CHANGES_REQUESTED" then "changes requested" else "reviewer comments" end) else empty end),
      (if ($cancelled | length) > 0 then "CI cancelled" else empty end),
      (if ($pending | length) > 0 then "CI pending" else empty end),
      (if ($checks | length) == 0 then "no checks ran" else empty end),
      (if (.isDraft == false and (.reviewRequests | length) == 0 and (.latestReviews | length) == 0) then "no reviewer" else empty end)
    ] as $needs
  | select($needs | length > 0)
  | {
      rank: (
        if (.mergeable == "CONFLICTING" or .mergeStateStatus == "DIRTY") then 0
        elif ($failing | length) > 0 then 1
        elif $hasFeedback then 2
        elif (($cancelled | length) + ($pending | length)) > 0 then 3
        else 4 end
      ),
      row: "| [#\(.number)](\(.url)) | \(.title | trunc(45)) | \($needs | join(", "))\(if .isDraft then " (draft)" else "" end) |"
    }
]
| sort_by(.rank)
| .[].row
