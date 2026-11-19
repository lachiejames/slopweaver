#!/usr/bin/env bash
# Serve the local docs site (`yarn docs`), start one in the background (`--start`), stop it (`--stop`), read
# what is recorded (`--status`), build it (`--build`), check that it is wired (`--check`), or sweep every
# figure for text clipped by its own frame (`--overflow [base-url]`, which starts a server if none is up and
# stops exactly the one it started), or time the console's clicks and first paints against a server already up
# (`--nav-timing [base-url]`).
#
# `site/` is a SEPARATE Yarn project, not a workspace of this repo: it carries its own package.json and its
# own yarn.lock, so the root `yarn install --immutable` and every CI job stay exactly as they were. Yarn
# itself asks for that empty-lockfile marker when a nested package directory is meant to stand alone.
#
# The env scrub below is what makes the nested install resolve `site/` as its own project root when this
# script is reached through `yarn docs` — Yarn exports PROJECT_CWD and a YARN_*/npm_* set into a script's
# environment, and an inherited one points the nested invocation back at the outer project.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site="$root/site"

# The scrub is an ARRAY rather than a line inside the function because a background start `exec`s it
# directly: a subshell that does not exec keeps the SCRIPT's own argv, and the run record below identifies
# its server by the `--port` on that argv.
yarn_scrub=(env -u YARN_RC_FILENAME -u PROJECT_CWD -u INIT_CWD -u npm_config_user_agent
  -u npm_lifecycle_event -u npm_lifecycle_script -u npm_package_json -u npm_node_execpath)

nested_yarn() {
  "${yarn_scrub[@]}" yarn "$@"
}

# ── Loopback only: every server this script starts listens on 127.0.0.1 and nowhere else ──────────────────
#
# Next listens on every interface when no host is named, and before this line none was: `lsof -nP -iTCP:3000
# -sTCP:LISTEN` read `TCP *:3000 (LISTEN)`, so the console answered on every interface, not just this machine's
# own. The routes' own
# guard (`site/lib/consolePress.ts`) reads only headers a client writes, and Next hands a route no socket address
# to check, so the bind is the boundary. Hard constraint 6, local-first: nothing is served off this machine.
#
# 127.0.0.1, never `localhost`: Node binds the FIRST address a name resolves to, and on macOS `localhost` resolves
# `::1` first, which would shut out every client that dials 127.0.0.1. Every client but this script's own readiness
# probe (`page_answers`, which dials `console_host`) dials `http://localhost:<port>` — the address the owner has
# bookmarked, and the origin the owner's microphone grant and the page's storage are kept under — and Node's fetch,
# Chromium and Electron all go on to 127.0.0.1 when `::1` refuses. A client pinned to IPv6 (`curl -6`, a Node
# `family: 6` or `autoSelectFamily: false` dial, `--no-network-family-autoselection`) would not.
# Passed AFTER `--port <n>` on every start, so the `--port <n>` every argv matcher reads stays adjacent, and after
# a caller's own arguments on the foreground serve, so a caller's `-H` cannot widen it. Reproduce the listener
# check with `lsof -nP -iTCP:<port> -sTCP:LISTEN`: it reads `TCP 127.0.0.1:<port> (LISTEN)`. `site/package.json`'s
# own `dev` and `start` carry the same host, so a hand-typed `yarn dev` in `site/` is loopback too.
readonly console_host="127.0.0.1"

# ── The run record: one file per worktree, carrying the pid and the port ──────────────────────────────
#
# The owner found nine `next-server` processes in Activity Monitor and asked whether they were
# in use. Eight were docs dev servers that seats had started to look at their own pages and never stopped,
# four of them in ONE worktree. Nothing here chose those ports — this script never passed one, so Next took
# 3000 and auto-incremented past every server already holding one. The DEFECT was that nothing recorded
# that a server existed, so no relaunch could reuse one and nothing could stop one.
#
# The record is that missing fact. It makes three things possible: a second `yarn docs` reuses the live
# server instead of minting another, `--stop` ends one by name, and `slopweaver machine reap` can find a
# server whose seat is gone (`src/live/machine/devServers.ts`).
#
# It lives under the cache root, never in the checkout and never in `$SLOPWEAVER_HOME`: a record, a log, a lock
# and a call lease are meaningful only while the process that wrote them lives, and the home is store material.
#
# The cache root is `src/cacheHome.ts`'s rule, resolved again in bash because this script starts the servers that
# read it: `$SLOPWEAVER_CACHE_HOME` (a relative one taken against the caller's directory, trailing slashes dropped)
# when set and not blank; on darwin `~/Library/Caches/slopweaver`; elsewhere `$XDG_CACHE_HOME/slopweaver`, else
# `~/.cache/slopweaver`. `--print-cache-paths` prints what this resolved, and
# `src/__tests__/subprocess/scripts/docsSiteCacheRoot/cacheRootAgreement.test.ts` holds it to the TypeScript.
absolute_dir() {
  # Lexically, as Node's `path.resolve` does: against `$PWD`, with `.`, `..`, repeated and trailing slashes
  # folded WITHOUT following a link — so `alpha/../beta` names `$PWD/beta` here exactly as it does in TypeScript,
  # even where `alpha` is a link elsewhere. Split by expansion, never by `IFS`, which would also glob a `*`
  # component; and a string rather than an array, since bash 3.2 under `set -u` refuses an empty one's expansion.
  local path="$1" out="" part cwd
  if [[ "$path" != /* ]]; then
    # `pwd -P`, never `$PWD`: Node's `process.cwd()` is the physical directory, and a shell started under a
    # linked path holds the logical one.
    cwd="$(
      pwd -P
      printf x
    )"
    cwd="${cwd%x}"
    cwd="${cwd%$'\n'}"
    # `src/cacheHome.ts` refuses the same: `$(...)` strips a trailing newline a directory name may end in, and
    # the marker above only keeps one this function can see.
    if [[ "$cwd" == *[[:cntrl:]]* ]]; then
      echo "docs-site: the working directory carries a control character; pass an absolute path" >&2
      return 1
    fi
    path="$cwd/$path"
  fi
  while [[ -n "$path" ]]; do
    part="${path%%/*}"
    if [[ "$path" == */* ]]; then
      path="${path#*/}"
    else
      path=""
    fi
    case "$part" in
      "" | .) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$part" ;;
    esac
  done
  printf '%s' "${out:-/}"
}
# A directory variable's value, refused when it carries a control character: `$(...)` strips a trailing newline
# that Node's `path.resolve` keeps, so the two would name two roots for one value.
printable_dir() {
  local name="$1" value="$2"
  if [[ "$value" == *[[:cntrl:]]* ]]; then
    echo "docs-site: $name carries a control character; set it to a plain directory path" >&2
    return 1
  fi
  absolute_dir "$value"
}
# The user's own home directory as Node's `os.homedir()` reads it: `$HOME` whenever it is set, even to "", else the
# account's entry in the user database, which is what bash's `~` reads when `HOME` is unset. Measured:
# `env -u HOME bash -c 'u=~; echo "$u"; node -e "console.log(require(\"os\").homedir())"'` prints one path twice.
if [[ -n "${HOME+set}" ]]; then
  user_home="$HOME"
else
  user_home=~
