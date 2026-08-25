#!/usr/bin/env bash
# Verify every GitHub permalink in a draft: that the blob exists at the pinned SHA, and that
# an `#L` anchor lands on a line mentioning the symbol the link text names.
#
#   check-links.sh <draft.md>
#
# Exits non-zero if any link fails, so it can gate a post.
set -uo pipefail

DRAFT="${1:?usage: check-links.sh <draft.md>}"
SLUG="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fails=0
checked=0

# Markdown links whose target is a blob permalink on this repo.
while IFS=$'\t' read -r text url; do
    [ -n "$url" ] || continue
    checked=$((checked + 1))

    rest="${url#https://github.com/$SLUG/blob/}"
    if [ "$rest" = "$url" ]; then
        echo "SKIP  not a blob permalink for $SLUG: $url"
        continue
    fi
    sha="${rest%%/*}"
    pathanchor="${rest#*/}"
    path="${pathanchor%%#*}"
    anchor=""
    case "$pathanchor" in *#*) anchor="${pathanchor#*#}" ;; esac

    if [ "${#sha}" -ne 40 ]; then
        echo "FAIL  not a full SHA (branch names rot): $url"
        fails=$((fails + 1))
        continue
    fi
    if ! git cat-file -e "$sha:$path" 2>/dev/null; then
        echo "FAIL  $path does not exist at $sha"
        fails=$((fails + 1))
        continue
    fi

    # A link whose text is a bare identifier should point at a line that mentions it.
    symbol="$(printf '%s' "$text" | tr -d '`')"
    case "$anchor" in
        L*)
            start="${anchor#L}"
            start="${start%%-*}"
            line="$(git show "$sha:$path" | sed -n "${start}p")"
            case "$symbol" in
                # Only bare identifiers are worth matching. A phrase ("file header") or a
                # filename ("side-by-side.tsx") is legitimate link text with nothing to find.
                "" | */* | *[!A-Za-z0-9_]*) : ;;
                *)
                    if ! printf '%s' "$line" | grep -qF "$symbol"; then
                        echo "WARN  L$start of $path does not mention '$symbol': $(printf '%s' "$line" | cut -c1-60)"
                    fi
                    ;;
            esac
            ;;
    esac
    echo "ok    $path${anchor:+#$anchor}"
done < <(python3 - "$DRAFT" <<'EXTRACT'
# Link text can itself contain brackets — `dependabot[bot]` is a real case — so a
# [^]]+ character class silently skips those links. Balance one level of nesting instead.
import re, sys
text = open(sys.argv[1]).read()
for m in re.finditer(r"\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((https://[^)]*?/blob/[^)]+)\)", text):
    print(m.group(1) + "\t" + m.group(2))
EXTRACT
)

echo "---"
echo "$checked permalink(s) checked, $fails failure(s)"
[ "$fails" -eq 0 ]
