# shellcheck shell=bash
# The profile DELIVERY marker, read and cleared from bash so neither needs node — `src/context/profileDelivery.ts`
# is the node half and carries why the marker exists (a session does nothing rather than act
# misaligned for the owner).
#
# `$SLOPWEAVER_HOME/profile/delivered/<context>` exists only while that CONTEXT holds the owner's profile: `<session id>` for
# a main thread, `<session id>-agent-<hash of agent_id>` for a subagent, which is a context of its own that no
# SessionStart reached (both hosts put `agent_id` on a subagent's hook payload and on no main thread's). The cheap
# readers (`profile_delivery_present`, `profile_delivery_clear`) never compute the subagent name, so they read a
# subagent payload as unmarked and clear every subagent marker of the session, both erring toward a reload; the
# recovery lane below keys it exactly as node does and checks a marker is CURRENT, never only that one exists.
#
# `hooks/profile-context.sh` clears it before node starts on every SessionStart, and node writes it back only after
# printing the block, so a hook the envelope kills mid-boot leaves none. MEASURED: every one of the seven
# sessions `slopweaver monitor check --only profile-unloaded` named was that kill, "killed after 7s".
#
# The cheap readers are builtins only apart from `rm`; everything is bash 3.2 (macOS `/bin/bash`). The session id grammar is `seat-pass.sh`'s.

# profile_home_export — set `SLOPWEAVER_HOME` the way the `bin/slopweaver` launcher does when the environment leaves it
# unset: the config file's value, then the plugin option. A hook that starts node WITHOUT the launcher calls this
# first, so its gates read and write the same home the launcher's `profile hook` and `profile context` marked —
# otherwise a home named only in the config file left every reload marking one home while the hold read another, a
# hold no reload could lift. Exports nothing when nothing names one.
profile_home_export() {
  [ -z "${SLOPWEAVER_HOME:-}" ] || return 0
  local cfg="${XDG_CONFIG_HOME:-${HOME:-}/.config}/slopweaver/env"
  local key value from_cfg=""
  if [ -f "$cfg" ]; then
    while IFS='=' read -r key value; do
      [ "$key" = SLOPWEAVER_HOME ] && [ -z "$from_cfg" ] && from_cfg="$value"
    done <"$cfg"
  fi
  [ -n "$from_cfg" ] || from_cfg="${CLAUDE_PLUGIN_OPTION_SLOPWEAVER_HOME:-}"
  [ -n "$from_cfg" ] || return 0
  SLOPWEAVER_HOME="$from_cfg"
  export SLOPWEAVER_HOME
}

# The characters JavaScript's `String.prototype.trim` strips, as UTF-8 bytes: the six ASCII ones, then U+00A0, U+1680,
# U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Bash's `[[:space:]]` is the locale's set, which
# missed U+FEFF, so a `$SLOPWEAVER_HOME` node reads as blank named a home here. The subprocess
# lane checks this list against node over every code point in the Basic Multilingual Plane.
PROFILE_JS_BLANKS=($'\t' $'\n' $'\v' $'\f' $'\r' ' ' $'\xc2\xa0' $'\xe1\x9a\x80' $'\xe2\x80\x80' $'\xe2\x80\x81'
  $'\xe2\x80\x82' $'\xe2\x80\x83' $'\xe2\x80\x84' $'\xe2\x80\x85' $'\xe2\x80\x86' $'\xe2\x80\x87' $'\xe2\x80\x88'
  $'\xe2\x80\x89' $'\xe2\x80\x8a' $'\xe2\x80\xa8' $'\xe2\x80\xa9' $'\xe2\x80\xaf' $'\xe2\x81\x9f' $'\xe3\x80\x80'
  $'\xef\xbb\xbf')

# profile_blank <value> — exit 0 when <value> is empty or only what `trim()` strips, read as node decodes it: one whole
# character at a time from the front, bytes compared under `LC_ALL=C`, so no byte sequence is ever joined across a
# removal into a character node would not have decoded. Builtins only.
profile_blank() {
  local LC_ALL=C value="$1" blank
  while [ -n "$value" ]; do
    for blank in "${PROFILE_JS_BLANKS[@]}"; do
      case "$value" in
        "$blank"*)
          value="${value#"$blank"}"
          continue 2
          ;;
      esac
    done
    return 1
  done
  return 0
}