fi
cache_root_of() {
  # The C locale makes `[[:space:]]` exactly ASCII space, tab, newline, vertical tab, form feed and return, and
  # `[[:cntrl:]]` exactly U+0000-U+001F and U+007F — the sets `src/cacheHome.ts` spells out — where a UTF-8 locale
  # would widen both to Unicode classes Node's checks do not use.
  local LC_ALL=C
  local override="${SLOPWEAVER_CACHE_HOME:-}" xdg="${XDG_CACHE_HOME:-}" dir
  if [[ -n "${override//[[:space:]]/}" ]]; then
    printable_dir SLOPWEAVER_CACHE_HOME "$override"
    return
  fi
  # `src/cacheHome.ts` refuses the same case: an empty `HOME` names no user's cache.
  if [[ "$user_home" != /* ]]; then
    echo "docs-site: HOME \"$user_home\" is not absolute; set SLOPWEAVER_CACHE_HOME" >&2
    return 1
  fi
  # Every default is folded whole by `absolute_dir`, as Node's `join` folds it: `HOME=/` names `/Library/...`,
  # never `//Library/...`.
  # `command -p`: the system's own `uname`, as Node's `process.platform` is the build's, never one a `PATH`
  # entry supplies; `$OSTYPE` is no better, since the environment overrides it.
  if [[ "$(command -p uname -s)" == "Darwin" ]]; then
    absolute_dir "$user_home/Library/Caches/slopweaver"
    return
  fi
  if [[ -n "${xdg//[[:space:]]/}" ]]; then
    dir="$(printable_dir XDG_CACHE_HOME "$xdg")" || return 1
    absolute_dir "$dir/slopweaver"
    return
  fi
  absolute_dir "$user_home/.cache/slopweaver"
}
cache_root="$(cache_root_of)"
# The state home as `slopweaverHomeOf` (src/homeDir.ts) and `site/lib/consoleHome.ts` read it: unset when it is
# empty once JavaScript's `trim()` has run. That set is ECMAScript's WhiteSpace and LineTerminator,
# spelled here as UTF-8 bytes because macOS's bash 3.2 has no `\u` escape. Then through `printable_dir` like the
# cache variables, since `$(...)` strips a trailing newline the readers' `resolve` keeps.
state_home_of() {
  local LC_ALL=C
  local value="${SLOPWEAVER_HOME:-}" rest seq
  rest="$value"
  for seq in ' ' $'\t' $'\n' $'\v' $'\f' $'\r' $'\xc2\xa0' $'\xe1\x9a\x80' $'\xe2\x80\x80' $'\xe2\x80\x81' \
    $'\xe2\x80\x82' $'\xe2\x80\x83' $'\xe2\x80\x84' $'\xe2\x80\x85' $'\xe2\x80\x86' $'\xe2\x80\x87' $'\xe2\x80\x88' \
    $'\xe2\x80\x89' $'\xe2\x80\x8a' $'\xe2\x80\xa8' $'\xe2\x80\xa9' $'\xe2\x80\xaf' $'\xe2\x81\x9f' $'\xe3\x80\x80' \
    $'\xef\xbb\xbf'; do
    rest="${rest//"$seq"/}"
  done
  if [[ -z "$rest" ]]; then
    # Node joins an empty `homedir()` into a RELATIVE `.slopweaver`, which `/.slopweaver` here would not match
    # Refused, as the cache root refuses the same `HOME`.
    if [[ "$user_home" != /* ]]; then
      echo "docs-site: HOME \"$user_home\" is not absolute; set SLOPWEAVER_HOME" >&2
      return 1
    fi
    value="$user_home/.slopweaver"
  fi
  printable_dir SLOPWEAVER_HOME "$value"
}
state_home="$(state_home_of)"
state_dir="$cache_root/docs-site"
# Where the records lived before they moved; `migrate_legacy_state` below empties it.
legacy_state_dir="$state_home/docs-site"
record="$state_dir/$(basename "$root")-$(printf '%s' "$root" | shasum | cut -c1-8).json"
log_file="${record%.json}.log"

# Write the record for a server that has just been started — the ONE writer, used by the background start and
# by the foreground serve alike.
#
# It carries the STARTING SESSION. A seat that starts a server in a worktree it
# does not LIVE in was read as seat-closed by `slopweaver machine reap`, which killed a server in use, which
# made the seat start another: the owner watched the server reappear four times.
# Recording the starter is the only way to know, because the wrapper is reparented to launchd within a second
# of the start — measured, `ps -o ppid= -p <pid>` answered `1` one second after this script
# recorded that pid — so no ancestry walk at reap time can recover who asked for it.
#
# `CLAUDE_PID` and `CLAUDE_CODE_SESSION_ID` are Claude Code's own tool environment, and both fields are
# OMITTED when unset: a `yarn docs` typed in a plain terminal has no starter, and an absent one leaves the
# reap exactly where it was. `tonumber?` rather than `tonumber` so a non-numeric variable drops the field
# instead of failing the whole write and leaving no record at all.
#
# A PRODUCTION server (`--serve`, `--refresh`) adds three fields: `mode: "production"`, the `sha` it was built
# from and the build `slot` it serves. The sha is what a refresh compares HEAD against; a dev record carries
# none of the three, which is how a refresh tells the two apart.
write_record() {
  local pid="$1" port="$2" log="$3" sha="${4:-}" slot="${5:-}" tmp="$record.$$.tmp"
  jq -n --arg worktree "$root" --argjson pid "$pid" --argjson port "$port" \
    --arg startedIso "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg log "$log" \
    --arg starterPid "${CLAUDE_PID:-}" --arg starterSessionId "${CLAUDE_CODE_SESSION_ID:-}" \
    --arg sha "$sha" --arg slot "$slot" \
    '{worktree: $worktree, pid: $pid, port: $port, startedIso: $startedIso, log: $log}
      + (($starterPid | tonumber? // null) as $sp | if $sp == null then {} else {starterPid: $sp} end)
      + (if $starterSessionId == "" then {} else {starterSessionId: $starterSessionId} end)
      + (if $sha == "" then {} else {mode: "production", sha: $sha, slot: $slot} end)' >"$tmp"
  # Renamed into place, never written over: a reader, or a kill mid-write, sees the old record or the new
  # one, never an empty file that reads as "nothing recorded" and drops the production console for good.
  mv -f "$tmp" "$record"
}

# One field of the record, or a non-zero exit when there is no record or no such field.
record_field() {
  local key="$1"
  [[ -f "$record" ]] || return 1
  jq -er --arg key "$key" '.[$key] // empty' "$record" 2>/dev/null
}

# Whether the recorded server is still running. A pid is NOT an identity — the kernel recycles them, and a
# recycled one points at something else entirely — so this checks that the process still carries the port
# it was recorded with, exactly as `stillTheSameProcess` re-checks argv before `machine reap` signals.
record_live() {
  local pid port
  pid="$(record_field pid)" || return 1
  port="$(record_field port)" || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o args= -p "$pid" 2>/dev/null | grep -Eq -- "(--port|-p) $port"
}

# The port a caller named in its own arguments, or a non-zero exit when it named none — so a `yarn docs -p
# 3187` is recorded under the port it is actually serving rather than one this script chose.
port_in_args() {
  local previous="" argument
  for argument in "$@"; do
    if [[ "$previous" == "-p" || "$previous" == "--port" ]]; then
      echo "$argument"
      return 0
    fi
    previous="$argument"
  done
  return 1
}

# Every pid under one root, DEEPEST FIRST with the root last — the order kills go out in, so a parent
# cannot fork a replacement between the two signals.
descendants() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    descendants "$child"
  done
  echo "$pid"
}

# Whether anything is already listening on a port — what keeps a start from colliding with a server this
# record does not know about (one started by hand, or by an older copy of this script).
port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# The first free port at or above `$DOCS_SITE_PORT` (3000 by default).
pick_port() {
  local port="${DOCS_SITE_PORT:-3000}"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

# Whether the site's install is missing, or older than the lockfile a pull just changed. Checking only for
# the directory served a checkout whose `site/yarn.lock` gained a package against the install that predates
# it — the page then fails on an import that was never installed. Yarn writes `.yarn-state.yml` on every
# install, so a lockfile newer than it is a lockfile nobody has installed yet.
site_install_stale() {
  [[ ! -d "$site/node_modules" ]] || [[ "$site/yarn.lock" -nt "$site/node_modules/.yarn-state.yml" ]]
}

# Install the site when `site_install_stale` says so. Any argument (`--immutable`) is passed to the install.
ensure_install() {
  if site_install_stale; then
    echo "docs-site: installing the site's own dependencies (they are NOT in the root install)" >&2
    (cd "$site" && nested_yarn install "$@" >&2)
  fi
}

# Block until the server is LISTENING, or until it dies, or until the budget is spent.
#
# Listening, never a fetched page: a request would be an outbound call from a script the one-door gate reads
# (`classifyRawCommand` refuses a `curl` inside a helper like this one), and the thing a caller actually
# needs to know is that the port is answering. Next compiles each page on first request anyway, so a warm-up
# here would only move that cost, not remove it.
wait_for_server() {
  local port="$1" pid="$2" waited=0
  while ((waited < 240)); do
    kill -0 "$pid" 2>/dev/null || return 1
    if port_in_use "$port"; then
      return 0
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  return 1
}

# Start a server in the background and record it. Prints nothing to stdout — callers read the port back out
# of the record, so a caller capturing output gets the URL and nothing else.
start_server() {
  ensure_install
  local port pid
  port="$(pick_port)"
  mkdir -p "$state_dir"
  (
    cd "$site"
    export_build_identity "$(head_sha)"
    exec "${yarn_scrub[@]}" yarn dev --port "$port" --hostname "$console_host" >"$log_file" 2>&1
  ) &
  pid=$!
  write_record "$pid" "$port" "$log_file"
  if ! wait_for_server "$port" "$pid"; then
    echo "docs-site: the server on port $port never answered — its log is $log_file" >&2
    stop_recorded >&2 || true
    return 1
  fi
  echo "docs-site: started http://localhost:$port (pid $pid, log $log_file)" >&2
}

# Signal the recorded tree, deepest first, and remove the record. Says what it did, because a stop nobody
# can check is the invisible act doctrine rule 6 forbids.
stop_recorded() {
  local pid port dead=0 leaf
  if ! pid="$(record_field pid)"; then
    echo "docs-site: nothing recorded for $root"
    return 0
  fi
  port="$(record_field port || echo "?")"
  # The recycled-pid check, and the reason `record_live` is a function rather than an inline `kill -0`: a
  # stale record names a pid the kernel may since have handed to something else, and signalling that whole
  # tree would kill a stranger. Found by the `record-never-leaks-or-oversteps` pass.
  if ! record_live; then
    rm -f "$record"
    echo "docs-site: the recorded server (pid $pid, port $port) is gone — cleared the record, signalled nothing"
    return 0
  fi
  for leaf in $(descendants "$pid"); do
    if kill "$leaf" 2>/dev/null; then
      dead=$((dead + 1))
    fi
  done
  rm -f "$record"
  echo "docs-site: stopped the server on port $port (pid $pid, $dead process(es) signalled)"
}

# A dev console over a STALE built CLI, refused before anything is served or reused. MEASURED: every page of a
# worktree's dev console took about 30 s (`GET /queue 200 in 31.2s (… application-code: 30.9s)`) and drew
# "Organisation required", because each page's organisation read is a console child that waits out
# `CONSOLE_REBUILD_WAIT_MS` for a rebuild nothing in a worktree starts (`src/builtCli/servingCheckout.ts`). The check
# runs from SOURCE: `bin/slopweaver`'s own guard refuses before any verb could judge the build it guards. Its one
# `docs-site:` line names `slopweaver dev build`; it never builds, since a build beside a test lap is a load decision.
check_serving_cli() {
  # No root install, no check: only a STALE build is refused, and one this cannot read is said so and served as before.
  if [[ ! -x "$root/node_modules/.bin/tsx" ]]; then
    echo "docs-site: $root has no root install, so its built CLI was not checked before serving" >&2
    return 0
  fi
  # Exit 3 WITH `stale` alone on stdout is the entry's stale refusal and the ONLY refusal: any other outcome, a `tsx`
  # that cannot run included, whatever it exits, judged nothing, so it is said and the console served as before.
  local status=0 verdict
  verdict="$("$root/node_modules/.bin/tsx" "$root/src/builtCli/docsSiteStart.entry.ts" "$root")" || status=$?
  if ((status == 3)) && [[ "$verdict" == "stale" ]]; then
    return 1
  fi
  if ((status != 0)); then
    echo "docs-site: the built-CLI check could not run (exit $status), so it was not checked before serving" >&2
  fi
  return 0
}

# A dev start in a checkout whose record names a production console, refused rather than overwriting that
# record: the record is what brings a console that went down back on the next pull, and a dev server
# replacing it would end that silently.
refuse_dev_over_production() {
  if record_is_production; then
    echo "docs-site: a production console is recorded here (:$(record_field port), $(record_field sha | cut -c1-9)) — a dev server would replace its record; --stop it first, or use another worktree" >&2
    exit 1
  fi
}

# ── The production console: built, served by `next start`, and rebuilt when the checkout's HEAD moves ─────
#
# The app felt slow under the dev server, so a real build is served instead, and a hook rebuilds it
# automatically when main moves. So `--serve` builds and starts a production server, and `--refresh` is the
# ONE operation that brings it onto HEAD. It is called where the checkout's HEAD actually moves — lefthook's
# `post-merge` and `slopweaver checkout sync` after its fast-forward — and by nothing else: no watcher, no
# poll, no daemon. A checkout nobody pulls is never rebuilt, and a checkout with no production record is a
# one-line no-op, which is what every worktree's `post-merge` meets.
#
# MEASURED on the main checkout, same pages both ways: `next dev` shipped 4.5 MB of JavaScript to
# every console page and took 12.8 s to compile a docs page on first visit; the production build ships about
# 750 KB and answers every page in under 10 ms. The build itself is about 25 s (compile 11.3 s, types 6.0 s).
# Reproduce the build with `time bash scripts/docs-site.sh --serve`, and a page's weight by summing the
# `/_next/static/**.js` files its HTML names, fetched from each server in turn.

# git with a hook's exported repository variables removed: inside `post-merge` git exports GIT_DIR, and every
# git call below would otherwise answer about whatever that names — `bin/slopweaver`'s `git_clean`, same five.
git_clean() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR git "$@"
}

refresh_lock="${record%.json}.refresh.lockf"
refresh_pid="${record%.json}.refresh.pid"
refresh_log="${record%.json}.refresh.log"

# ── A rebuild never drops a live voice call ────────────────────────────────────────────────────────────────
#
# The console once rebuilt as main moved, the owner's next sidebar click became a full
# reload under the new build, and the call dropped. The rule: the swap waits until no call is live, with a note
# that a new build is waiting. So a production server is started with a HOLD DIRECTORY, the console voice beats
# a lease into `calls/` while a call is live (`site/app/api/console/call/route.ts`), and a round that has built
# its slot holds the restart while any lease is unexpired — writing `waiting.json`, which the widget and the
# `checkout sync` line both read back. NO CLOCK ends a hold: a 30-minute cap once fired during the owner's
# live plan call, the round signalled the server and the call ended with it. What ends a hold a call never ends
# is the lease itself — a tab that crashed or lost the server stops beating, and its last lease lapses within a
# minute. The page's own half — a reload a stale page would force, held until the owner hangs up — is
# `site/lib/consoleHold.ts`.
hold_dir="${record%.json}.hold"

# ── The console's saved readings: one directory per state home, named here and nowhere else ──────────────────
#
# The console keeps its last successful reading of each live verb so a page can draw before the verb answers
# (`site/lib/savedReadings.ts`). Rebuildable, so under the cache root rather than the home — and keyed by the home,
# because two homes' readings are two different worlds. The site never derives this path: every server this
# script starts inherits it, and a server started without it saves nothing.
export SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR="$cache_root/console/saved-readings/$(printf '%s' "$state_home" | shasum -a 256 | cut -c1-16)"

if [[ "${1:-}" == "--print-cache-paths" ]]; then
  echo "cache_root=$cache_root"
  echo "docs_site=$state_dir"
  echo "saved_readings=$SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR"
  exit 0
fi

# ── Moving the records out of the home, without dropping a call ────────────────────────────────────────────
#
# A console started before the move holds `$legacy_state_dir/<record>.hold` in its environment and beats its call
# lease there, and a round started before it holds the refresh lock on the legacy `.lockf`. So the directory is
# RENAMED, never copied — on one volume the rename keeps every inode, the lock a running round holds included — and a
# link stands at the old path, so every write an old process makes lands in the new directory. The link is removed
# once no server recorded as running AT the move is still running and no round holds the lock. Which servers hold
# the old path is judged by the marker's list of them, never their environment — macOS `ps eww` prints no other
# process's environment (measured, `env SW_PROBE=yes sleep 3 & ps eww -o command= -p $!` printed
# `sleep 3`) — and never by comparing start times, which a clock set back reorders. A recycled pid
# only keeps the link longer. Every reader of a lease or a starter reads both paths meanwhile
# (`src/desktop/callLeases.ts`, `src/live/machine/devServerRead.ts`).
moved_marker="$state_dir/.moved-from-home"

# The pid of every recorded server still running, one a line.
live_record_pids() {
  local rec pid
  for rec in "$state_dir"/*.json "$state_dir"/.*.json; do
    [[ -f "$rec" ]] || continue
    pid="$(jq -er '.pid' "$rec" 2>/dev/null)" || continue
    if kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
    fi
  done
  return 0
}

# Whether a pid the marker lists is still running.
marked_server_running() {
  local pid
  while IFS= read -r pid; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  done <"$moved_marker"
  return 1
}

# The marker: the servers running at this move, and those of an earlier move still running, since each may hold
# the old path. A marker that cannot be written fails the run (`set -e`).
write_moved_marker() {
  local pids
  pids="$(live_record_pids)"
  if [[ -f "$moved_marker" && -r "$moved_marker" ]] && marked_server_running; then
    pids+=$'\n'"$(cat "$moved_marker")"
  fi
  printf '%s\n' "$pids" >"$moved_marker"
}

retire_legacy_link() {
  # A link left by a run under ANOTHER cache root is that root's to retire: only it holds the records and the
  # marker that say whether a pre-move console still needs the old path.
  [[ "$(readlink "$legacy_state_dir")" == "$state_dir" ]] || return 0
  if [[ -f "$moved_marker" && -r "$moved_marker" ]]; then
    if marked_server_running; then
      return 0
    fi
  elif [[ -n "$(live_record_pids)" ]]; then
    # No list of who ran at the move: any running server may be an old one, so the link stays.
    return 0
  fi
  if command -v lockf >/dev/null 2>&1 || command -v flock >/dev/null 2>&1; then
    if refresh_running; then
      return 0
    fi
  fi
  rm -f "$legacy_state_dir" "$moved_marker"
}

# `record_live` over a named file rather than this worktree's own record: `record` is dynamically scoped, so the
# local below is what `record_field` reads.
record_live_at() {
  local record="$1"
  record_live
}

# Whether the first file was modified after the second, to the nanosecond: macOS's bash 3.2 compares `-nt` in whole
# seconds, so two copies written within one second tie there. Measured on macOS: of two
# files touched at `.1` and `.9` of one second, `[[ b -nt a ]]` answers false while `find b -prune -newer a` prints b
# (`d=$(date -u +%Y-%m-%d); touch -d "${d}T00:00:00.1" a; touch -d "${d}T00:00:00.9" b; find b -prune -newer a`).
newer_than() {
  [[ -n "$(find "$1" -prune -newer "$2" 2>/dev/null)" ]]
}

# Which copy of a file both directories hold wins the cache root's name: a run record naming a LIVE server is
# never replaced, and replaces a copy that names none (a newer but stale record must not hide the
# server that is running); a kernel lock file is never replaced, since a holder keeps its lock on the inode it
# opened and a second inode under the same name would let a second refresh take it; otherwise the NEWER copy.
legacy_copy_wins() {
  local entry="$1" target="$2"
  [[ "$target" != *.lockf ]] || return 1
  # Liveness is asked only of a run record, `<checkout>-<hash>.json` directly under the directory; any other file
  # that happens to name a live pid is ordinary, and the newer copy wins.
  if [[ "${entry%/*}" != "$legacy_state_dir" || ! "${entry##*/}" =~ ^.+-[0-9a-f]{8}\.json$ ]]; then
    newer_than "$entry" "$target"
    return
  fi
  if record_live_at "$target"; then
    return 1
  fi
  if record_live_at "$entry"; then
    return 0
  fi
  newer_than "$entry" "$target"
}

# The device a path lives on: GNU `stat -c` first, since GNU's `stat -f` is the FILESYSTEM report and would
# print something else without failing; BSD's `stat -f` where `-c` is refused.
device_of() {
  stat -c %d "$1" 2>/dev/null || stat -f %d "$1"
}

# Move a lock file only while HOLDING its lock, failing when a refresh holds it or the target has one. Holding it
# across the `mv` is the point: a probe released before the move would let an old-script refresh take the lock in
# between and keep it on an inode a cross-filesystem `mv` then unlinks. With no lock tool the take
# fails, which keeps the file — the safe answer for one that must not be moved.
move_unheld_lock() {
  local from="$1" to="$2"
  (
    exec 7>>"$from"
    take_lock_fd 7 || exit 1
    [[ ! -e "$to" && ! -L "$to" ]] || exit 1
    mv "$from" "$to"
  )
}

# Rename every entry of one directory into another, printing how many could not be: an entry the target lacks
# moves; a directory both hold is merged the same way, one level down; a file both hold goes to the copy
# `legacy_copy_wins` picks, by rename, so the inode a live record, lease or held kernel lock lives on is the one
# kept. A losing copy, or a name that is a file in one and a directory in the other, stays where it is. So does a
# lock file a refresh HOLDS: across filesystems `mv` copies, and the holder keeps its lock on the old inode while
# the copy is unlocked, so it waits at the old path, where `legacy_refresh_lock` takes it as well.
merge_into() {
  local from="$1" to="$2" entry name target kept=0
  # `dotglob`, never a `.[!.]*` pattern, which skips a record whose checkout's name starts with two dots. Always
  # called inside `$(...)`, so the option dies with the subshell.
  shopt -s dotglob
  for entry in "$from"/*; do
    [[ -e "$entry" || -L "$entry" ]] || continue
    name="${entry##*/}"
    target="$to/$name"
    if [[ "$entry" == *.lockf && -f "$entry" && ! -L "$entry" ]]; then
      move_unheld_lock "$entry" "$target" || kept=$((kept + 1))
    elif [[ ! -e "$target" && ! -L "$target" ]]; then
      mv "$entry" "$target" || kept=$((kept + 1))
    elif [[ -d "$entry" && ! -L "$entry" && -d "$target" && ! -L "$target" ]]; then
      kept=$((kept + $(merge_into "$entry" "$target")))
      rmdir "$entry" 2>/dev/null || true
    elif [[ -f "$entry" && ! -L "$entry" && -f "$target" && ! -L "$target" ]] && legacy_copy_wins "$entry" "$target"; then
      mv -f "$entry" "$target" || kept=$((kept + 1))
    else
      kept=$((kept + 1))
    fi
  done
  printf '%s' "$kept"
}

