#!/usr/bin/env bash
# ficsmap save watcher: uploads every new Satisfactory save in a folder to a ficsmap world.
#
# @@GENERATED@@
# KEEP THIS FILE PRIVATE: it contains the upload token of your world. Anyone with it can upload saves there.
# Revoke the token in the world's settings ("Automatic upload") if the file gets out.
#
# Needs bash 4.3+, curl and sha256sum. Uses inotifywait (inotify-tools) when it is installed, else it checks the folder
# every POLL_SECONDS. It sends nothing but the save file, its name and the token to SERVER_URL.
#
# Usage: ./ficsmap-watch.sh          watch the folder until stopped (Ctrl+C)
#        ./ficsmap-watch.sh --once   upload what is new and exit (for cron or a test)
set -euo pipefail

# --- Settings (written by ficsmap; FICSMAP_SAVE_DIR, FICSMAP_STATE_DIR, FICSMAP_POLL_SECONDS override them) ---
SERVER_URL=@@SERVER_URL@@
WORLD_ID=@@WORLD_ID@@
UPLOAD_TOKEN=@@TOKEN@@
SAVE_DIR=@@SAVE_DIR@@
# Only saves whose file name starts with "<SESSION_FILTER>_" (empty: every save; the server still checks the session).
SESSION_FILTER=@@SESSION@@
POLL_SECONDS=@@POLL_SECONDS@@
# newest: upload only the newest new save; all: upload every new save, oldest first.
UPLOAD_MODE=@@MODE@@
# Where the list of uploaded saves is kept (empty: ~/.local/state/ficsmap).
STATE_DIR=@@STATE_DIR@@
# A save counts as written once its size and time have not changed for this long.
STABLE_SECONDS=5
# --- End of settings ---

SAVE_DIR=${FICSMAP_SAVE_DIR:-$SAVE_DIR}
STATE_DIR=${FICSMAP_STATE_DIR:-$STATE_DIR}
POLL_SECONDS=${FICSMAP_POLL_SECONDS:-$POLL_SECONDS}
ONCE=0

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

for arg in "$@"; do
  case $arg in
    --once) ONCE=1 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "Unknown argument: $arg (use --once or --help)" ;;
  esac
done