# profile_delivery_present <payload> — exit 0 when this payload's MAIN-THREAD context holds a delivery marker, else 1.
# A subagent's payload answers 1. Reads the home the way `slopweaverHomeOf` (`src/homeDir.ts`) does from the caller's
# environment, which `profile_home_export` has already aligned with the launcher's.
profile_delivery_present() {
  local agent_pattern='"agent_id"[[:space:]]*:'
  [[ $1 =~ $agent_pattern ]] && return 1
  local id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([0-9A-Za-z-]+)"'
  [[ $1 =~ $id_pattern ]] || return 1
  local session_id="${BASH_REMATCH[1]}"
  local home="${SLOPWEAVER_HOME:-}"
  ! profile_blank "$home" || home="${HOME:-}/.slopweaver"
  case "$home" in /*) ;; *) return 1 ;; esac
  [ -f "$home/profile/delivered/$session_id" ]
}

# THE BASH RECOVERY LANE — what a PreToolUse shim does when no node gate can run at all (no runtime, no tree carrying
# the dispatcher, a mirror target that is not there). A bare existence check let a marker a
# compaction had outdated release the call, and refusing a context with no marker held it forever, because the node
# hold that delivers the owner's profile is exactly what cannot run. So bash checks the marker is CURRENT itself, and when it
# is not, delivers the owner's profile from the plain-text copy `writeContextCache` keeps beside the cache and writes the
# marker behind it — the same one-turn recovery the node hold makes, with no node. Forks are fine here: nothing on
# this path has a budget left to protect, and nothing calls it on a call node can judge.

# profile_context_of <payload> — set PROFILE_CONTEXT_ID and PROFILE_TRANSCRIPT the way `deliveryContextOf` does
# (`src/context/profileDelivery.ts`), hashing a subagent's `agent_id` with `shasum` or `sha256sum`. Exit 1 when the
# payload names no context bash can key exactly as node would — an escape in either string, an over-long id, no hasher —
# so a caller treats it as unmarked.
profile_context_of() {
  PROFILE_CONTEXT_ID=""
  PROFILE_TRANSCRIPT=""
  local id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([0-9A-Za-z-]+)"'
  [[ $1 =~ $id_pattern ]] || return 1
  local session_id="${BASH_REMATCH[1]}"
  [ "${#session_id}" -le 128 ] || return 1
  local transcript_key='"transcript_path"[[:space:]]*:'
  local transcript_pattern='"transcript_path"[[:space:]]*:[[:space:]]*"([^"\\]*)"'
  local transcript_null='"transcript_path"[[:space:]]*:[[:space:]]*null'
  if [[ $1 =~ $transcript_pattern ]]; then
    PROFILE_TRANSCRIPT="${BASH_REMATCH[1]}"
  elif [[ $1 =~ $transcript_key ]] && ! [[ $1 =~ $transcript_null ]]; then
    return 1
  fi
  local agent_key='"agent_id"[[:space:]]*:'
  if ! [[ $1 =~ $agent_key ]]; then
    PROFILE_CONTEXT_ID="$session_id"
    return 0
  fi
  local agent_pattern='"agent_id"[[:space:]]*:[[:space:]]*"([^"\\]+)"'
  [[ $1 =~ $agent_pattern ]] || return 1
  local agent_id="${BASH_REMATCH[1]}" digest=""
  if command -v shasum >/dev/null 2>&1; then
    digest="$(printf '%s' "$agent_id" | shasum -a 256 2>/dev/null)"
  elif command -v sha256sum >/dev/null 2>&1; then
    digest="$(printf '%s' "$agent_id" | sha256sum 2>/dev/null)"
  fi
  digest="${digest%% *}"
  [[ $digest =~ ^[0-9a-f]{64}$ ]] || return 1
  PROFILE_CONTEXT_ID="$session_id-agent-${digest:0:32}"
}

# profile_home_dir — print the home node reads, the way `profile_delivery_present` resolves it; exit 1 for a relative one.
profile_home_dir() {
  local home="${SLOPWEAVER_HOME:-}"
  ! profile_blank "$home" || home="${HOME:-}/.slopweaver"
  case "$home" in /*) ;; *) return 1 ;; esac
  printf '%s\n' "$home"
}

# profile_delivery_current <payload> — exit 0 only when this payload's context holds a marker node would also accept:
# version 1, the transcript the payload names, and no compaction record in that transcript past the marker's offset.
# Stricter than node in one way, on purpose: it never credits a marker's expected boundary, so a compaction's own
# boundary costs one redelivery here rather than a guess. An `unread` marker is spent by the read, as node spends it.
profile_delivery_current() {
  profile_context_of "$1" || return 1
  local home
  home="$(profile_home_dir)" || return 1
  local marker="$home/profile/delivered/$PROFILE_CONTEXT_ID"
  [ -f "$marker" ] || return 1
  local version="" offset="" boundary="" transcript=""
  {
    IFS= read -r version
    IFS= read -r offset
    IFS= read -r boundary
    IFS= read -r transcript
  } <"$marker" || return 1
  [ "$version" = "profile-delivered v1" ] || return 1
  case "$boundary" in awaits-boundary | settled) ;; *) return 1 ;; esac
  [ "$transcript" = "$PROFILE_TRANSCRIPT" ] || return 1
  [ -n "$PROFILE_TRANSCRIPT" ] || return 0
  if [ "$offset" = unread ]; then
    rm -f "$marker" 2>/dev/null || return 1
    [ -f "$marker" ] && return 1
    wc -c <"$PROFILE_TRANSCRIPT" >/dev/null 2>&1 && return 1
    return 0
  fi
  case "$offset" in '' | *[!0-9]*) return 1 ;; esac
  local size
  size="$(wc -c <"$PROFILE_TRANSCRIPT" 2>/dev/null)" || return 1
  size="${size//[[:space:]]/}"
  case "$size" in '' | *[!0-9]*) return 1 ;; esac
  [ "$size" -ge "$offset" ] || return 1
  # A count rather than `grep -q`, so `tail` is never cut short by SIGPIPE, and `tail`'s OWN status is checked: a scan
  # that failed must never read as a scan that found nothing (a transcript gone between the size
  # and the scan, or a `tail` that could not start, would be credited as current).
  local scanned
  scanned="$(
    tail -c +"$((offset + 1))" "$PROFILE_TRANSCRIPT" 2>/dev/null | grep -Fc -e '"subtype":"compact_boundary"' -e '"type":"compacted"'
    printf 'tail=%s\n' "${PIPESTATUS[0]}"
  )"
  [ "$scanned" = "0"$'\n'"tail=0" ] || return 1
  # Node reads one open file; bash reads the path twice, so a transcript that shrank in between is not the one sized.
  local after
  after="$(wc -c <"$PROFILE_TRANSCRIPT" 2>/dev/null)" || return 1
  after="${after//[[:space:]]/}"
  case "$after" in '' | *[!0-9]*) return 1 ;; esac
  [ "$after" -ge "$size" ]
}

# profile_last_whole_line_end <transcript> <size> — where the transcript's last whole line ends within its first <size>
# bytes: 64 KiB windows read back from <size>, as node's `lastWholeLineEnd` reads them, until one holds a newline. Each
# window is cut at its own end, so bytes the host appends meanwhile are never read. A sentinel byte after each window
# makes its last line end on no newline, so `tail -n 1` always measures what follows the window's last newline. A
# window read short is no window: an empty one would read as ending on a whole line. Prints the offset, 0 when no line
# ends before <size>; exits 1 when a window could not be read whole.
profile_last_whole_line_end() {
  local path="$1" end="$2" step=65536 start n got after
  while [ "$end" -gt 0 ]; do
    start=$((end > step ? end - step : 0))
    n=$((end - start))
    # `pipefail` off inside each substitution: `head` closing on a window short of the file's end hands `tail` a
    # SIGPIPE, which is the window read whole, not a failure. The byte count is what proves the read.
    got="$(set +o pipefail; tail -c +"$((start + 1))" "$path" 2>/dev/null | head -c "$n" | wc -c)" || return 1
    [ "${got//[[:space:]]/}" = "$n" ] || return 1
    after="$(set +o pipefail; { tail -c +"$((start + 1))" "$path" 2>/dev/null | head -c "$n"; printf x; } | tail -n 1 | wc -c)" || return 1
    after="${after//[[:space:]]/}"
    [[ $after =~ ^[0-9]+$ ]] && [ "$after" -ge 1 ] || return 1
    after=$((after - 1))
    if [ "$after" -lt "$n" ]; then
      printf '%s\n' "$((end - after))"
      return 0
    fi
    end=$start
  done
  printf '0\n'
}

# profile_deliver_from_copy <payload> — write the owner's profile to stderr from `$home/profile/context.txt` and, once every byte
# of it is out, mark this context and append the load to `profile/loads.jsonl`. Exit 0 when the profile was written (a
# context whose marker could not be written is delivered again on its next call), 1 when there is no copy to give.
profile_deliver_from_copy() {
  # A payload bash cannot key (a read cut short, an escaped id or transcript path) still gets the owner's profile; it just
  # cannot be marked, so on THIS lane its retries are held again and the monitor reads it as not yet held. Residue, not
  # closed: Claude Code writes ids and transcript paths unescaped (`~/.claude/projects/<slug>/<uuid>.jsonl`, raw UTF-8),
  # so it takes a hand-built payload; decoding JSON escapes in bash is the mechanism that would close it, and the node
  # gate, which parses JSON, marks such a context on the first call it judges. Inside the
  # envelope, which bounds it, so no deadline.
  if ! profile_context_of "$1"; then
    profile_print_copy >&2
    return
  fi
  local home
  home="$(profile_home_dir)" || return 1
  local copy="$home/profile/context.txt"
  # A readable regular file: a copy present but unreadable would print the header, fail `cat`, and mark nothing, holding
  # every retry the same way. As no copy, the hold names the one way out instead.
  [ -f "$copy" ] && [ -s "$copy" ] && [ -r "$copy" ] || return 1
  {
    printf '%s\n' "# HELD — this call waited for the owner's profile, which this session's context lacked" ""
    printf '%s\n' "No gate could run here, so the owner's profile is delivered from the copy on disk instead. Read it, then make this"
    printf '%s\n' "same call again: it goes through. The owner is asked for nothing; there is no escape hatch for this one (a"
    printf '%s\n' "session does nothing rather than act misaligned for the owner)." ""
    cat "$copy"
  } >&2 || return 0
  local offset=0
  if [ -n "$PROFILE_TRANSCRIPT" ]; then
    offset="$(wc -c <"$PROFILE_TRANSCRIPT" 2>/dev/null)" || offset=unread
    offset="${offset//[[:space:]]/}"
    # Marked at the last WHOLE line, as node's `lastWholeLineEnd` marks, so a record the host is still writing — a
    # compaction among them — is judged by the next check rather than counted as seen. Skipping the mark instead held
    # every retry for as long as the tail stayed partial.
    if [ "$offset" != unread ] && [ "$offset" != 0 ]; then
      offset="$(profile_last_whole_line_end "$PROFILE_TRANSCRIPT" "$offset")" || offset=unread
    fi
  fi
  local dir="$home/profile/delivered"
  local marker="$dir/$PROFILE_CONTEXT_ID"
  mkdir -p "$dir" 2>/dev/null || return 0
  (umask 077 && printf 'profile-delivered v1\n%s\nsettled\n%s\n' "$offset" "$PROFILE_TRANSCRIPT" >"$marker.$$.tmp") || return 0
  mv -f "$marker.$$.tmp" "$marker" 2>/dev/null || return 0
  local session_id="${PROFILE_CONTEXT_ID%%-agent-*}" at
  at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null)" || return 0
  printf '{"atIso":"%s","cwd":"","event":"PreToolUse","origin":"cache","reason":"delivered by the bash recovery lane: no gate could run","sessionId":"%s","source":"hook"}\n' \
    "$at" "$session_id" >>"$home/profile/loads.jsonl" 2>/dev/null || true
  return 0
}

# The most of the copy `profile_print_copy` writes. Under the smallest pipe buffer a host might hand a hook's stderr
# (16 KiB on darwin before it grows), with the envelope's own refusal line and this header beside it, so on a pipe the
# host has drained the print never waits on it. A pipe the target already filled while the host stopped reading is
# not covered — the envelope's own diagnostic blocks there first; that is a host wedged past its hooks, the same
# residue as starvation past the declared timeout. The owner's profile is far smaller — MEASURED with
# `wc -c ~/.slopweaver/profile/context.json`, 4541 bytes — so the cap only ever cuts a copy something else inflated.
PROFILE_PRINT_MAX_BYTES=12288
# The read is bounded by COUNT, not by what it kept: a NUL byte is consumed by `read -n` and never stored, so a byte
# total kept from `${#chunk}` undercounts a NUL-filled copy without limit (reproduced on bash
# 3.2). At most this many reads of at most this many bytes each is the most it ever takes; each read ends at a NUL or
# its byte count, never at a newline, so a real profile takes one read per 256 bytes, and a NUL-filled one byte a read.
PROFILE_PRINT_READ_BYTES=256
PROFILE_PRINT_MAX_READS=1024

# profile_print_copy [deadline] — write the owner's profile from the copy on disk to stdout, builtins only, for a refusal that
# cannot name its context (the envelope's own kill, which never read a payload). It stops at `PROFILE_PRINT_MAX_BYTES`
# written, `PROFILE_PRINT_MAX_READS` reads, or the `$SECONDS` value [deadline] when one is given, whichever comes
# first, and says it was cut short: a harness timeout RUNS the call, so a delivery outliving the declared timeout would
# turn its own refusal into a release. So the READ is bounded as well as the write — at most 1024 reads of 256 bytes,
# about a quarter of a megabyte however the copy is shaped, where a whole-line `read` swallowed a newline-free copy
# entire before any check ran (a one-line 128 MiB copy held the shipped envelope 9.13s against
# a declared 6) — and the WRITE fits a drained pipe whole: everything printed, header and cut-short line included,
# stays under the 16 KiB pipe buffer above. A pipe a host stopped reading once it was full, and a read stalled by the
# disk itself, are not bounded here; each is a machine stalled past any hook. Exit 1 with no regular-file copy.
profile_print_copy() {
  local deadline="${1:-}" chunk home="${SLOPWEAVER_HOME:-}" written=0 reads=0 want mid_line=0
  # Byte lengths and byte reads, not characters, so the cap means what it says under a UTF-8 locale.
  local LC_ALL=C
  ! profile_blank "$home" || home="${HOME:-}/.slopweaver"
  case "$home" in /*) ;; *) return 1 ;; esac
  [ -f "$home/profile/context.txt" ] && [ -s "$home/profile/context.txt" ] && [ -r "$home/profile/context.txt" ] || return 1
  printf '%s\n' "# HELD — this call was ended before any gate could judge it, so the owner's profile is delivered with the refusal" ""
  printf '%s\n' "The machine is too loaded for this session's gates to run. Read the owner's profile below and make the call again;"
  printf '%s\n' "a gate that runs then marks this context. The owner is asked for nothing." ""
  while :; do
    want=$((PROFILE_PRINT_MAX_BYTES - written))
    [ "$want" -le "$PROFILE_PRINT_READ_BYTES" ] || want=$PROFILE_PRINT_READ_BYTES
    if { [ -n "$deadline" ] && [ "$SECONDS" -ge "$deadline" ]; } || [ "$want" -le 0 ] ||
      [ "$reads" -ge "$PROFILE_PRINT_MAX_READS" ]; then
      [ "$mid_line" = 0 ] || printf '\n'
      printf '%s\n' "# CUT SHORT — the rest did not fit before the declared timeout; the next call a gate judges delivers it whole"
      return 0
    fi
    chunk=""
    reads=$((reads + 1))
    # NUL is the delimiter, so every NUL ends a read and the count bounds the bytes on every bash: bash 5 drops a NUL
    # from a newline-delimited `read -n` without counting it, so one read swallowed a NUL-filled copy whole (CI on
    # Linux). Newlines ride inside a chunk, printed as read; status non-zero is end of file.
    if ! IFS= read -r -d '' -n "$want" chunk; then
      printf '%s' "$chunk"
      if [ -n "$chunk" ]; then
        mid_line=1
      fi
      case "$chunk" in *$'\n') mid_line=0 ;; esac
      [ "$mid_line" = 0 ] || printf '\n'
      return 0
    fi
    printf '%s' "$chunk"
    written=$((written + ${#chunk}))
    case "$chunk" in '') ;; *$'\n') mid_line=0 ;; *) mid_line=1 ;; esac
  done <"$home/profile/context.txt"
}

# The by-hand reload `src/admit/profileHeld.ts` lets a held session make, matched as its `RELOAD_PATTERN` matches it:
# the bare launcher on PATH, with or without `--json`. Stricter on one edge, never looser: a JSON escape anywhere in
# the command (`\t`) fails the capture here where node accepts the tab it decodes to; a `\n` fails on both sides.
PROFILE_RELOAD_PATTERN='^[[:space:]]*slopweaver[[:space:]]+profile[[:space:]]+context([[:space:]]+--json)?[[:space:]]*$'

# profile_is_reload <payload> — exit 0 only for a `Bash` call whose command is exactly the by-hand reload. A hold
# with no copy to deliver lets this one call through, as node's does, so the command that writes the copy can run on
# the very path that lacks it (refusing it would leave that hold with no in-band exit).
profile_is_reload() {
  local tool_pattern='"tool_name"[[:space:]]*:[[:space:]]*"Bash"'
  [[ $1 =~ $tool_pattern ]] || return 1
  local command_pattern='"command"[[:space:]]*:[[:space:]]*"([^"\\]*)"'
  [[ $1 =~ $command_pattern ]] || return 1
  [[ ${BASH_REMATCH[1]} =~ $PROFILE_RELOAD_PATTERN ]]
}

# FIRST BOOT, from bash — the twin of node's `readFirstBootEvidence` (`src/admit/profileFirstBoot.ts`), so a machine
# that never had the owner's profile is not held on the one path no node can judge either. A profile that exists
# and did not load is held; with none yet, holding is a self-imposed hardship, and onboarding must never trap
# anyone (this lane was the one first boot could still wedge on). It FAILS CLOSED as node does: a path is absent only when its nearest existing ancestor is a searchable
# directory or no directory at all, so an unreadable or dangling one counts as present. Forks are fine, as for the rest of this lane,
# but every command runs through `command -p`, the system's default path, since node reads the same state with no
# command at all and a `$PATH` missing one must not wedge a fresh machine.

# profile_resolve_path <path> — set PROFILE_RESOLVED to <path> resolved as node's `path.resolve` resolves it:
# against the working directory when relative, then `.`, `..` and repeated slashes folded LEXICALLY, never through a
# symlink. No command substitution touches the path, so a name carrying a newline is read at itself (refusing `..` and newline spellings would hold a fresh machine node opens). Exit 1 only when the working directory
# cannot be named.
profile_resolve_path() {
  local path="$1" rest part out="" cwd
  case "$path" in
    /*) ;;
    *)
      # `pwd -P` is node's `process.cwd()`; the sentinel keeps a trailing newline the substitution would strip.
      cwd="$(pwd -P && printf x)" || return 1
      path="${cwd%$'\n'x}/$path"
      ;;
  esac
  rest="$path"
  while [ -n "$rest" ]; do
    part="${rest%%/*}"
    if [ "$part" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    case "$part" in
      '' | .) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$part" ;;
    esac
  done
  PROFILE_RESOLVED="${out:-/}"
}

# profile_absent <path> — exit 0 only when nothing sits at <path>, an absolute path profile_resolve_path folded, and
# that absence is proven: its nearest existing ancestor is a searchable directory, or is no directory at all, so nothing
# can sit below it — node's `ENOTDIR`, which it reads as absent too (a stray file at
# `<home>/secrets` would wedge a fresh machine). A dangling link hides what it named, so it is present.
profile_absent() {
  local dir="$1"
  { [ -e "$dir" ] || [ -L "$dir" ]; } && return 1
  while ! { [ -e "$dir" ] || [ -L "$dir" ]; }; do
    [ "$dir" != / ] || return 1
    dir="${dir%/*}"
    dir="${dir:-/}"
  done
  [ -e "$dir" ] || return 1
  [ -d "$dir" ] || return 0
  [ -x "$dir" ]
}

# profile_first_boot_home <home> — exit 0 only when <home> carries none of node's `homeEvidence` traces: no
# `profile/owner-written` mark, no `profile/context.json` or `.txt`, no entry in `profile/delivered/`, and NO load ledger at
# all. Node reads a ledger of `origin: none` rows as fresh; this lane cannot decode JSON, and review found a byte match
# a row node refuses could pass. A first boot writes no row — the hook, the
# prompt-time check, the `profile-held` hold and `profile context` all record nothing there — so any ledger at all is
# read as configured, the safe side, and a fresh machine still opens here.
profile_first_boot_home() {
  local home="$1" path entry
  case "$home" in /*) ;; *) return 1 ;; esac
  for path in "$home/profile/owner-written" "$home/profile/context.json" "$home/profile/context.txt" \
    "$home/profile/loads.jsonl"; do
    profile_absent "$path" || return 1
  done
  path="$home/profile/delivered"
  # A plain file there, or a link resolving to one, holds no marker: node's `readdir` answers `ENOTDIR`, read as no
  # delivery on both lanes. A dangling link fails `-e` and stays a trace.
  if ! profile_absent "$path" && ! { [ -e "$path" ] && ! [ -d "$path" ]; }; then
    [ -d "$path" ] && [ -r "$path" ] && [ -x "$path" ] || return 1
    # `find`, never a glob: `GLOBIGNORE`, `nullglob` or `failglob` set in the environment's shell would hide a marker
    # from one. Each line carries the directory's own path, so even a newline-only name prints
    # something a substitution cannot strip to nothing; a listing that fails is a trace, the safe side.
    # `command -p`: the system's default path, never `$PATH`, which node's `readdir` does not depend on either — a PATH
    # without `find` held a fresh machine node opens.
    entry="$(command -p find "$path" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" || return 1
    [ -z "$entry" ] || return 1
  fi
  return 0
}

# profile_account_home — set PROFILE_ACCOUNT_HOME to the account's own home as the user database names it, which no
# environment variable moves (node's `userInfo().homedir`), as it stands: empty or relative included, since node joins
# either onto `.slopweaver` and reads it under the working directory. Exit 1 only when the
# lookup failed, which leaves the tilde unexpanded. Tilde expansion IS the user-database lookup, and the name is
# checked to a plain account name before it is expanded. A variable, never printed: a substitution would strip a
# trailing newline, and refusing one wedged a fresh machine.
profile_account_home() {
  local user home
  user="$(command -p id -un 2>/dev/null)" || return 1
  [[ $user =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  eval "home=~$user"
  [ "$home" != "~$user" ] || return 1
  PROFILE_ACCOUNT_HOME="$home"
}

# profile_resolve_default <base> — set PROFILE_RESOLVED to node's `resolve(join(base, ".slopweaver"))`: an empty base
# joins to a relative `.slopweaver`, never `/.slopweaver`.
profile_resolve_default() {
  if [ -z "$1" ]; then
    profile_resolve_path ".slopweaver"
  else
    profile_resolve_path "$1/.slopweaver"
  fi
}

# profile_first_boot_in <home>... — exit 0 only when every home named is clean. A selected store is no trace: onboarding
# selects one before any profile exists (`src/admit/ownerProfileWritten.ts`).
profile_first_boot_in() {
  [ "$#" -gt 0 ] || return 1
  local home
  for home in "$@"; do
    profile_first_boot_home "$home" || return 1
  done
  return 0
}

# profile_first_boot — exit 0 only when this machine was never configured, read across the resolved home and
# `~/.slopweaver` under `$HOME` and under the account's own home, exactly the homes node reads, each folded as node's
# `resolve`/`join` fold it: a relative one under the working directory, `..` lexically.
profile_first_boot() {
  local resolved home_default account_default
  profile_account_home || return 1
  profile_resolve_default "$PROFILE_ACCOUNT_HOME" || return 1
  account_default="$PROFILE_RESOLVED"
  # Node's `userDefaultHome`, `join(homedir(), ".slopweaver")`: `homedir()` is `$HOME` whenever it is SET, an empty one
  # included, which joins to a relative `.slopweaver`; unset, it is the user database's. Measured:
  # `HOME= node -p "require('path').join(require('os').homedir(), '.slopweaver')"` prints `.slopweaver`.
  if [ -z "${HOME+set}" ]; then
    home_default="$account_default"
  else
    profile_resolve_default "$HOME" || return 1
    home_default="$PROFILE_RESOLVED"
  fi
  # Node's `slopweaverHomeOf`: a non-blank `$SLOPWEAVER_HOME`, else that default.
  if ! profile_blank "${SLOPWEAVER_HOME:-}"; then
    profile_resolve_path "$SLOPWEAVER_HOME" || return 1
    resolved="$PROFILE_RESOLVED"
  else
    resolved="$home_default"
  fi
  PROFILE_FIRST_BOOT_HOMES=("$resolved" "$home_default" "$account_default")
  profile_first_boot_in "${PROFILE_FIRST_BOOT_HOMES[@]}"
}

# profile_first_boot_admit <payload> — profile_first_boot, and when it opens, mark the payload's session as one that
# began on a first boot, as node's `markFirstBootSession` (`src/admit/firstBootSession.ts`) does: one admitted compound
# call can configure the machine and write a profile, and the door holds a session so marked once a profile exists
# that it never loaded. It is written in every home the read covered, as node writes it, so a
# call that re-points its home at a default one is still found. The marker is no configuration
# trace, so a fresh machine stays fresh. A marker that cannot be written still admits, as node's does: holding would
# wedge the first boot, and `profile set` marks its own session and refuses the row without it.
profile_first_boot_admit() {
  profile_first_boot || return 1
  local id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([0-9A-Za-z-]+)"' home id
  if [[ $1 =~ $id_pattern ]]; then
    id="${BASH_REMATCH[1]}"
    for home in "${PROFILE_FIRST_BOOT_HOMES[@]}"; do
      # Never through a link: `:>` would empty whatever one points at, as node's `O_NOFOLLOW` write refuses to.
      command -p mkdir -p "$home/profile/first-boot" 2>/dev/null && ! [ -L "$home/profile/first-boot/$id" ] &&
        : >>"$home/profile/first-boot/$id" 2>/dev/null
    done
  fi
  return 0
}

# profile_hold_with_copy <payload> — hold a context `profile_delivery_current` refused: deliver the owner's profile, or say there
# is no copy to deliver. Always exits 2, the refusal the caller passes on.
profile_hold_with_copy() {
  if ! profile_deliver_from_copy "$1"; then
    echo "pretooluse: this context holds no current delivery of the owner's profile and no copy of it is on disk, so it is refused until a gate can run and load it" >&2
  fi
  return 2
}

# profile_delivery_clear <payload> — remove this payload's context marker from EVERY home a reader here could resolve:
# the environment's, the default, and the two the `bin/slopweaver` launcher would add (its config file's and the
# plugin option). A subagent's payload clears every subagent marker of the session. Clearing one too many is a reload;
# missing the one a gate reads is a context running without the owner's profile, so this errs wide. Always exits 0 — a payload
# with no usable id has no marker to clear.
profile_delivery_clear() {
  local id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([0-9A-Za-z-]+)"'
  [[ $1 =~ $id_pattern ]] || return 0
  local session_id="${BASH_REMATCH[1]}"
  local agent_pattern='"agent_id"[[:space:]]*:'
  local subagent=0
  [[ $1 =~ $agent_pattern ]] && subagent=1
  local cfg="${XDG_CONFIG_HOME:-${HOME:-}/.config}/slopweaver/env"
  local from_cfg="" key value
  if [ -f "$cfg" ]; then
    while IFS='=' read -r key value; do
      [ "$key" = SLOPWEAVER_HOME ] && [ -z "$from_cfg" ] && from_cfg="$value"
    done <"$cfg"
  fi
  local home
  for home in "${SLOPWEAVER_HOME:-}" "$from_cfg" "${CLAUDE_PLUGIN_OPTION_SLOPWEAVER_HOME:-}" "${HOME:-}/.slopweaver"; do
    case "$home" in /*) ;; *) continue ;; esac
    if [ "$subagent" = 1 ]; then
      rm -f "$home/profile/delivered/$session_id-agent-"* 2>/dev/null || true
    else
      rm -f "$home/profile/delivered/$session_id" 2>/dev/null || true
    fi
  done
  return 0
}
