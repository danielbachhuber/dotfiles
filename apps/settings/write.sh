#!/bin/bash
#
# Apply the settings recorded here to this machine.
#
# This overwrites the current value of every key each .conf lists, so on an
# already-configured machine it will discard local changes. Run ./read.sh first
# if you want to keep them.
#
# Keys that are not listed are untouched: `defaults import` merges rather than
# replacing the domain, so dismissed tips, launch counts and the per-machine
# calendar selection all survive.

set -uo pipefail

# shellcheck source=common.sh
. "$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/common.sh"

status=0
applied=()

while read -r conf; do
  parse_conf "$conf" || { status=1; continue; }

  name="$(basename "$conf")"
  plist="$(plist_for "$conf")"

  if [ ! -f "$plist" ]; then
    echo "$name: $(basename "$plist") does not exist. Run ./read.sh first." >&2
    status=1
    continue
  fi

  # An app rewrites its whole preference domain when it quits, so importing
  # underneath a running one gets silently undone.
  if app_is_running "$conf_app"; then
    echo "$name: quit $conf_app first, or it will overwrite this on exit." >&2
    status=1
    continue
  fi

  if defaults import "$conf_domain" "$plist"; then
    echo "==> $name: applied $(basename "$plist")"
    applied+=("$conf_app")
  else
    echo "$name: could not write to $conf_domain" >&2
    status=1
  fi
done < <(conf_files)

if [ ${#applied[@]} -gt 0 ]; then
  # An app can span more than one domain, as Dato does, so the same name
  # arrives more than once.
  unique="$(printf '%s\n' "${applied[@]}" | sort -u | tr '\n' ' ')"
  echo
  echo "Start ${unique% } to pick the changes up."

  case " $unique " in
    *" Dato "*)
      echo "Dato's calendar selection is per machine and is not restored;"
      echo "choose the calendars again in its settings."
      ;;
  esac
fi

exit $status
