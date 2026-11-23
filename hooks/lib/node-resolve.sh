#!/usr/bin/env bash
# Sourced by bin/slopweaver: find the Node this checkout needs, deliberately, before anything execs one.
#
# Until this existed the launcher never looked. It exec'd `node_modules/.bin/tsx`, whose `#!/usr/bin/env node`
# shebang took whatever `node` PATH happened to name, so a machine with none died on `env`'s own error, one with
# an old Node died wherever that Node first met syntax it lacked, and a version-manager shim with no version
# configured printed that manager's error. None of the three said what Slopweaver needs.
#
# Three tiers, each candidate's `--version` read ONCE and compared with `engines.node`:
#   1. SLOPWEAVER_NODE, an explicit pin: an absolute path to a binary named `node` (the launcher has already
#      loaded ~/.config/slopweaver/env, so it may live there). Named `node` because the pin reaches tsx through
#      PATH, and only a binary of that name answers tsx's `#!/usr/bin/env node`. A pin that does not fit
#      REFUSES: a deliberate choice silently replaced by another Node is the defect, not the fix.
#   2. `.nvmrc`'s exact version, installed under a version manager's own directory (proto, nvm, fnm, volta,
#      mise, asdf). Absent everywhere, it falls through to tier 3. Present but broken, it falls through TOO —
#      the ask is a refusal when NO Node fits, and a working one on PATH ran before this resolver existed —
#      but never silently: NODE_NOTE names the broken install and the launcher prints it.
#   3. `node` on PATH.
# No fit prints one refusal naming the floor, what each tier found and the install command, and returns 1. A
# repository that contradicts itself — no readable floor, or an `.nvmrc` below it — refuses as `[node-contract]`.
#
# COST, MEASURED on an Apple-silicon host, ten runs each: `node --version` took 23 ms direct and 67 ms
# through proto's shim. Repro: `time (for i in 1 2 3 4 5 6 7 8 9 10; do node --version >/dev/null; done)`.
# So tier 2 runs before tier 3: with the pin installed the launcher's one probe is the direct 23 ms, and since
# the pinned bin dir goes first on PATH, tsx's own `env node` start skips the shim as well — the shim hop it no
# longer takes costs more than the probe. The floor is read from package.json in pure bash, with no fork.
#
# Bash 3.2 (macOS's /bin/bash): no `[[ =~ ]]` captures, no `local -n`, no case-modifying expansions.

