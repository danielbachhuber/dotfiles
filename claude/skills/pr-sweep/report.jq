# Turns `gh pr list` JSON into markdown table rows for the two tables a sweep prints.
#
# `--arg mode ready` emits the Ready to merge table, six columns wide. Default mode emits the Needs
# attention table and leaves merge-ready PRs out, so no PR appears twice. The readiness rule lives
# here once and both outputs agree.

def bad: ["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"];

# Titles longer than this wrap in a terminal and break the table. The ready table carries six
# columns, so its titles have to be shorter than the three-column one.
def trunc(n): if (. | length) > n then (.[0:n] + "…") else . end;

def names: if (. | length) == 0 then "none" else join(", ") end;

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
  # One standing approval is enough. reviewDecision cannot carry this: branch protection holds it at
  # REVIEW_REQUIRED while an approval already stands.
  | (($states | index("APPROVED")) != null) as $approved
  # Reviewers still on the hook. Team entries carry .name and .slug, never .login.
  | ([.reviewRequests[]? | (.login // .name // .slug)]) as $outstanding
  # Standing approvals, which are the ones that make the PR mergeable.
  | ([.latestReviews[]? | select(.state == "APPROVED") | .author.login] | unique) as $approvers
  # Every reviewer who has ever left a comment-only review. `reviews` holds one entry per
  # submission and includes the PR author's own replies, so drop self and dedupe.
  | .author.login as $me
  | ([.reviews[]? | select(.state == "COMMENTED" and .author.login != $me) | .author.login]
      | unique
      | map(. + (if (. | IN($approvers[])) then " (also approved)" else " (no approval)" end))) as $commenters
  # Passed first, then skips. A skip is not a failure, so it is reported as its own count rather
  # than folded into either side.
  | ([$checks[] | (.conclusion // .state // "")]) as $outcomes
  | ([
      "\([$outcomes[] | select(. == "SUCCESS")] | length) pass",
      (if ([$outcomes[] | select(. == "SKIPPED")] | length) > 0 then "\([$outcomes[] | select(. == "SKIPPED")] | length) skip" else empty end),
      (if ([$outcomes[] | select(. == "NEUTRAL")] | length) > 0 then "\([$outcomes[] | select(. == "NEUTRAL")] | length) neutral" else empty end)
    ] | join(", ")) as $checkBreakdown
  # Everything the user controls is done: approved, green, no conflict, nothing in flight.
  | ($approved
      and .isDraft == false
      and ($hasFeedback | not)
      and .mergeable == "MERGEABLE"
      and .mergeStateStatus != "DIRTY"
      and ($checks | length) > 0
      and (($failing | length) + ($pending | length) + ($cancelled | length)) == 0) as $doneAndGreen
  # GitHub still refuses BLOCKED, so a required review is missing. Not the user's call to make.
  | ($doneAndGreen and .mergeStateStatus != "BLOCKED") as $ready
  | [
      (if $ready then "ready to merge"
          + (if .mergeStateStatus == "BEHIND" then ", behind base" else "" end)
          + (if ($outstanding | length) > 0 then ", waiting on \($outstanding | join(", "))" else "" end)
        else empty end),
      (if ($doneAndGreen and ($ready | not)) then "approved, merge blocked" else empty end),
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
      ready: $ready,
      rank: (
        if $doneAndGreen then 0
        elif (.mergeable == "CONFLICTING" or .mergeStateStatus == "DIRTY") then 1
        elif ($failing | length) > 0 then 2
        elif $hasFeedback then 3
        elif (($cancelled | length) + ($pending | length)) > 0 then 4
        else 5 end
      ),
      row: "| [#\(.number)](\(.url)) | \(.title | trunc(45)) | \($needs | join(", "))\(if .isDraft then " (draft)" else "" end) |",
      # A branch behind its base is also standing between the PR and a merge, so it belongs in the
      # same column as the reviewers who have not answered.
      readyRow: ("| [#\(.number)](\(.url)) | \(.title | trunc(32)) | \($approvers | names) | \($commenters | names)"
        + " | \($checkBreakdown) | \($outstanding + (if .mergeStateStatus == "BEHIND" then ["base update"] else [] end) | names) |")
    }
]
| if ($ARGS.named.mode == "ready")
  then (map(select(.ready)) | .[].readyRow)
  else (map(select(.ready | not)) | sort_by(.rank) | .[].row)
  end
