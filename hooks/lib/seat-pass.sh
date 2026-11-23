# shellcheck shell=bash
# The UserPromptSubmit seat check's cached PASS, answered from bash so a seat it already passed starts no node.
#
# WHY: `claude seat --from-payload` runs on every prompt a seat submits, under `scripts/hook.sh 15`. MEASURED
# at load1 45-55 on 15 cores with swap 6.8/8 GB: the chair's transcript held 13 seat-check
# `hook_cancelled` records in one hour, each at 15.2-15.8 s, so every prompt the owner typed waited out the whole
# budget. By hand the same check took 35.6 s wall for 2.9 s CPU under tsx and 12.9 s wall for 0.93 s CPU built,
# while `/usr/bin/true` took 0.22 s, so node boot is the cost and a faster verb does not remove it. Repro:
#   time ~/.claude/plugins/data/slopweaver*/mirror/by-root/*/current/bin/slopweaver claude seat --from-payload \
#     <<<'{"session_id":"<a live session id>"}'
#
# WHAT HOLDS A PASS: the check judges the credential a session's PROCESS booted on, which cannot change while the
# process lives, plus the API-key variables in this hook's environment, which are re-read below on every hit. So `src/claude/seatPass.ts` writes
# `$SLOPWEAVER_HOME/live/seat-pass/<session id>` = `<pid>\t<procStart>` after an `on-plan` verdict only, and this
# answers PASS while the marker is newer than both inputs that CAN change mid-life — the plan register
# (`claude-accounts/accounts.json`) and Claude's own `settings.json`, whose `apiKeyHelper` turns a seat metered —
# its pid is alive, and Claude's registry for that pid still names the same session id and process start.
#
# A seat on a plan whose usage limit is below 100 is judged on that plan's last recorded reading too, so its marker
# carries three more fields, `\t<alias>\t<reading epoch seconds>\t<expiry epoch seconds>`, checked by
# `seat_pass_usage_current` below. A plan with no limit carries `\t-`. A bare two-field marker predates the usage gate and is a miss: it never said whether
# its plan was limited, so it costs that seat one full check after the change lands.
#
# Every miss returns 1 and the launcher runs the full check unchanged, so a defect here costs time and never
# passes a seat the full check would refuse. Builtins only bar `/bin/date` on a limited plan, and bash 3.2
# (macOS `/bin/bash`).
#
# Two path rules mirror the CLI's and miss rather than guess where they cannot: `slopweaverHome()`
# (`src/homeDir.ts`) and `claudeHomeDir()` (`src/supervisor/chairRead.ts`, which trims `CLAUDE_CONFIG_DIR`).

# Every class below is spelled out character by character, never as a range: bash 3.2 matches a range by the locale's
# collation, and under some installed macOS locales `[a-z]` folds case, so a marker carrying a character the writer
# never emits would match.
SEAT_PASS_DIGITS='0123456789'
SEAT_PASS_NONZERO='123456789'
SEAT_PASS_LOWER='abcdefghijklmnopqrstuvwxyz'
SEAT_PASS_UPPER='ABCDEFGHIJKLMNOPQRSTUVWXYZ'

# seat_pass_usage_current <home> <marker> <alias> <valid from> <valid until> — the three extra fields a seat on a
# plan with a usage limit carries (`src/claude/seatUsageGate.ts`): exit 0 while now sits in the pass's own window
# and the plan's usage snapshot is strictly older than the marker, so a newer reading — one that may cross the
# limit — sends the prompt to the full check. The lower bound is the second the pass was judged: a wall clock stepped
# back behind it would otherwise stretch the pass, and let a newer snapshot land with an mtime older than the marker. Its one
# non-builtin is `/bin/date`, paid only on such a plan. Anything malformed misses.
seat_pass_usage_current() {
  local home="$1" marker="$2" alias="$3" valid_from="$4" valid_until="$5"
  local alias_word="[${SEAT_PASS_LOWER}${SEAT_PASS_DIGITS}]+"
  [[ $alias =~ ^${alias_word}(-${alias_word})*$ ]] || return 1
  [ "${#alias}" -le 32 ] || return 1
  # Canonical positive epoch seconds only, the one spelling the writer's `String(n)` of a positive integer emits, and
  # no larger than the writer's `Number.isSafeInteger` admits: sixteen digits at most, so bash's 64-bit test is exact.
  local max_safe=9007199254740991
  local epoch="^[${SEAT_PASS_NONZERO}][${SEAT_PASS_DIGITS}]{0,15}\$"
  [[ $valid_from =~ $epoch ]] || return 1
  [[ $valid_until =~ $epoch ]] || return 1
  [ "$valid_from" -le "$max_safe" ] || return 1
  [ "$valid_until" -le "$max_safe" ] || return 1
  local now=""
  now="$(/bin/date +%s 2>/dev/null)" || return 1
  [[ $now =~ ^[${SEAT_PASS_DIGITS}]+$ ]] || return 1
  [ "$now" -ge "$valid_from" ] || return 1
  [ "$now" -lt "$valid_until" ] || return 1
  local snapshot="$home/live/claude-usage/$alias.json"
  [ -f "$snapshot" ] || return 1
  # A reading the full check could not open is NOT MEASURED there, and a chmod leaves the mtime the order below reads.
  [ -r "$snapshot" ] || return 1
  [ "$marker" -nt "$snapshot" ] || return 1
  return 0
}