# The floor's `>=` operand from a package.json's `engines.node`, read without a JSON parser.
#
# @param $1 the package.json path
# @returns 0 with NODE_FLOOR set to `MAJOR[.MINOR[.PATCH]]`, or 1 with it empty when the file has no `>=` floor
#   in its `engines` block. Only the `>=` shape is read — the one `slopweaver doctor`'s parseVersionFloor
#   (src/environment/runtimeProbes.ts) reads too — and `binSlopweaverFindsNode.test.ts` holds the repository's
#   own package.json to it.
#
# It reads TOKENS, never lines: one pass over the structural characters `{ } [ ] : , "`, with the nesting depth,
# whether the next token is a key's value, and the key it belongs to all tracked exactly. Review broke ten
# successive line-based readings with manifests npm accepts — `"description": "engines"`,
# a nested `x.engines` laid flush with the top level, a key after a nested `}` on one line, duplicate keys — so
# what holds now is the grammar, not a layout:
#   - `engines` counts only as a key of the top-level object (depth 1), and `node` only as a key of that
#     `engines` object (depth 2). A string is a key exactly when a `:` follows it.
#   - The LAST of each duplicate wins, as JSON.parse keeps it: a later `engines` resets what an earlier one held.
#   - Closed, never wrong: an `engines` that is not an object, anything nested inside it, a `node` that is not a
#     `>=` string, a key at depth 1 or 2 spelled with any backslash escape (a
#     unicode-escaped `e` in `engines` decodes to a key this text match cannot see), an unterminated string or unbalanced nesting all refuse as `[node-contract]`.
# A JSON string never spans a line, so reading line by line loses nothing; `\\` and `\"` are marked first, so
# an escaped quote never ends a string and an escaped key still shows its backslash. MEASURED: 20 ms for this repository's package.json under
# /bin/bash 3.2.57, bash's own start included. Repro:
#   /usr/bin/time -p /bin/bash -c 'source hooks/lib/node-resolve.sh; node_engines_floor package.json'
node_engines_floor() {
  NODE_FLOOR=""
  local line s pre c str last="" depth=0 value_next=0 want="" in_engines=0 found="" v
  [ -r "$1" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    # `\\` and `\"` become the marker `\#`: never a quote, so an escaped quote cannot end a string, and still a
    # backslash, so the escaped-key refusal below sees it. Dropping them outright read `"\\engines"` and
    # `"engi\"nes"` as `engines`.
    s="${line//\\\\/\\#}"
    s="${s//\\\"/\\#}"
    while :; do
      # Everything up to the next structural character is a literal (a number, `true`) or space: skipped.
      pre="${s%%[\{\}\[\]:,\"]*}"
      [ "$pre" = "$s" ] && break
      c="${s:${#pre}:1}"
      s="${s:$((${#pre} + 1))}"
      case "$c" in
        '"')
          case "$s" in *'"'*) ;; *) return 1 ;; esac
          str="${s%%\"*}"
          s="${s#*\"}"
          if [ "$value_next" = 1 ]; then
            case "$want" in
              engines) return 1 ;;
              node)
                case "$str" in '>='*) ;; *) return 1 ;; esac
                v="${str#>=}"
                v="${v# }"
                v="${v#v}"
                case "$v" in '' | *[!0-9.]* | .* | *. | *..* | *.*.*.*) return 1 ;; esac
                # A part too wide for bash arithmetic is no floor node_version_meets can hold a Node to.
                case "$v" in *[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*) return 1 ;; esac
                found="$v"
                ;;
            esac
            value_next=0
            want=""
          else
            last="$str"
          fi
          ;;
        ':')
          [ "$value_next" = 0 ] || return 1
          case "$last" in *\\*) [ "$depth" -gt 2 ] || return 1 ;; esac
          want=""
          if [ "$depth" = 1 ] && [ "$last" = engines ]; then
            want=engines
            found=""
          elif [ "$in_engines" = 1 ] && [ "$depth" = 2 ] && [ "$last" = node ]; then
            want=node
          fi
          value_next=1
          last=""
          ;;
        '{' | '[')
          [ "$in_engines" = 0 ] || return 1
          if [ "$value_next" = 1 ]; then
            if [ "$want" = engines ]; then
              [ "$c" = '{' ] || return 1
              in_engines=1
            fi
            [ "$want" != node ] || return 1
          fi
          value_next=0
          want=""
          depth=$((depth + 1))
          ;;
        '}' | ']' | ',')
          # A `node` or `engines` whose value was a bare literal reaches here still wanting one.
          case "$want" in engines | node) return 1 ;; esac
          value_next=0
          last=""
          if [ "$c" != , ]; then
            if [ "$in_engines" = 1 ] && [ "$depth" = 2 ]; then
              in_engines=0
            fi
            depth=$((depth - 1))
          fi
          ;;
      esac
    done
  done <"$1"
  [ "$depth" = 0 ] || return 1
  [ -n "$found" ] || return 1
  NODE_FLOOR="$found"
  return 0
}