# The old path once its records have gone: a link to the cache root's, or, where the filesystem has no links
# (exFAT), an empty directory again — so a pre-move console always has a path to beat its lease
# under, which every reader reads first, and the next run merges what it wrote. 0 a link, 2 a directory, 1 neither.
leave_old_path() {
  ln -s "$state_dir" "$legacy_state_dir" 2>/dev/null && return 0
  mkdir "$legacy_state_dir" 2>/dev/null || return 1
  echo "docs-site: could not leave a link at $legacy_state_dir, so it stands again as an empty directory beside $state_dir" >&2
  return 2
}

# Both directories stand when a checkout still on the old script recreated the home's after the move. Its
# entries are merged across (`merge_into`), so a live server recorded at the old path is found here rather than
# started a second time, and the old path becomes a link only once nothing is left in it. The marker is
# rewritten with the servers running NOW, because one the old script started after the first move still knows
# only the old path.
merge_legacy_state() {
  local kept
  kept="$(merge_into "$legacy_state_dir" "$state_dir")"
  if ((kept > 0)) || ! rmdir "$legacy_state_dir" 2>/dev/null; then
    echo "docs-site: merged $legacy_state_dir into $state_dir; $kept entry(ies) whose cache-root copy is kept (live, a lock, or newer) stay at the old path, which is read only for call leases and starters until it is removed" >&2
    return 0
  fi
  local left=0
  leave_old_path || left=$?
  if ((left == 2)); then
    return 0
  fi
  if ((left != 0)); then
    echo "docs-site: merged $legacy_state_dir into $state_dir but could leave neither a link nor a directory there" >&2
    return 1
  fi
  write_moved_marker
  echo "docs-site: merged the console's records from $legacy_state_dir into $state_dir; a link stands at the old path until every console started before the move has stopped" >&2
}