# seat_pass_cached <payload> — exit 0 when this payload's session holds a live cached PASS, else 1.
seat_pass_cached() {
  local payload="$1"
  local id_pattern="\"session_id\"[[:space:]]*:[[:space:]]*\"([${SEAT_PASS_DIGITS}${SEAT_PASS_UPPER}${SEAT_PASS_LOWER}-]+)\""
  [[ $payload =~ $id_pattern ]] || return 1
  local session_id="${BASH_REMATCH[1]}"
  # The two variables `src/claude/ambientCredential.ts` reads as an API key outranking every store. A marker was
  # only ever written with both empty, but this hook's environment is Claude's, which can reload its settings'
  # `env` mid-life, so a key that arrived since is the full check's to see.
  [ -z "${ANTHROPIC_API_KEY//[[:space:]]/}" ] || return 1
  [ -z "${ANTHROPIC_AUTH_TOKEN//[[:space:]]/}" ] || return 1
  # Both defaults hang off HOME, and node's `homedir()` falls back to the password database where bash cannot.
  [ -n "${HOME:-}" ] || return 1

  local home="${SLOPWEAVER_HOME:-}"
  [ -n "$home" ] || home="${HOME:-}/.slopweaver"
  case "$home" in /*) ;; *) return 1 ;; esac
  local claude_home="${CLAUDE_CONFIG_DIR:-}"
  [ -n "$claude_home" ] || claude_home="${HOME:-}/.claude"
  case "$claude_home" in /*) ;; *) return 1 ;; esac
  case "$claude_home" in *[[:space:]]) return 1 ;; esac

  local marker="$home/live/seat-pass/$session_id"
  [ -f "$marker" ] || return 1
  # `-nt` is strict, so an input written in the marker's own second invalidates it: the safe side of a tie.
  local input
  for input in "$home/claude-accounts/accounts.json" "$claude_home/settings.json"; do
    if [ -e "$input" ] && ! [ "$marker" -nt "$input" ]; then
      return 1
    fi
  done

  # The writer writes exactly one newline-terminated line and never a NUL byte, so anything else is a marker it did
  # not write: a miss. The whole file is read up to a NUL, because bash drops a NUL from every value it reads: a read
  # that FINDS one returns 0, and so misses here, where a line-wise read lost the byte and accepted the line
  # With no NUL the read meets end of file, returns 1, and holds every byte.
  local whole="" nl=$'\n'
  if IFS= read -r -d '' whole <"$marker"; then return 1; fi
  case "$whole" in *"$nl") ;; *) return 1 ;; esac
  local line="${whole%"$nl"}"
  case "$line" in *"$nl"*) return 1 ;; esac
  # The whole line must be one of the two shapes the writer emits, field for field: `read` would fold away a trailing
  # empty field, so the line is matched rather than split. A two-field marker predates the usage gate and never said
  # whether its plan has a limit, so it matches neither; `-` is a plan with none; else a limited plan and its window.
  local tab=$'\t'
  # A pid is positive, as the writer requires: `kill -0 0` addresses the caller's own process group and succeeds.
  # A process start carries no quote or backslash, as the writer's `SAFE_PROC_START` requires: the registry match
  # below is a substring of JSON, which either could otherwise reach past the one field it names.
  # A carriage return is refused there too, and `read -r` keeps one, so it is excluded here as well. The byte list
  # after the match narrows it to exactly the writer's class.
  local cr=$'\r'
  local start_class="[^${tab}${cr}\"\\]"
  local pid_field="([${SEAT_PASS_NONZERO}][${SEAT_PASS_DIGITS}]*)"
  local unlimited_shape="^${pid_field}${tab}(${start_class}+)${tab}-\$"
  local limited_shape="^${pid_field}${tab}(${start_class}+)${tab}([^${tab}]+)${tab}([^${tab}]+)${tab}([^${tab}]+)\$"
  local pid="" proc_start=""
  if [[ $line =~ $unlimited_shape ]]; then
    pid="${BASH_REMATCH[1]}"
    proc_start="${BASH_REMATCH[2]}"
  elif [[ $line =~ $limited_shape ]]; then
    pid="${BASH_REMATCH[1]}"
    proc_start="${BASH_REMATCH[2]}"
    local alias="${BASH_REMATCH[3]}" valid_from="${BASH_REMATCH[4]}" valid_until="${BASH_REMATCH[5]}"
    seat_pass_usage_current "$home" "$marker" "$alias" "$valid_from" "$valid_until" || return 1
  else
    return 1
  fi
  # The writer's process start is printable ASCII bar `"`, `[`, `\` and `]` (`SAFE_PROC_START`), listed here byte by
  # byte rather than as a range a UTF-8 locale could widen: anything left after stripping those is a byte the writer
  # never emits, a raw 0xFF included.
  local start_bytes=' !#$%&'"'"'()*+,./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ^_`abcdefghijklmnopqrstuvwxyz{|}~-'
  [ -z "${proc_start//[$start_bytes]/}" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1

  local registry="$claude_home/sessions/$pid.json"
  [ -f "$registry" ] || return 1
  local record=""
  IFS= read -r -d '' record <"$registry" || true
  [[ $record == *"\"sessionId\":\"$session_id\""* ]] || return 1
  [[ $record == *"\"procStart\":\"$proc_start\""* ]] || return 1
  return 0
}