# Whether a Node version meets a floor, part by part, a missing part reading as zero (`>=24.11` admits 24.11.0).
#
# Semver's reading of a `>=` floor: `+build` metadata is ignored, and a `-prerelease` never satisfies a floor
# without one (stripping the suffix wholesale lets `v24.11.0-` and nightlies through).
#
# @param $1 the version, `v` prefix optional
# @param $2 the floor
# @returns 0 when it meets it, 1 when it is below it or a prerelease, 2 when the version is not three dotted
#   numbers with a well-formed suffix, or the floor not one to three
node_version_meets() {
  local have="${1#v}" need="${2#v}" pre="" build="" dots h n i=0
  case "$have" in *+*)
    build="${have#*+}"
    have="${have%%+*}"
    case "$build" in '' | *[!0-9A-Za-z.-]* | .* | *. | *..*) return 2 ;; esac
    ;;
  esac
  case "$have" in *-*)
    pre="${have#*-}"
    have="${have%%-*}"
    case "$pre" in '' | *[!0-9A-Za-z.-]* | .* | *. | *..*) return 2 ;; esac
    ;;
  esac
  case "$have" in '' | *[!0-9.]* | .* | *. | *..*) return 2 ;; esac
  case "$need" in '' | *[!0-9.]* | .* | *. | *..*) return 2 ;; esac
  # Semver forbids a leading zero in a numeric part (`v024.12.0`), so it is malformed rather than read as 24.
  case ".$have." in *.0[0-9]*) return 2 ;; esac
  case ".$need." in *.0[0-9]*) return 2 ;; esac
  # A part of ten digits or more could overflow bash's 64-bit arithmetic below and compare wrapped
  # (a floor of `>=9223372036854775808` admitted v24), so it is malformed. Nine always fit.
  case "$have.$need" in *[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*) return 2 ;; esac
  # A version is exactly MAJOR.MINOR.PATCH (`v25` and `v24.11.0.999` are no Node version), refused before any part
  # is compared so a large major cannot carry either through. Only the floor may be shortened, as a range is.
  dots="${have//[!.]/}"
  [ "${#dots}" -eq 2 ] || return 2
  dots="${need//[!.]/}"
  [ "${#dots}" -le 2 ] || return 2
  [ -z "$pre" ] || return 1
  while [ "$i" -lt 3 ]; do
    h="${have%%.*}"
    n="${need%%.*}"
    [ -n "$h" ] || h=0
    [ -n "$n" ] || n=0
    # 10# keeps a leading zero from reading as octal.
    if [ $((10#$h)) -gt $((10#$n)) ]; then return 0; fi
    if [ $((10#$h)) -lt $((10#$n)) ]; then return 1; fi
    case "$have" in *.*) have="${have#*.}" ;; *) have="" ;; esac
    case "$need" in *.*) need="${need#*.}" ;; *) need="" ;; esac
    i=$((i + 1))
  done
  return 0
}

# Find an exact Node version installed by a version manager. Defaults follow each manager's own documentation;
# its env override wins where it has one. Proto is first, as the repository's recommended manager.
#
# @param $1 the exact version, no `v`
# @returns 0 with NODE_FOUND set to the first executable `node` among them, or 1 with it empty
node_find_installed() {
  local v="$1" data="${XDG_DATA_HOME:-$HOME/.local/share}" bin_dir
  NODE_FOUND=""
  for bin_dir in \
    "${PROTO_HOME:-$HOME/.proto}/tools/node/$v/bin" \
    "${NVM_DIR:-$HOME/.nvm}/versions/node/v$v/bin" \
    "${FNM_DIR:-$data/fnm}/node-versions/v$v/installation/bin" \
    "$HOME/Library/Application Support/fnm/node-versions/v$v/installation/bin" \
    "${VOLTA_HOME:-$HOME/.volta}/tools/image/node/$v/bin" \
    "${MISE_DATA_DIR:-$data/mise}/installs/node/$v/bin" \
    "${ASDF_DATA_DIR:-$HOME/.asdf}/installs/nodejs/$v/bin"; do
    if [ -f "$bin_dir/node" ] && [ -x "$bin_dir/node" ]; then
      NODE_FOUND="$bin_dir/node"
      return 0
    fi
  done
  return 1
}

# Whether one candidate binary runs and meets the floor, read off its own `--version`.
#
# What this closes, and what it does not: a missing, unexecutable, crashing, mis-versioned or too-old binary
# fails the probe, because a real Node that cannot start cannot answer `--version` either. A binary that answers
# `--version` correctly and fails everything else passes it and is chosen ahead of PATH
# (a constructed fake). Closing that would mean running script, `node -e 0`, on every invocation: measured
# at about 51 ms a call against 32 ms for `--version`, on proto's direct binary. The launcher has to stay
# cheap per call. Repro: `time (for i in $(seq 20); do node -e 0; done)`, then the same with `node --version`.
#
# @param $1 the binary
# @returns 0 when it fits; 1 with NODE_WHY set to what it did instead, phrased to follow the binary's path
node_candidate_fits() {
  local status=0
  NODE_WHY=""
  if ! node_probe_version "$1"; then
    NODE_WHY="failed \`--version\`: ${NODE_PROBED:-no output}"
    return 1
  fi
  node_version_meets "$NODE_PROBED" "$NODE_FLOOR" || status=$?
  case "$status" in
    0) return 0 ;;
    2) NODE_WHY="answered \`--version\` with \`$NODE_PROBED\`, which is not a Node version" ;;
    *) NODE_WHY="is \`$NODE_PROBED\`, not >=$NODE_FLOOR" ;;
  esac
  return 1
}

# The install command for a version, with the first manager this machine already has, worded as
# `slopweaver doctor`'s installNodeCommand words it. Only the refusal reaches this, so its forks cost nothing.
#
# @param $1 the version to install
# @returns the command on stdout
node_install_command() {
  local v="$1" data="${XDG_DATA_HOME:-$HOME/.local/share}"
  if [ -d "${PROTO_HOME:-$HOME/.proto}" ]; then
    echo "proto install node $v"
  elif [ -d "${NVM_DIR:-$HOME/.nvm}" ]; then
    echo "nvm install $v"
  elif [ -d "${FNM_DIR:-$data/fnm}" ] || [ -d "$HOME/Library/Application Support/fnm" ]; then
    echo "fnm install $v"
  elif [ -d "${VOLTA_HOME:-$HOME/.volta}" ]; then
    echo "volta install node@$v"
  elif [ -d "${MISE_DATA_DIR:-$data/mise}" ]; then
    echo "mise install node@$v"
  elif [ -d "${ASDF_DATA_DIR:-$HOME/.asdf}" ]; then
    echo "asdf install nodejs $v"
  else
    echo "install proto (https://moonrepo.dev/proto), then: proto install node $v — or Node $v from https://nodejs.org/"
  fi
}