case $SAVE_DIR in
  '~') SAVE_DIR=$HOME ;;
  '~/'*) SAVE_DIR=$HOME/${SAVE_DIR#'~/'} ;;
esac
[[ -n $STATE_DIR ]] || STATE_DIR=${XDG_STATE_HOME:-$HOME/.local/state}/ficsmap

[[ $SERVER_URL =~ ^https?://[^[:space:]/]+(/[^[:space:]]*)?$ ]] || die "SERVER_URL is not an http(s) URL: $SERVER_URL"
[[ $WORLD_ID =~ ^[0-9a-fA-F-]{36}$ ]] || die "WORLD_ID is not a world id: $WORLD_ID"
[[ $UPLOAD_TOKEN =~ ^fsm_[0-9]+_[A-Za-z0-9_-]{43}$ ]] || die "UPLOAD_TOKEN is not a ficsmap upload token"
[[ $POLL_SECONDS =~ ^[0-9]+$ ]] && ((POLL_SECONDS >= 5)) || die "POLL_SECONDS must be a whole number of at least 5"
[[ $UPLOAD_MODE == newest || $UPLOAD_MODE == all ]] || die "UPLOAD_MODE must be newest or all"
for tool in curl sha256sum stat find sort od; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing; please install it"
done

UPLOAD_URL="${SERVER_URL%/}/api/worlds/$WORLD_ID/saves"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true
STATE_FILE="$STATE_DIR/uploaded-$WORLD_ID.txt"
FIRST_RUN=0
[[ -f $STATE_FILE ]] || FIRST_RUN=1
touch "$STATE_FILE"

declare -A HASH_OF=()   # "path|size|mtime" -> sha256, so unchanged files are hashed once
declare -A RETRY_AT=()  # sha256 -> epoch seconds before which a failed save is not tried again
CHILD=
HASH=

stop() {
  [[ -n $CHILD ]] && kill "$CHILD" 2>/dev/null || true
  log "Stopped."
  exit 0
}
trap stop INT TERM

# Sleeps in the background, so a stop signal is handled at once.
pause() {
  sleep "$1" &
  CHILD=$!
  wait "$CHILD" || true
  CHILD=
}

# Percent-encodes every byte (UTF-8 names stay intact in an HTTP header).
urlencode() { printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n' | sed 's/../%&/g'; }

now() { date +%s; }

# The saves to look at, oldest first, one path per line.
list_saves() {
  local f base
  find "$SAVE_DIR" -maxdepth 2 -type f -name '*.sav' -print0 2>/dev/null |
    while IFS= read -r -d '' f; do
      base=${f##*/}
      # A dedicated server keeps its settings in ServerSettings.<port>.sav next to the saves.
      if [[ $base == ServerSettings.* ]]; then continue; fi
      if [[ -n $SESSION_FILTER && $base != "$SESSION_FILTER"_* ]]; then continue; fi
      printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$f"
    done | sort -n -k1,1 | cut -f2-
}

# Waits until a file's size and time stop changing; fails when it keeps changing for 5 minutes or disappears. A file
# untouched for longer than STABLE_SECONDS is taken as written.
wait_stable() {
  local f=$1 before after tries=0
  before=$(stat -c '%s:%Y' "$f" 2>/dev/null) || return 1
  if ((${before%%:*} > 0 && $(now) - ${before##*:} > STABLE_SECONDS)); then return 0; fi
  while ((tries < 60)); do
    pause "$STABLE_SECONDS"
    after=$(stat -c '%s:%Y' "$f" 2>/dev/null) || return 1
    if [[ $after == "$before" && ${after%%:*} != 0 ]]; then return 0; fi
    before=$after
    tries=$((tries + 1))
  done
  return 1
}

# Sets HASH to the sha256 of a file that is done being written (cached by path, size and time).
hash_of() {
  local f=$1 key
  HASH=
  key="$f|$(stat -c '%s|%Y' "$f" 2>/dev/null)" || return 1
  if [[ -n ${HASH_OF[$key]:-} ]]; then HASH=${HASH_OF[$key]}; return 0; fi
  wait_stable "$f" || return 1
  key="$f|$(stat -c '%s|%Y' "$f" 2>/dev/null)" || return 1
  HASH=$(sha256sum "$f" | cut -d' ' -f1) || return 1
  HASH_OF[$key]=$HASH
}

is_done() { grep -qxF "$1" "$STATE_FILE"; }
mark_done() { printf '%s\n' "$1" >>"$STATE_FILE"; }

# A value of the server's JSON answer: a string (escaped quotes kept as quotes) or a number or boolean.
json_field() {
  sed -nE "s/.*\"$2\":(\"(([^\"\\\\]|\\\\.)*)\"|([^,}]*)).*/\\2\\4/p" "$1" | head -n 1 | sed 's/\\"/"/g'
}

# One upload. Returns 0 done (stored or refused for good), 1 try again later, 2 the token was refused.
upload_once() {
  local f=$1 name resp code status
  name=$(urlencode "${f##*/}")
  resp=$(mktemp)
  # The token goes in through curl's config on stdin, so it never shows in the process list.
  code=$(curl -sS --proto '=http,https' --connect-timeout 20 --max-time 900 \
    -o "$resp" -w '%{http_code}' -K - \
    -H 'Content-Type: application/octet-stream' -H "X-Save-Name: $name" \
    --data-binary "@$f" "$UPLOAD_URL" <<EOF
header = "Authorization: Bearer $UPLOAD_TOKEN"
EOF
  ) || code=000
  case $code in
    200 | 201)
      status=$(json_field "$resp" status)
      case $status in
        imported) log "Imported ${f##*/}: $(json_field "$resp" newlyChecked) newly checked, factory snapshot $(json_field "$resp" snapshot)." ;;
        snapshot) log "Added ${f##*/} to the timeline (older than the last import)." ;;
        duplicate) log "${f##*/} is already in the world." ;;
        *) log "Uploaded ${f##*/} (HTTP $code)." ;;
      esac
      rm -f "$resp"; return 0 ;;
    400 | 409 | 413 | 415)
      log "Server refused ${f##*/} (HTTP $code): $(json_field "$resp" message). It is not tried again."
      rm -f "$resp"; return 0 ;;
    401 | 403 | 404)
      log "ERROR: the server refused the upload token (HTTP $code). It may have been revoked: create a new one in the world's settings and download the script again."
      rm -f "$resp"; return 2 ;;
    000)
      log "Could not reach $SERVER_URL; will try again."
      rm -f "$resp"; return 1 ;;
    *)
      log "Upload of ${f##*/} failed (HTTP $code): $(json_field "$resp" message); will try again."
      rm -f "$resp"; return 1 ;;
  esac
}