migrate_legacy_state() {
  if [[ -L "$legacy_state_dir" ]]; then
    retire_legacy_link
    return 0
  fi
  [[ -d "$legacy_state_dir" ]] || return 0
  # A cache root inside the old directory cannot take it: the rename fails and a merge would walk into its own
  # destination. Refused, never read past, since `--status` reads only the cache root.
  if [[ "$state_dir/" == "$legacy_state_dir/"* ]]; then
    echo "docs-site: the cache root's $state_dir sits inside $legacy_state_dir, so the console's records cannot move there; point SLOPWEAVER_CACHE_HOME outside it" >&2
    return 1
  fi
  if [[ -e "$state_dir" ]]; then
    merge_legacy_state
    return 0
  fi
  mkdir -p "$cache_root"
  # A rename keeps every inode only on one filesystem; across two, `mv` copies, so the move goes entry by entry
  # through the merge, which leaves a held lock where its holder locked it.
  if [[ "$(device_of "$legacy_state_dir")" != "$(device_of "$cache_root")" ]]; then
    mkdir -p "$state_dir"
    merge_legacy_state
    return 0
  fi
  if ! mv "$legacy_state_dir" "$state_dir"; then
    echo "docs-site: could not move $legacy_state_dir to $state_dir; nothing else was done, since a console recorded there would be invisible from the cache root" >&2
    return 1
  fi
  # The link first: a marker write that fails must not leave the old path missing for a pre-move console.
  if [[ ! -e "$legacy_state_dir" ]]; then
    local left=0
    leave_old_path || left=$?
    if ((left == 2)); then
      return 0
    fi
    if ((left != 0)); then
      # Put the directory back rather than leave the old path missing under a pre-move console.
      mv "$state_dir" "$legacy_state_dir"
      echo "docs-site: could leave neither a link nor a directory at $legacy_state_dir, so the move was undone; nothing else was done" >&2
      return 1
    fi
  fi
  write_moved_marker
  echo "docs-site: moved the console's records from $legacy_state_dir to $state_dir; a link stands at the old path until every console started before the move has stopped" >&2
}

# The build held behind a live call, when a refresh round that is still running wrote one. Prints the
# `waiting.json` line and exits 0, or exits non-zero when nothing is held.
held_build() {
  local pid
  pid="$(jq -er '.pid' "$hold_dir/waiting.json" 2>/dev/null)" || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  echo "docs-site: $(jq -r '.sha[0:9]' "$hold_dir/waiting.json") is built and waiting for a live voice call to end — it swaps in when the call does"
}

