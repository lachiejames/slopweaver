#!/usr/bin/env bash
# Make a bare `slopweaver` resolve for somebody who installed this as a plugin.
#
# Why: 221 lines across this repository's own docs and skills tell a reader to run `slopweaver <verb>`.
# Every one of them is true on the owner's machine and false on anybody else's — measured, the owner's
# `~/.zshrc` defines a shell FUNCTION named `slopweaver` resolving to the current repo's
# `bin/slopweaver`, else to the owner's own checkout. A marketplace install ships no shell function and no PATH
# entry, so in a HOME without that function `command -v slopweaver` prints nothing and every one of those
# 221 lines is an instruction the reader cannot follow.
#
# Fixing the class rather than the instances is deliberate: rewriting 221 prose
# lines to carry an absolute path would be a mechanical sweep over prose, which this repository has already
# measured pushing false claims through (three of them, on one such sweep). Installing the command those
# lines already name is the smaller change and leaves the prose true.
#
# The link points at the MIRROR, never at a versioned cache directory: `plugin-mirror-sync.sh` keeps
# `mirror/current` valid across every version bump, while a cache path is pruned the moment a new version
# lands — which is exactly the shape this install is moving to, one version per commit.
set -euo pipefail

BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"  # the conventional per-user bin dir, and already on PATH for most shells
LINK="$BIN_DIR/slopweaver"

MIRROR_CURRENT="$1"                 # "$MIRROR_ROOT/current", passed in so the caller owns mirror layout
TARGET="$MIRROR_CURRENT/bin/slopweaver"
[ -x "$TARGET" ] || exit 0          # nothing to point at yet; the next session start will have one

# Refuse the whole operation unless the mirror we were handed actually lives under the REAL plugin data
# root — never a caller's scratch reproduction, whose mirror sits elsewhere while $HOME (and so BIN_DIR)
# is still the operator's own. A past regression: a survey's reproduction pointed this script
# at a throwaway mirror under its own scratchpad and it re-pointed the OPERATOR's real ~/.local/bin link at
# that scratchpad, because BIN_DIR was keyed on $HOME with no check on where MIRROR_CURRENT actually lived.
# A caller exercising this script against a scratch mirror should override BIN_DIR too; this is the
# backstop for when it forgets, so a test can never clobber the real shim.
DATA_ROOT="${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}"
mirror_real="$(cd "$MIRROR_CURRENT" 2>/dev/null && pwd -P)" || exit 0
data_mirror_real="$(cd "$DATA_ROOT/mirror" 2>/dev/null && pwd -P)" || exit 0
case "$mirror_real" in
  "$data_mirror_real" | "$data_mirror_real"/*) : ;;
  *) exit 0 ;;                      # a mirror outside the real data root — never ours to point BIN_DIR at
esac

mkdir -p "$BIN_DIR"

if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  exit 0                            # a real file somebody else installed — never ours to replace
fi
if [ -L "$LINK" ]; then
  existing="$(readlink "$LINK")"
  case "$existing" in
    "$HOME"/.claude/plugins/data/*) : ;;   # one of ours, from this or a previous install — safe to repoint
    *) exit 0 ;;                            # somebody else's symlink — leave it exactly as it is
  esac
fi

ln -sfn "$TARGET" "$LINK"

# Say something ONCE, and only when the directory we just wrote into is not actually on PATH — otherwise
# the shim silently does nothing and the reader is back to a command that does not resolve. A notice on
# every session start would be noise; a notice never printed would be a silent failure.
case ":${PATH}:" in
  *":$BIN_DIR:"*) exit 0 ;;
esac
NOTICE="${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}/.path-notice-shown"
[ -e "$NOTICE" ] && exit 0
mkdir -p "$(dirname "$NOTICE")" && : > "$NOTICE"
echo "[slopweaver] installed $LINK, but $BIN_DIR is not on your PATH." >&2
echo "[slopweaver]   add it (export PATH=\"\$HOME/.local/bin:\$PATH\"), or call $TARGET directly." >&2