# Uploads with retries (10 s, 30 s, 90 s); after that the save waits 10 minutes (an hour when the token was refused).
upload() {
  local f=$1 h=$2 attempt rc
  log "Uploading ${f##*/} ..."
  for attempt in 1 2 3 4; do
    rc=0
    upload_once "$f" || rc=$?
    if ((rc == 0)); then mark_done "$h"; unset 'RETRY_AT[$h]'; return 0; fi
    if ((rc == 2)); then RETRY_AT[$h]=$(($(now) + 3600)); return 1; fi
    ((attempt < 4)) && pause $((10 * 3 ** (attempt - 1)))
  done
  RETRY_AT[$h]=$(($(now) + 600))
  return 1
}

process() {
  local saves=() f h
  [[ -d $SAVE_DIR ]] || { log "Waiting for the save folder $SAVE_DIR to appear ..."; return 0; }
  mapfile -t saves < <(list_saves)
  if ((FIRST_RUN && ${#saves[@]} == 0)); then FIRST_RUN=0; fi
  ((${#saves[@]})) || return 0
  if ((FIRST_RUN)); then
    # First start: older saves already there are left alone (add them with "Add older saves" in the browser).
    for f in "${saves[@]::${#saves[@]}-1}"; do
      if hash_of "$f"; then mark_done "$HASH"; fi
    done
    ((${#saves[@]} > 1)) && log "First start: ${#saves[@]} saves found; only the newest is uploaded."
    FIRST_RUN=0
  fi
  [[ $UPLOAD_MODE == newest ]] && saves=("${saves[-1]}")
  for f in "${saves[@]}"; do
    hash_of "$f" || continue
    h=$HASH
    is_done "$h" && continue
    (($(now) < ${RETRY_AT[$h]:-0})) && continue
    upload "$f" "$h" || true
  done
}

HAVE_INOTIFY=0
command -v inotifywait >/dev/null 2>&1 && HAVE_INOTIFY=1
if ((HAVE_INOTIFY)); then how="inotify, checking every ${POLL_SECONDS}s as well"; else how="checking every ${POLL_SECONDS}s"; fi
log "ficsmap save watcher: $SAVE_DIR -> $SERVER_URL (world $WORLD_ID, ${SESSION_FILTER:-any session}, $UPLOAD_MODE, $how)"

process
((ONCE)) && exit 0
while true; do
  if ((HAVE_INOTIFY)) && [[ -d $SAVE_DIR ]]; then
    inotifywait -qq -r -t "$POLL_SECONDS" -e close_write -e moved_to "$SAVE_DIR" >/dev/null 2>&1 &
    CHILD=$!
    wait "$CHILD" || true
    CHILD=
  else
    pause "$POLL_SECONDS"
  fi
  process
done