# How many calls hold a lease right now. A lease that has lapsed — a tab that crashed or lost the server before
# its hang-up beat — or whose `untilMs` is unreadable holds nothing and is removed, so neither a dead call nor a
# half-written file pins the console to an old build or piles up beside the record.
live_calls() {
  local now_ms lease until count=0 dir dirs=()
  now_ms="$(($(date +%s) * 1000))"
  # A pre-move console beats its lease under the home's old directory while that stands as a real one (a merge
  # that kept an entry), so it is read first, as `src/desktop/callLeases.ts` reads it. Through the
  # link it IS the cache root's, and would count each lease twice.
  if [[ -d "$legacy_state_dir" && ! -L "$legacy_state_dir" ]]; then
    dirs+=("$legacy_state_dir/${hold_dir##*/}")
  fi
  dirs+=("$hold_dir")
  for dir in "${dirs[@]}"; do
    for lease in "$dir"/calls/*.json; do
      [[ -f "$lease" ]] || continue
      if until="$(jq -er '.untilMs | numbers' "$lease" 2>/dev/null)" && ((${until%.*} > now_ms)); then
        count=$((count + 1))
      else
        rm -f "$lease"
      fi
    done
  done
  echo "$count"
}

# Hold a built slot's swap for as long as a voice call is live — no clock, however long the call. Returns once no
# call is live, saying how long it held; says nothing at all when no call was live to begin with.
hold_for_calls() {
  local sha="$1" started=$SECONDS since tmp
  if (($(live_calls) == 0)); then
    return 0
  fi
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$hold_dir"
  tmp="$hold_dir/waiting.json.$$.tmp"
  jq -n --arg sha "$sha" --argjson pid "$$" --arg sinceIso "$since" \
    '{sha: $sha, pid: $pid, sinceIso: $sinceIso}' >"$tmp"
  mv -f "$tmp" "$hold_dir/waiting.json"
  echo "docs-site: $since ${sha:0:9} is built; a voice call is live, so the swap waits for it"
  while (($(live_calls) > 0)); do
    sleep 5
  done
  rm -f "$hold_dir/waiting.json"
  echo "docs-site: the call ended after $((SECONDS - started))s — swapping to ${sha:0:9}"
}

head_sha() {
  git_clean -C "$root" rev-parse HEAD
}

# ── Which build a page was loaded from ─────────────────────────────────────────────────────────────────────
#
# The owner wants confidence that the page they are looking at is the latest build.
# The console's sidebar compares the build its own bundle was baked from with what
# `slopweaver checkout console --json` reads now (`site/lib/buildStanding.ts`). So every build and dev start
# exports the commit it is building and that commit's time, and `next.config.mjs` bakes both into the bundle.
# The sha is the SAME `$head` a round records, never a second read of HEAD inside the build: a HEAD that moved
# mid-build would bake one sha and record another, and every page would say "hard refresh" forever. When git
# cannot read the commit, neither is exported and the page says its build carries no identity.
export_build_identity() {
  local sha="$1" iso
  unset SLOPWEAVER_BUILD_SHA SLOPWEAVER_BUILD_COMMITTED_ISO
  iso="$(git_clean -C "$root" show -s --format=%cI "$sha" 2>/dev/null)" || return 0
  export SLOPWEAVER_BUILD_SHA="$sha" SLOPWEAVER_BUILD_COMMITTED_ISO="$iso"
}

# Whether the record describes a PRODUCTION console — a dev record carries no `mode`. Deliberately not a
# liveness check: a production record whose server has died still says a console belongs here, and that is
# what lets the next pull bring it back rather than read the checkout as serving nothing.
record_is_production() {
  [[ "$(record_field mode || true)" == "production" ]]
}

# The build slot a rebuild goes into: whichever one the record does NOT name. The record names only a build
# that answered a page, so the last good build is never the one emptied for the next.
idle_slot() {
  if [[ "$(record_field slot || true)" == ".next-serve-a" ]]; then
    echo ".next-serve-b"
  else
    echo ".next-serve-a"
  fi
}

# Build the site into one slot, emptied first for the reason `--build` empties `.next`. The install is
# `--immutable` here: this runs from a hook in the main checkout, and a lockfile it rewrote would leave the
# checkout dirty for the next pull to refuse. Every step returns explicitly — a caller testing this with
# `if !` switches `set -e` off inside it, and a failed install must not build against the old tree.
build_slot() {
  local slot="$1" sha="$2"
  ensure_install --immutable || return 1
  rm -rf "${site:?}/$slot"
  clear_generated_types
  (cd "$site" && export_build_identity "$sha" && SLOPWEAVER_SITE_DIST_DIR="$slot" nested_yarn build) || return 1
}

# Remove the route types Next generated into every dist directory, before a build (`build_slot`, `--build`)
# typechecks. `tsconfig.json`
# includes all of them, so the build reads the SERVING slot's and any old dev run's `validator.ts` too, and one
# written before a route was deleted imports a page that no longer exists. MEASURED: after a change
# deleted `app/(console)/page.tsx`, every round building the next commit failed with TS2307 on three stale
# validators (`.next`, `.next/dev`, `.next-serve-a`), and :3000 stayed on the old build. They are typegen for the
# typecheck alone: `next start` never reads them, and the build regenerates its own slot's set. A `next dev`
# started by hand in the same site regenerates its set on its next compile; whether one mid-sweep misses a file
# is unmeasured, and nothing here starts one there. Reproduce: `grep TS2307 <the refresh log>`.
clear_generated_types() {
  local dist
  for dist in .next .next-serve-a .next-serve-b; do
    rm -rf "${site:?}/$dist/types" "${site:?}/$dist/dev/types"
  done
}

# Block until nothing listens on a port, or the budget is spent — a stopped server takes a moment to let go
# of its socket, and a start inside that moment would read the DYING server as its own readiness.
wait_port_free() {
  local port="$1" waited=0
  while port_in_use "$port" && ((waited < 60)); do
    sleep 0.5
    waited=$((waited + 1))
  done
  ! port_in_use "$port"
}

# Signal one pid's whole tree, deepest first, and print how many processes took the signal.
signal_tree() {
  local pid="$1" leaf dead=0
  for leaf in $(descendants "$pid"); do
    if kill "$leaf" 2>/dev/null; then
      dead=$((dead + 1))
    fi
  done
  echo "$dead"
}

# Wait, up to a second, until a process just sent SIGSTOP has actually stopped (`ps` state `T`) or is gone: the
# signal is only posted, and a process still running can fork after its children were read.
stopped() {
  local pid="$1" tries=0 state
  while ((tries < 20)); do
    state="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
    if [[ -z "$state" || "$state" == T* || "$state" == Z* ]]; then
      return 0
    fi
    sleep 0.05
    tries=$((tries + 1))
  done
  # Not stopped after a second (an uninterruptible wait holds SIGSTOP pending): its children were not read under a
  # stop, so `end_tree` fails rather than call the walk complete.
  return 1
}

# Stop a swapped-out server's whole tree and wait until every process of it has EXITED, not only until its port
# is free: `next start` closes its listener on SIGTERM and goes on answering the keep-alive sockets a browser
# already holds. MEASURED: a console swapped out ten minutes earlier was still alive,
# listening on nothing, with an ESTABLISHED socket to Chrome (`lsof -nP -iTCP -a -p <pid>`). A call
# opened 25s after the swap; the page's tool claims rode those sockets to the outgoing server, whose memory
# never held the call, and every one was refused "no plan call is live" while the voice sat silent. A swap runs
# only once no call is live (`hold_for_calls`), so nothing a graceful stop would finish is left: the frozen tree is
# SIGKILLed where it stands. It is never resumed under SIGTERM, because a handler that runs can fork a child no walk
# saw, and a stopped process that is killed runs nothing. The tree is FROZEN
# top-down before any of it is killed: each process is SIGSTOPped BEFORE its children are read, and a stopped
# process cannot fork, so every child it ever made is found under it — where reading first and stopping after lets a
# parent fork and exit in between, its child reparented out of reach. The residue, named: a
# child read but not yet stopped that forks and exits in that same instant orphans its own child, which macOS gives
# no subreaper to catch; `yarn` and `next-server` fork nothing once serving. A child is queued with the parent it was
# read under, and once stopped is kept only if that is STILL its parent: a child that exited and whose pid an
# unrelated process took in between is resumed and left alone. Fails when any process of it never
# stopped, since its children were read unfrozen, or when any survives even SIGKILL, so the round never starts a
# server beside one that may still answer.
end_tree() {
  local pid="$1" tree="" queue="root:$1" next entry parent leaf child signalled=0 unstopped="" gone=0
  # A pid of 0 or below names a process GROUP, or every process this user may signal, to `kill`.
  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
    echo "docs-site: end_tree takes one positive pid, not '$pid'"
    return 2
  fi
  while [[ -n "${queue// /}" ]]; do
    next=""
    for entry in $queue; do
      parent="${entry%%:*}"
      leaf="${entry#*:}"
      if [[ "$tree " == *" $leaf "* ]]; then
        continue
      fi
      kill -STOP "$leaf" 2>/dev/null || true
      if ! stopped "$leaf"; then
        unstopped="$unstopped $leaf"
      fi
      # Its parent is stopped and cannot reap or re-fork, so a real child still names it.
      if [[ "$parent" != "root" && "$(ps -o ppid= -p "$leaf" 2>/dev/null | tr -d ' ' || true)" != "$parent" ]]; then
        kill -CONT "$leaf" 2>/dev/null || true
        continue
      fi
      tree="$tree $leaf"
      for child in $(pgrep -P "$leaf" 2>/dev/null || true); do
        next="$next $leaf:$child"
      done
    done
    queue="$next"
  done
  for leaf in $tree; do
    if kill -9 "$leaf" 2>/dev/null; then
      signalled=$((signalled + 1))
    fi
  done
  echo "docs-site: pid $pid's tree, $signalled process(es), frozen and SIGKILLed"
  wait_gone "$tree" || gone=1
  if [[ -n "$unstopped" ]]; then
    echo "docs-site: pid(s)$unstopped never stopped within a second, so a child they forked may have escaped the walk"
    return 1
  fi
  return "$gone"
}

# Whether EVERY listener on a port is the server this script started — one of its own tree — and there is at
# least one. "Any listener is ours" is not enough: macOS lets one server hold `::` and another `::1` on the
# same port, so a stray started in the restart gap could answer the page check for a server still loading.
listeners_all_ours() {
  local port="$1" pid="$2" tree listener seen=0
  tree=" $(descendants "$pid" | tr '\n' ' ')"
  for listener in $(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    if [[ "$tree" != *" $listener "* ]]; then
      return 1
    fi
    seen=1
  done
  ((seen == 1))
}

# Whether the server on a port answers a page. `next start` LISTENS before it loads its config and build,
# and exits 1 when that load fails, so a listening port proves nothing about a production start — MEASURED
# against `site/node_modules/next/dist/server/lib/start-server.js`: `server.listen` fires first and
# `getRequestHandlers` runs in its callback, with `process.exit(1)` on failure. A request is held until the
# handlers are ready, so an answer below 500 is the handlers answering. A loopback read of the server this
# script just started, which the dev path does not make because `next dev` compiles on first request.
#
# It dials `console_host` itself, never `localhost`: the probe asks whether THIS server answers, so it goes to the
# one address the server listens on, and an inherited `NODE_OPTIONS=--no-network-family-autoselection` cannot strand
# it on a refused `::1` and stop a console that was answering.
page_answers() {
  node -e '
    fetch(`http://${process.argv[2]}:${process.argv[1]}/`, { signal: AbortSignal.timeout(10000) }).then(
      (response) => process.exit(response.status < 500 ? 0 : 1),
      () => process.exit(1),
    );' "$1" "$console_host" >/dev/null 2>&1
}

# Block until a production server is READY — only its own tree holds the port, a page answers, and it is
# still alive and still the only listener afterwards — or until it dies, or two minutes of WALL CLOCK pass.
# A deadline rather than a count of tries: each try can wait ten seconds on a page, so a count bounded
# nothing a server that listens and never answers would not outlast.
wait_for_production() {
  local port="$1" pid="$2" deadline=$((SECONDS + 120))
  while ((SECONDS < deadline)); do
    kill -0 "$pid" 2>/dev/null || return 1
    if listeners_all_ours "$port" "$pid" && page_answers "$port" && kill -0 "$pid" 2>/dev/null &&
      listeners_all_ours "$port" "$pid"; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# Stop what an earlier refresh left behind in THIS site, found by what it is rather than by a file naming it
# — a refresh can be killed between any two lines, including between starting a process and writing down
# that it did. Run under the lock, so nothing found here belongs to a refresh still running. Each is proven
# to be this script's by the slot it names, `.next-serve-a` or `-b`, which a dev server and a hand-run
# `next build` never use (they write `.next`):
#   - a `next build` holding `<slot>/lock` in this site — Next holds it open for the whole build — is an
#     orphan of a killed round, and two builds must never share a slot;
#   - a `yarn start` for this port whose environment carries `SLOPWEAVER_SITE_DIST_DIR=<slot>` and which the
#     live record does not name is an unproven start a killed round never recorded. The record names only a
#     build that answered a page, so stopping it can never stop the console the record describes.
# Next renames its processes a moment after they start (`next-build (vN)`, `next-server (vN)`) and a
# renamed process shows `ps` no environment, which is why a build is proven by its lock and a server by its
# `yarn`. A `next-server` whose `yarn` is gone proves nothing — a dev server's looks the same — so it is left
# alone: the round then refuses its port, naming what holds it.
# Every probe here tolerates the process exiting under it — a tree signalled a moment earlier is still
# dying — and the round waits for everything signalled to be gone before it frees a port or empties a slot.
reap_strays() {
  local port="$1" keep="" here pid args signalled=""
  here="$(cd "$site" && pwd -P)"
  if record_live; then
    keep=" $(descendants "$(record_field pid)" | tr '\n' ' ')"
  fi
  for pid in $(pgrep -f -- "next[ -]build|start (--port|-p) $port( |\$)" 2>/dev/null || true); do
    if [[ "$keep" == *" $pid "* ]]; then
      continue
    fi
    args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    if [[ -z "$args" ]] || ! slot_owned "$pid" "$here" "$args"; then
      continue
    fi
    signalled="$signalled $(descendants "$pid" | tr '\n' ' ')"
    echo "docs-site: stopping what a killed refresh left running: pid $pid (${args:0:60}), $(signal_tree "$pid") process(es) signalled"
  done
  # A stray that outlives even SIGKILL has been named by `wait_gone`; the round's own port check refuses over it.
  wait_gone "$signalled" || true
}

# Whether a process `reap_strays` found is this script's: a build by the `<slot>/lock` it holds under this
# site, a server's `yarn` by the slot in its environment and its working directory being this site.
slot_owned() {
  local pid="$1" here="$2" args="$3" cwd
  if [[ "$args" == *next[\ -]build* ]]; then
    lsof -p "$pid" -Fn 2>/dev/null | grep -qE "^n$here/\.next-serve-[ab]/lock\$"
    return
  fi
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
  [[ "$cwd" == "$here" ]] && process_env "$pid" | grep -qE '^SLOPWEAVER_SITE_DIST_DIR=\.next-serve-[ab]$'
}

# A process's environment, one variable per line — `/proc` where there is one, `ps eww` on macOS. Empty when
# it has exited or is not this user's.
process_env() {
  local pid="$1"
  if [[ -r "/proc/$pid/environ" ]]; then
    tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null || true
  else
    ps eww -o command= -p "$pid" 2>/dev/null | tr ' ' '\n' || true
  fi
}

# Wait for every pid named to exit — up to ten seconds after a SIGTERM, then SIGKILL whatever is left, because
# `next build` handles SIGTERM itself and a slot must not be emptied under a build still writing it. Fails, naming
# them, when any is STILL there two seconds after SIGKILL — a process the kernel cannot end yet.
wait_gone() {
  local pids="$1" waited=0 pid alive
  while true; do
    alive=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive="$alive $pid"
      fi
    done
    if [[ -z "$alive" ]]; then
      return 0
    fi
    if ((waited >= 20)); then
      break
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  for pid in $alive; do
    kill -9 "$pid" 2>/dev/null || true
  done
  echo "docs-site: pid(s)$alive outlived SIGTERM by ten seconds — sent SIGKILL"
  pids="$alive"
  for waited in 1 2 3 4; do
    alive=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive="$alive $pid"
      fi
    done
    if [[ -z "$alive" ]]; then
      return 0
    fi
    sleep 0.5
  done
  echo "docs-site: pid(s)$alive are still there two seconds after SIGKILL"
  return 1
}

# Start `next start` on a built slot and wait for it to answer a page — `start_server`'s production twin.
# The record moves to it ONLY once it has. A start that never answers is stopped and the record is left
# exactly as it was; one whose refresh was killed before it could record it is found by `reap_strays`.
start_production() {
  local port="$1" slot="$2" sha="$3" pid
  mkdir -p "$state_dir"
  (
    cd "$site"
    # The refresh lock rides fd 9, and a server that inherited it would hold the lock for as long as it serves.
    exec 9>&-
    exec "${yarn_scrub[@]}" SLOPWEAVER_SITE_DIST_DIR="$slot" SLOPWEAVER_CONSOLE_HOLD_DIR="$hold_dir" \
      yarn start --port "$port" --hostname "$console_host" >"$log_file" 2>&1 </dev/null
  ) &
  pid=$!
  if ! wait_for_production "$port" "$pid"; then
    echo "docs-site: ${sha:0:9} on port $port never answered a page ($(signal_tree "$pid") process(es) stopped) — its log is $log_file"
    return 1
  fi
  write_record "$pid" "$port" "$log_file" "$sha" "$slot"
  echo "docs-site: serving ${sha:0:9} from site/$slot at http://localhost:$port (pid $pid, log $log_file)"
}

# Try to take the refresh lock on fd 9, which the caller has opened on the lock file; exit 75 when another
# refresh holds it. A KERNEL lock on the open file, not a lock directory with a pid in it: every process that
# keeps fd 9 — the round and the `yarn` it runs — holds it, and the kernel drops it only when the last of
# them is gone, so nothing a finished refresh leaves behind can hold it. It does NOT reach `next build`:
# yarn closes inherited descriptors before it starts a script (measured with Yarn 4 in `site/`), so a build
# orphaned by a kill can outlive the lock. `reap_strays` is what keeps two builds out of one slot.
take_lock_fd() {
  local fd="$1"
  if command -v lockf >/dev/null 2>&1; then
    lockf -s -t 0 "$fd"
  else
    flock -n -E 75 "$fd"
  fi
}

# The lock a refresh started by a checkout still on the OLD script holds: the same name under the home's own
# `docs-site/`, while that is a real directory rather than the migration's link. A round takes it too, on fd 8,
# so the old script's refresh and this one exclude each other although each locks its own inode.
legacy_refresh_lock() {
  [[ -d "$legacy_state_dir" && ! -L "$legacy_state_dir" ]] || return 1
  printf '%s' "$legacy_state_dir/${refresh_lock##*/}"
}