# Read one binary's version, once, with NODE_OPTIONS emptied so an operator's `--require` never runs for a probe.
# Only its first line is kept: a manager shim's diagnostic can run to a screenful.
#
# @param $1 the binary
# @returns 0 with NODE_PROBED set to its first output line when it exits 0, else 1 with that line (or nothing)
node_probe_version() {
  local out status=0
  out="$(NODE_OPTIONS='' "$1" --version 2>&1 </dev/null)" || status=$?
  NODE_PROBED="${out%%$'\n'*}"
  return "$status"
}

# The one refusal, every line prefixed so a reader of a merged stream can tell whose it is.
#
# @param $1 the checkout dir
# @param $2 the version to name in the install command
# @param $3.. one line per tier tried, saying what it found
# @returns nothing; writes to stderr
node_refusal() {
  local dir="$1" install line
  install="$(node_install_command "$2")"
  shift 2
  {
    echo "slopweaver: REFUSED [no-node] — no Node.js >=$NODE_FLOOR to run this CLI (engines.node in $dir/package.json)."
    for line in "$@"; do
      echo "slopweaver:   $line"
    done
    echo "slopweaver:   install it:  $install"
    echo "slopweaver:   or point SLOPWEAVER_NODE at a node >=$NODE_FLOOR in ${XDG_CONFIG_HOME:-$HOME/.config}/slopweaver/env"
  } >&2
}

