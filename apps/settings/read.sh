#!/bin/bash
#
# Capture the current settings from this machine into the .plist files here.
#
# Run this after changing something in an app, then review the diff before
# committing: these files are the record, and this repository is public.
#
# Only the keys each .conf allowlists are captured. Values are filtered in
# plist space rather than through JSON, because JSON cannot represent a plist
# date and the export contains one.

set -uo pipefail

# shellcheck source=common.sh
. "$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/common.sh"

status=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

while read -r conf; do
  parse_conf "$conf" || { status=1; continue; }

  name="$(basename "$conf")"
  out="$(plist_for "$conf")"

  if ! defaults export "$conf_domain" "$work/full.plist" 2>/dev/null; then
    echo "$name: cannot read domain $conf_domain" >&2
    status=1
    continue
  fi

  rm -f "$work/filtered.plist"
  plutil -create xml1 "$work/filtered.plist" >/dev/null

  captured=0
  absent=()
  for key in "${conf_keys[@]}"; do
    if plutil -extract "$key" xml1 -o "$work/value.xml" "$work/full.plist" >/dev/null 2>&1; then
      plutil -insert "$key" -xml "$(cat "$work/value.xml")" "$work/filtered.plist" >/dev/null
      captured=$((captured + 1))
    else
      absent+=("$key")
    fi
  done

  mv "$work/filtered.plist" "$out"
  echo "==> $(basename "$out"): $captured of ${#conf_keys[@]} keys"
  if [ ${#absent[@]} -gt 0 ]; then
    # Not an error. An app only writes a key once the setting is touched, so an
    # absent key means the default is still in effect.
    echo "    not set, so left at the app default: ${absent[*]}"
  fi
done < <(conf_files)

exit $status