# Refuse, and say so, on a machine with neither lock tool: without one every probe would read as a refresh
# already running, and every trigger would exit 0 having done nothing.
require_lock_tool() {
  if ! command -v lockf >/dev/null 2>&1 && ! command -v flock >/dev/null 2>&1; then
    echo "docs-site: neither lockf nor flock is installed — a refresh cannot hold its lock, so none runs"
    return 1
  fi
}

# Run one round under the lock, or exit 75 at once when a refresh already holds it.
locked_round() {
  mkdir -p "$state_dir"
  (
    local legacy
    exec 9>>"$refresh_lock"
    take_lock_fd 9 || exit 75
    if legacy="$(legacy_refresh_lock)"; then
      exec 8>>"$legacy"
      take_lock_fd 8 || exit 75
    fi
    exec bash "${BASH_SOURCE[0]}" --refresh-round
  )
}

# Whether a refresh holds the lock now. A probe takes the lock for an instant, so a real refresh meeting
# it reads "already running" — harmless, because the prober is itself a refresh that goes on to take the
# lock when there is work to do.
refresh_running() {
  local legacy
  mkdir -p "$state_dir"
  if ! (
    exec 9>>"$refresh_lock"
    take_lock_fd 9
  ); then
    return 0
  fi
  legacy="$(legacy_refresh_lock)" || return 1
  ! (
    exec 8>>"$legacy"
    take_lock_fd 8
  )
}

# The pid of the refresh holding the lock, for the line that says one is running. Display only.
refresh_holder() {
  cat "$refresh_pid" 2>/dev/null || echo "?"
}

# The one-line answer to "does this checkout's console need a rebuild", or a non-zero exit when it does.
# Printed by both the foreground and the background form, so the hook's line and the log agree. A recorded
# production console whose server is down DOES need one — that is how a failed restart recovers on the next
# pull instead of reading as a checkout that serves nothing.
refresh_not_needed() {
  local head
  if ! record_is_production; then
    echo "docs-site: no production console is recorded for $root — nothing to rebuild"
    return 0
  fi
  head="$(head_sha)"
  if record_live && [[ "$(record_field sha)" == "$head" ]]; then
    echo "docs-site: the console already serves ${head:0:9}"
    return 0
  fi
  if refresh_running; then
    if held_build; then
      return 0
    fi
    if kill -0 "$(refresh_holder)" 2>/dev/null; then
      echo "docs-site: a rebuild is already running (pid $(refresh_holder)) — it re-reads HEAD when it finishes"
    else
      echo "docs-site: a build left by a killed refresh still holds the lock (its round is gone) — nothing follows it, so run --refresh again once it ends"
    fi
    return 0
  fi
  return 1
}

# Start the recorded build again on a console that is down — what a round falls back to when the build it
# was bringing in failed to build or failed to start. The recorded slot is never the one a round empties.
restart_recorded() {
  local port="$1" served="$2" old_slot="$3"
  if [[ -z "$served" || ! -d "$site/$old_slot" ]]; then
    echo "docs-site: :$port is DOWN — there is no earlier build to go back to"
    return 1
  fi
  echo "docs-site: going back to ${served:0:9} on site/$old_slot"
  if ! wait_port_free "$port" || ! start_production "$port" "$old_slot" "$served"; then
    echo "docs-site: ${served:0:9} did not start either — :$port is DOWN; the record stays, so the next pull or --refresh retries"
    return 1
  fi
}

# ONE rebuild, run under the lock by `locked_round` (never directly): build the idle slot while the old
# server keeps answering, stop it, start the new slot, and only once the new one answers a page move the
# record and delete the old slot. Nothing here deletes a production record: it names the last build that
# answered a page from start to finish, so a round that fails — or is killed at any line — leaves the next
# pull, sync or `--refresh` a console to bring back, and `reap_strays` clears whatever it left running.
refresh_round() {
  local head served old_slot slot port old_pid
  echo "$$" >"$refresh_pid"
  # Under the lock no other round is holding, so a `waiting.json` here is one a killed round left behind.
  rm -f "$hold_dir/waiting.json"
  head="$(head_sha)"
  if record_is_production; then
    served="$(record_field sha || true)"
    old_slot="$(record_field slot || true)"
    port="$(record_field port)"
    old_pid="$(record_field pid)"
  else
    served=""
    old_slot=""
    port="${DOCS_SITE_PORT:-3000}"
    old_pid=""
  fi
  reap_strays "$port"
  if record_live && [[ "$served" == "$head" ]]; then
    return 0
  fi
  if ! record_live && port_in_use "$port"; then
    echo "docs-site: port $port is held by pid(s) $(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN | tr '\n' ' ')which no record here names. If it is a console a killed refresh left, kill that pid (not --stop, which forgets the record the next pull rebuilds from), or set DOCS_SITE_PORT"
    return 1
  fi
  slot="$(idle_slot)"
  echo "docs-site: $(date -u +%Y-%m-%dT%H:%M:%SZ) building ${head:0:9} into site/$slot for :$port"
  if ! build_slot "$slot" "$head"; then
    if record_live; then
      echo "docs-site: the build of ${head:0:9} FAILED — :$port still serves ${served:0:9}; the build output is above"
      return 1
    fi
    echo "docs-site: the build of ${head:0:9} FAILED, and :$port is down; the build output is above"
    restart_recorded "$port" "$served" "$old_slot" || true
    return 1
  fi
  # Only a console that is answering has a page a call could be on; one that is down is brought back at once.
  if record_live; then
    hold_for_calls "$head"
  fi
  if record_live; then
    echo "docs-site: stopping ${served:0:9} on port $port (pid $old_pid)"
    if ! end_tree "$old_pid"; then
      echo "docs-site: ${served:0:9}'s server was not ended for certain — not starting a new one beside it"
      return 1
    fi
  fi
  if ! wait_port_free "$port"; then
    echo "docs-site: port $port is still held by pid(s) $(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN | tr '\n' ' ')— not starting over it"
    return 1
  fi
  if start_production "$port" "$slot" "$head"; then
    if [[ -n "$old_slot" && "$old_slot" != "$slot" ]]; then
      rm -rf "${site:?}/$old_slot"
    fi
    return 0
  fi
  echo "docs-site: ${head:0:9} did not start"
  restart_recorded "$port" "$served" "$old_slot" || true
  return 1
}