# Resolve the Node to run this checkout with.
#
# @param $1 the CLI checkout dir whose package.json and .nvmrc are read
# @returns 0 with NODE_RESOLVED set to the binary and NODE_PREPEND to the dir to put first on PATH (empty for
#   an ambient node on a PATH of absolute entries only, which every cwd resolves alike) and NODE_NOTE to a warning the caller prints (empty unless a
#   broken `.nvmrc` install was passed over); 1 after printing the refusal to stderr. The caller exits on 1.
node_resolve() {
  local dir="$1" nvmrc="" exact="" tier_nvmrc ambient
  local pin_rule="an explicit pin is never passed over for another Node"
  NODE_RESOLVED=""
  NODE_PREPEND=""
  NODE_NOTE=""
  if ! node_engines_floor "$dir/package.json"; then
    {
      echo "slopweaver: REFUSED [node-contract] — $dir/package.json declares no \`engines.node\` \`>=MAJOR[.MINOR[.PATCH]]\` floor,"
      echo "slopweaver:   so no Node can be judged to fit. Restore that checkout's package.json (\`git -C $dir status\`)."
    } >&2
    return 1
  fi

  if [ -r "$dir/.nvmrc" ]; then
    IFS= read -r nvmrc <"$dir/.nvmrc" || true
    nvmrc="${nvmrc%$'\r'}"
    nvmrc="${nvmrc#v}"
  fi
  case "$nvmrc" in
    '') tier_nvmrc=".nvmrc: none in $dir" ;;
    *[!0-9.]* | *.*.*.* | .* | *. | *..*) tier_nvmrc=".nvmrc: \`$nvmrc\` is not an exact MAJOR.MINOR.PATCH version" ;;
    *.*.*) exact="$nvmrc" ;;
    *) tier_nvmrc=".nvmrc: \`$nvmrc\` is not an exact MAJOR.MINOR.PATCH version" ;;
  esac
  if [ -n "$exact" ] && ! node_version_meets "$exact" "$NODE_FLOOR"; then
    {
      echo "slopweaver: REFUSED [node-contract] — $dir/.nvmrc pins $exact, below the >=$NODE_FLOOR its package.json requires."
      echo "slopweaver:   The checkout contradicts itself; raise .nvmrc to a version that meets engines.node."
    } >&2
    return 1
  fi

  # Tier 1: the explicit pin.
  if [ -n "${SLOPWEAVER_NODE:-}" ]; then
    case "$SLOPWEAVER_NODE" in
      # A `:` is legal in a path but splits a PATH entry, so its directory could never be put first.
      *:*)
        node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE=$SLOPWEAVER_NODE contains \`:\`, the PATH separator, so its directory cannot go first on PATH"
        return 1
        ;;
      /*/node) : ;;
      *)
        node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE=$SLOPWEAVER_NODE is not an absolute path to a binary named \`node\` — only that name answers tsx's \`env node\`"
        return 1
        ;;
    esac
    if [ ! -f "$SLOPWEAVER_NODE" ] || [ ! -x "$SLOPWEAVER_NODE" ]; then
      node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE=$SLOPWEAVER_NODE is not an executable file, and $pin_rule"
      return 1
    fi
    if ! node_candidate_fits "$SLOPWEAVER_NODE"; then
      node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE=$SLOPWEAVER_NODE $NODE_WHY, and $pin_rule"
      return 1
    fi
    NODE_RESOLVED="$SLOPWEAVER_NODE"
    NODE_PREPEND="${SLOPWEAVER_NODE%/node}"
    return 0
  fi

  # Tier 2: .nvmrc's exact version, under a manager's install dir. Absent or broken, it falls to PATH — a broken
  # one said aloud through NODE_NOTE, never silently.
  if [ -n "$exact" ]; then
    if node_find_installed "$exact"; then
      # A manager home given relatively (`PROTO_HOME=relproto`) names a different install once the launcher cd's
      # (v24 probed from the caller's cwd, a v18 under `$DIR/relproto` run by corepack), so
      # the find is made absolute against the cwd it was probed from before it goes first on PATH.
      case "$NODE_FOUND" in
        /*) : ;;
        *) NODE_FOUND="$PWD/$NODE_FOUND" ;;
      esac
      # A `:` in the install's path would split its PATH entry, so it is passed over like a broken one.
      case "$NODE_FOUND" in
        *:*)
          tier_nvmrc=".nvmrc $exact: $NODE_FOUND contains \`:\`, the PATH separator, so it cannot go first on PATH"
          ;;
        *)
          if node_candidate_fits "$NODE_FOUND"; then
            NODE_RESOLVED="$NODE_FOUND"
            NODE_PREPEND="${NODE_FOUND%/node}"
            return 0
          fi
          tier_nvmrc=".nvmrc $exact: $NODE_FOUND $NODE_WHY — that install is broken; reinstall it"
          ;;
      esac
      NODE_NOTE="slopweaver: WARNING — $tier_nvmrc. Running the node on PATH instead."
    else
      tier_nvmrc=".nvmrc $exact: not installed under proto, nvm, fnm, volta, mise or asdf"
    fi
  fi

  # Tier 3: whatever PATH names. `type -P` so an exported shell function named node never answers.
  ambient="$(type -P node || true)"
  if [ -z "$ambient" ]; then
    node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE: unset" "$tier_nvmrc" "node on PATH: none"
    return 1
  fi
  if ! node_candidate_fits "$ambient"; then
    node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE: unset" "$tier_nvmrc" "node on PATH: $ambient $NODE_WHY"
    return 1
  fi
  # A RELATIVE PATH entry names a different node once the launcher cd's (`relbin` probed
  # from the caller's cwd, then corepack's `env node` inside the checkout found a v18 under its own `relbin`).
  # So the probed binary's directory is made absolute and put first, exactly as tiers 1 and 2 do — and so is an
  # ABSOLUTE one whenever PATH holds any relative or empty entry, since an earlier one could name another node
  # from the checkout (`relbin:/good/bin` resolved to `$DIR/relbin/node` there). A PATH of
  # absolute entries only is left alone: it names the same node from any cwd, and prepending would reorder
  # every other tool that directory holds. The residue, stated: a SHIM that picks its Node by cwd (asdf, mise)
  # is probed from the caller's cwd only, so a checkout pinning an older Node in its own tool file runs that one
  # for corepack and yarn. Probing again from `$DIR` would double the per-call cost the
  # node_candidate_fits note measures, and `.nvmrc`'s tier above already reaches past such a shim.
  case "$ambient" in
    /*) : ;;
    *) ambient="$PWD/$ambient" ;;
  esac
  case ":$PATH:" in
    *:[!/]*)
      case "$ambient" in *:*)
        node_refusal "$dir" "${exact:-$NODE_FLOOR}" "SLOPWEAVER_NODE: unset" "$tier_nvmrc" "node on PATH: $ambient, whose directory contains \`:\`, the PATH separator, so it cannot go first on a PATH that holds a relative entry"
        return 1
        ;;
      esac
      NODE_PREPEND="${ambient%/node}"
      ;;
  esac
  NODE_RESOLVED="$ambient"
  return 0
}
