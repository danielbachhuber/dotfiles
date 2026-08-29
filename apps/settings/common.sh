# Shared by read.sh and write.sh. Not executable on its own.
#
# A .conf file describes one preference domain: the application it belongs to,
# the domain itself, and an allowlist of keys. Everything not listed is left
# behind, which is the point -- see the comments in each .conf for what is
# excluded and why.

SETTINGS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Sets conf_app, conf_domain and conf_keys from a .conf file. bash 3.2 has no
# associative arrays and no way to return a structure, so these are globals.
parse_conf() {
  local file="$1" directive value
  conf_app=''
  conf_domain=''
  conf_keys=()

  while read -r directive value; do
    case "$directive" in
      app)    conf_app="$value" ;;
      domain) conf_domain="${value/#\~/$HOME}" ;;
      key)    conf_keys+=("$value") ;;
      ''|\#*) ;;
    esac
  done < "$file"

  if [ -z "$conf_domain" ] || [ ${#conf_keys[@]} -eq 0 ]; then
    echo "$(basename "$file"): needs a domain and at least one key" >&2
    return 1
  fi
}

conf_files() {
  local found=0 f
  for f in "$SETTINGS_DIR"/*.conf; do
    [ -e "$f" ] || continue
    found=1
    printf '%s\n' "$f"
  done
  [ "$found" -eq 1 ]
}

plist_for() { echo "${1%.conf}.plist"; }

# An app holds its preferences in memory and writes them out when it quits, so
# anything written underneath a running app is liable to be overwritten.
app_is_running() { [ -n "$1" ] && pgrep -x "$1" >/dev/null 2>&1; }