# Bring the recorded production console onto HEAD. Each round runs under the lock; between rounds HEAD is
# read AGAIN. That order is what makes "it re-reads HEAD when it finishes" true for a trigger turned away:
# its pull landed before it tried the lock, and the lock was held then, so this re-read comes after the
# pull. Three rounds bound a HEAD that never settles; a failed round stops here unless HEAD has moved since,
# because a later commit may be the fix.
refresh_production() {
  local rounds=0 status before
  require_lock_tool || return 1
  while true; do
    if refresh_not_needed; then
      return 0
    fi
    rounds=$((rounds + 1))
    if ((rounds > 3)); then
      echo "docs-site: HEAD moved during three rebuilds in a row — the next pull rebuilds"
      return 0
    fi
    before="$(head_sha)"
    status=0
    locked_round || status=$?
    if ((status == 75)); then
      echo "docs-site: a rebuild is already running (pid $(refresh_holder)) — it re-reads HEAD when it finishes"
      return 0
    fi
    if ((status != 0)) && [[ "$(head_sha)" == "$before" ]]; then
      return 1
    fi
  done
}

# Run the move under one lock every run of THIS script takes, waiting up to a minute for another run's move to
# finish, so two of them never interleave their renames: one checking a target absent while the other creates and
# locks it would let the first rename over a lock a refresh holds. A pre-move script takes no such
# lock; what keeps its refresh out is the home lock `locked_round` takes too. Once the wait runs out this run
# REFUSES rather than moving unlocked or going on beside a move half done, and so does a machine with
# no lock tool at all, where no refresh can run either (`require_lock_tool`).
migrate_legacy_state_locked() {
  [[ -d "$legacy_state_dir" || -L "$legacy_state_dir" ]] || return 0
  if ! command -v lockf >/dev/null 2>&1 && ! command -v flock >/dev/null 2>&1; then
    echo "docs-site: neither lockf nor flock is installed, so the console's records in $legacy_state_dir cannot be moved safely; nothing was done" >&2
    return 1
  fi
  mkdir -p "$cache_root"
  (
    exec 6>>"$cache_root/docs-site.migrate.lockf"
    if command -v lockf >/dev/null 2>&1; then
      taken=0
      lockf -s -t 60 6 || taken=$?
    else
      taken=0
      flock -w 60 6 || taken=$?
    fi
    if ((taken != 0)); then
      echo "docs-site: another run has been moving the console's records from $legacy_state_dir for a minute; nothing was done — run this again once it finishes" >&2
      exit 1
    fi
    migrate_legacy_state
  )
}

migrate_legacy_state_locked

if [[ "${1:-}" == "--check" ]]; then
  for required in package.json yarn.lock next.config.mjs content/index.mdx content/phases/listener.mdx; do
    if [[ ! -e "$site/$required" ]]; then
      echo "docs-site: missing $site/$required" >&2
      exit 1
    fi
  done
  echo "docs-site: wired — run 'yarn docs' to read it"
  exit 0
fi

if [[ "${1:-}" == "--status" ]]; then
  if record_live; then
    echo "docs-site: http://localhost:$(record_field port) — pid $(record_field pid), started $(record_field startedIso), log $(record_field log)"
    exit 0
  fi
  # Kept, not cleared: a production record is what brings a console that died back on the next pull.
  if record_is_production; then
    echo "docs-site: the production console on :$(record_field port) is DOWN (last built $(record_field sha | cut -c1-9)) — --refresh, or the next pull, brings it back"
    exit 0
  fi
  if [[ -f "$record" ]]; then
    echo "docs-site: a record exists but its server is gone — clearing $record"
    rm -f "$record"
    exit 0
  fi
  echo "docs-site: no server recorded for $root"
  exit 0
fi

if [[ "${1:-}" == "--stop" ]]; then
  stop_recorded
  exit 0
fi

if [[ "${1:-}" == "--start" ]]; then
  check_serving_cli || exit 1
  if record_live; then
    echo "docs-site: reusing http://localhost:$(record_field port) (pid $(record_field pid)) — already serving $root"
    exit 0
  fi
  refuse_dev_over_production
  rm -f "$record"
  start_server
  echo "http://localhost:$(record_field port)"
  exit 0
fi

# The console as the owner reads it: a production build served by `next start` on :3000 (`DOCS_SITE_PORT` moves it).
# Refuses rather than picking another port — the console's address is the thing the owner has bookmarked. A
# recorded production console that is down is brought back by a refresh rather than started from nothing.
if [[ "${1:-}" == "--serve" ]]; then
  if record_live && ! record_is_production; then
    echo "docs-site: a DEV server is recorded here (pid $(record_field pid), port $(record_field port)) — --stop it first"
    exit 1
  fi
  if record_is_production; then
    if record_live; then
      echo "docs-site: already serving $(record_field sha | cut -c1-9) at http://localhost:$(record_field port) — --refresh brings it onto HEAD"
      exit 0
    fi
    refresh_production
    exit $?
  fi
  rm -f "$record"
  require_lock_tool || exit 1
  status=0
  locked_round || status=$?
  if ((status == 75)); then
    echo "docs-site: a rebuild is already running (pid $(refresh_holder))"
    exit 0
  fi
  exit "$status"
fi

# One rebuild under the lock — `refresh_production`'s own call, never a caller's.
if [[ "${1:-}" == "--refresh-round" ]]; then
  refresh_round
  exit $?
fi

# The call hold alone, exactly as a round runs it once its slot is built — the seam
# `src/__tests__/subprocess/scripts/docsSiteCallHold.test.ts` drives, since a whole round needs a Next build.
if [[ "${1:-}" == "--hold-for-calls" ]]; then
  hold_for_calls "$2"
  exit $?
fi

# The swap's stop alone, exactly as a round ends the server it replaces — the seam
# `src/__tests__/subprocess/scripts/docsSiteEndTree.test.ts` drives, since a whole round needs a Next build.
if [[ "${1:-}" == "--end-tree" ]]; then
  end_status=0
  end_tree "${2:-}" || end_status=$?
  exit "$end_status"
fi

# The stale-typegen sweep alone, exactly as `build_slot` runs it before a build — the seam
# `src/__tests__/subprocess/scripts/docsSiteGeneratedTypes.test.ts` drives, since a build needs Next.
if [[ "${1:-}" == "--clear-generated-types" ]]; then
  clear_generated_types
  exit 0
fi

# Bring the production console onto HEAD. `--background` answers the three do-nothing cases in the
# foreground, then hands the rebuild to a background run and returns at once: a git hook must not hold the
# terminal for a 25-second build. The background run is bounded — it builds, restarts and exits — and writes
# every line to the refresh log under the run record.
if [[ "${1:-}" == "--refresh" ]]; then
  if [[ "${2:-}" != "--background" ]]; then
    refresh_production
    exit $?
  fi
  require_lock_tool || exit 1
  if refresh_not_needed; then
    exit 0
  fi
  mkdir -p "$state_dir"
  (
    exec env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR \
      bash "${BASH_SOURCE[0]}" --refresh >>"$refresh_log" 2>&1 </dev/null
  ) &
  if record_live; then
    meanwhile="keeps serving $(record_field sha | cut -c1-9) until it is ready"
  else
    meanwhile="is DOWN, and comes back when it is ready"
  fi
  echo "docs-site: rebuilding the console onto $(head_sha | cut -c1-9) in the background — :$(record_field port) $meanwhile; log $refresh_log"
  exit 0
fi

if [[ "${1:-}" == "--overflow" ]]; then
  # Every figure on every page, measured against its own frame and its own panels.
  #
  # SVG text does not wrap and does not warn: a string too long for its box is drawn past the edge and
  # cropped by the frame, so the page renders a SHORTER sentence rather than a broken one. Nine nodes
  # across seven figures shipped that way once, one of them losing the whole claim its figure was
  # drawn for. Nothing in a diff shows this, so it is measured in a real browser instead.
  #
  # The node script is written out here rather than committed as a .mjs because playwright resolves from
  # the REPO ROOT (the site's own project does not carry it) and because `yarn lint` runs oxlint over `.` —
  # a committed file would be a lint surface for a tool that only ever runs by hand, against a live server.
  # The sweep needs a live server, and a helper that leaves one behind is the stray-server defect itself. So it
  # starts one only when none is up, and stops EXACTLY what it started: a server that was already serving
  # this worktree (or a base URL the caller named) is left alone, because a seat is reading it.
  #
  # The trap goes on BEFORE anything is started, not after: under `set -e` every command between the start
  # and the `trap` is a window where a failure exits with a server running and no cleanup armed. Found by
  # the `record-never-leaks-or-oversteps` pass. Both variables it reads are initialised
  # here so the handler is safe to fire at any point after this line.
  started_here=""
  sweep=""
  sweep_cleanup() {
    [[ -n "$sweep" ]] && rm -f "$sweep"
    if [[ -n "$started_here" ]]; then
      stop_recorded
    fi
    return 0
  }
  trap sweep_cleanup EXIT
  if [[ -n "${2:-}" ]]; then
    base="$2"
  elif record_live; then
    base="http://localhost:$(record_field port)"
    echo "docs-site: sweeping the server already running at $base"
  else
    # `started_here` is set BEFORE the start, so a server that comes up and then fails its readiness wait
    # is still the handler's to stop. `start_server` cleaning up after itself makes that a no-op, not a
    # double kill: `stop_recorded` answers "nothing recorded" once the record is gone.
    refuse_dev_over_production
    started_here="yes"
    start_server
    base="http://localhost:$(record_field port)"
  fi
  pages="$(find "$site/content" -name '*.mdx' | sed "s|^$site/content||; s|\.mdx\$||; s|/index\$||; s|^\$|/|" | sort | tr '\n' ' ')"
  # Under the root node_modules, so that ESM resolution walks up into it and finds playwright. A temp
  # directory cannot: module resolution starts at the FILE, and /tmp has no node_modules above it.
  mkdir -p "$root/node_modules/.cache"
  sweep="$root/node_modules/.cache/docs-site-overflow.$$.mjs"
  cat > "$sweep" <<'SWEEP'
import { chromium } from "playwright";

const paths = process.env.SW_PAGES.trim().split(/\s+/);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
let bad = 0;
for (const path of paths) {
  await page.goto(process.env.SW_BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  const hits = await page.evaluate(() => {
    const out = [];
    for (const svg of document.querySelectorAll(".sw-figure > svg")) {
      const frame = svg.getBoundingClientRect();
      // getBoundingClientRect, never getBBox: getBBox reports a node in its OWN space, before its
      // transform, so a rotated label reads as 14 units past the right edge while sitting comfortably
      // inside it. That false positive is why this measures the painted box.
      const scale = frame.width / svg.viewBox.baseVal.width;
      const say = (why, over, node) =>
        out.push({ why, over: (over / scale).toFixed(1), text: (node.textContent || "").trim().slice(0, 56) });

      // Past the FRAME — the clipping one. The viewBox crops it and the sentence simply reads short.
      for (const node of svg.querySelectorAll("text, rect")) {
        const box = node.getBoundingClientRect();
        if (box.width === 0) continue;
        const over = Math.max(box.right - frame.right, frame.left - box.left, box.bottom - frame.bottom);
        if (over / scale > 1) say("past the frame", over, node);
      }

      // Past its own PANEL, which the frame check cannot see: a card anywhere but hard against the right
      // edge can spill its text across the card beside it and still be well inside the viewBox.
      for (const group of svg.querySelectorAll("g")) {
        const card = group.querySelector(":scope > rect");
        const texts = [...group.querySelectorAll(":scope > text")];
        if (card === null || texts.length === 0) continue;
        const cb = card.getBoundingClientRect();
        const boxes = texts.map((node) => ({ box: node.getBoundingClientRect(), node }));
        for (const { box, node } of boxes) {
          const over = Math.max(box.right - cb.right, cb.left - box.left, box.bottom - cb.bottom, cb.top - box.top);
          if (over / scale > 1) say("past its panel", over, node);
        }

        // Two stacked lines colliding. Compared only where they share horizontal ground: a left-anchored
        // and a right-anchored label on ONE baseline sit side by side, and reading that pair as a collision
        // was this check own first false positive, on four figures at once.
        const stack = [...boxes].sort((a, b) => a.box.top - b.box.top);
        for (let i = 1; i < stack.length; i += 1) {
          const above = stack[i - 1].box;
          const here = stack[i].box;
          if (here.left >= above.right || above.left >= here.right) continue;
          if ((above.bottom - here.top) / scale > 1) say("overlaps the line above", above.bottom - here.top, stack[i].node);
        }
      }
    }
    return out;
  });
  for (const hit of hits) {
    bad += 1;
    console.log(path + "  " + hit.why + " +" + hit.over + "  " + hit.text);
  }
}
console.log("pages checked: " + paths.length + " | misplaced nodes: " + bad);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
SWEEP
  cd "$root"
  SW_BASE="$base" SW_PAGES="$pages" node "$sweep"
  exit $?
fi

if [[ "${1:-}" == "--nav-timing" ]]; then
  # How long the console takes to answer the owner, measured in a real browser against a server already up: each page's
  # first paint and hydration on a fresh tab, then six sidebar clicks with one console tab open and with four, each
  # timed from the click to the first frame that shows it (the pending bar, the loading skeleton or the new address)
  # and to the frame its page lands in. The symptom: dead clicks on an open tab, one to three seconds on
  # a fresh one (`site/lib/liveSlots.ts`, `site/lib/navStall.ts`).
  #
  # Every console tab in one browser shares one connection pool, so the four-tab run is the case that reproduced the
  # dead click. Headless Chromium reports every tab visible, so the hidden-tab hold never engages here: the four-tab
  # numbers are the worst case, not the owner's. Timed in the page against `Date.now()` and kept in `sessionStorage`, so a
  # click that ends in a document load is timed across it and reported as `doc`. Written out for the same reasons
  # as `--overflow`'s sweep, and it never starts a server: a timing over a server it had just built measures the build.
  base="${2:-}"
  if [[ -z "$base" ]]; then
    if ! record_live; then
      echo "docs-site: --nav-timing measures a server already up; start one with --start or name a base url" >&2
      exit 1
    fi
    base="http://localhost:$(record_field port)"
  fi
  mkdir -p "$root/node_modules/.cache"
  timing="$root/node_modules/.cache/docs-site-nav-timing.$$.mjs"
  trap 'rm -f "$timing"' EXIT
  cat > "$timing" <<'TIMING'
import { chromium } from "playwright";

const base = process.env.SW_BASE;
const settleMs = Number(process.env.SW_SETTLE_MS);
const pages = ["/queue", "/pull-requests", "/workstreams", "/fleet"];
const clicks = ["/pull-requests", "/workstreams", "/fleet", "/queue", "/pull-requests", "/fleet"];

// Runs in every document: the click's instant, then on each frame whether it is drawn yet and whether it landed.
const probe = () => {
  const nav = () => JSON.parse(sessionStorage.getItem("swNav") ?? "null");
  addEventListener(
    "click",
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('nav[aria-label="console"] a') : null;
      if (link !== null) {
        sessionStorage.setItem("swNav", JSON.stringify({ at: Date.now(), to: new URL(link.href).pathname }));
      }
    },
    true,
  );
  window.swHydratedMs = undefined;
  const frame = () => {
    const link = document.querySelector('nav[aria-label="console"] a');
    if (window.swHydratedMs === undefined && link !== null && Object.keys(link).some((k) => k.startsWith("__reactProps"))) {
      window.swHydratedMs = performance.now();
    }
    const n = nav();
    if (n !== null && n.landed === undefined) {
      const now = Date.now();
      const moved = location.pathname === n.to;
      const skeleton = document.querySelector("[data-console-loading]") !== null;
      if (n.shown === undefined && (moved || skeleton || document.querySelector("[data-nav-progress]") !== null)) {
        n.shown = now - n.at;
      }
      if (moved && !skeleton && document.querySelector("main h1") !== null) {
        n.landed = now - n.at;
        n.doc = performance.timeOrigin > n.at;
      }
      sessionStorage.setItem("swNav", JSON.stringify(n));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

const browser = await chromium.launch();

console.log(`fresh tab, ${base}`);
console.log("| page | first paint | hydrated |");
console.log("| --- | --- | --- |");
const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await fresh.addInitScript(probe);
for (const path of pages) {
  const page = await fresh.newPage();
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForFunction(() => window.swHydratedMs !== undefined, undefined, { timeout: 30_000 });
  const [fcp, hydrated] = await page.evaluate(() => [
    performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
    window.swHydratedMs,
  ]);
  console.log(`| ${path} | ${Math.round(fcp)} ms | ${Math.round(hydrated)} ms |`);
  await page.close();
}
await fresh.close();

for (const tabs of [1, 4]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(probe);
  for (let i = 1; i < tabs; i += 1) {
    const other = await ctx.newPage();
    await other.goto(base + pages[i % pages.length], { waitUntil: "load" });
  }
  const page = await ctx.newPage();
  await page.goto(base + "/queue", { waitUntil: "load" });
  await page.bringToFront();
  await page.waitForTimeout(settleMs);
  console.log(`\n${tabs} console tab(s), clicks from /queue ${settleMs} ms after load`);
  console.log("| click | shown | landed |");
  console.log("| --- | --- | --- |");
  for (const to of clicks) {
    await page.evaluate(() => sessionStorage.removeItem("swNav"));
    await page.locator(`nav[aria-label="console"] a[href^="${to}"]`).first().click({ noWaitAfter: true });
    let n = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && (n === null || n.landed === undefined)) {
      await page.waitForTimeout(100);
      n = await page.evaluate(() => JSON.parse(sessionStorage.getItem("swNav") ?? "null")).catch(() => n);
    }
    const shown = n?.shown === undefined ? "never" : `${n.shown} ms`;
    const landed = n?.landed === undefined ? "DEAD >30 s" : `${n.landed} ms${n.doc ? " (doc)" : ""}`;
    console.log(`| → ${to} | ${shown} | ${landed} |`);
    await page.waitForTimeout(2_000);
  }
  await ctx.close();
}
await browser.close();
TIMING
  cd "$root"
  SW_BASE="$base" SW_SETTLE_MS="${SW_SETTLE_MS:-5000}" node "$timing"
  exit $?
fi

cd "$site"

if site_install_stale; then
  echo "docs-site: installing the site's own dependencies (they are NOT in the root install)"
  nested_yarn install
fi

if [[ "${1:-}" == "--build" ]]; then
  shift
  # A dev server and a production build share .next, and a build run over a live dev tree leaves a
  # webpack runtime that cannot find its own vendor chunks. Start from nothing rather than debug that.
  rm -rf .next
  clear_generated_types
  export_build_identity "$(head_sha)"
  nested_yarn build "$@"
  exit 0
fi

check_serving_cli || exit 1

# REUSE, never a second server. Before the run record existed this line started another `next dev` every
# time it was reached, and Next silently took the next free port — which is how one worktree ended up
# holding four of them. A live server for this worktree is now what `yarn docs` answers with.
if record_live; then
  echo "docs-site: already serving this worktree at http://localhost:$(record_field port) (pid $(record_field pid))"
  echo "docs-site: stop it with 'bash scripts/docs-site.sh --stop', or read its log at $(record_field log)"
  exit 0
fi
refuse_dev_over_production
rm -f "$record"

# The foreground server records itself too, and clears the record on the way out — so a Ctrl-C leaves
# nothing behind claiming a server is up, and a crash leaves a record the liveness check discards.
serve_args=("$@")
if caller_port="$(port_in_args "$@")"; then
  port="$caller_port"
else
  port="${DOCS_SITE_PORT:-$(pick_port)}"
  serve_args=(--port "$port" "$@")
fi
mkdir -p "$state_dir"
# `stop_recorded`, not a bare `rm`: on a Ctrl-C the server is already dead and the recycled-pid check
# clears the record and signals nothing, while on a SIGTERM to this script the child can outlive it — and
# removing the record there would leave a server running that nothing could name.
serve_cleanup() {
  stop_recorded
}
trap serve_cleanup EXIT
echo "docs-site: http://localhost:$port — internal, served from this machine only"
export_build_identity "$(head_sha)"
"${yarn_scrub[@]}" yarn dev "${serve_args[@]}" --hostname "$console_host" &
serve_pid=$!
write_record "$serve_pid" "$port" "(foreground)"
wait "$serve_pid"
