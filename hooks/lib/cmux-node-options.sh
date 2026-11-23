#!/usr/bin/env bash
# Sourced by bin/slopweaver: take back the NODE_OPTIONS a cmux-launched Claude session leaks into every child.
#
# cmux's Claude wrapper (`cmux-claude-wrapper`, `install_cmux_node_options`) launches Claude with
# `--require=$TMPDIR/cmux-claude-node-options/restore-node-options.cjs --max-old-space-size=<n>` PREPENDED to
# the operator's own NODE_OPTIONS, with every heap flag of the operator's removed from that merged value and
# kept only in CMUX_ORIGINAL_NODE_OPTIONS (when CMUX_ORIGINAL_NODE_OPTIONS_PRESENT=1). The `.cjs` restores the
# original inside Claude's own node process, but every Bash child still inherits the merged value — so the
# launcher read cmux's heap flag as an operator's explicit one and skipped host sizing, and the shim then ran
# in tsx's parent node and DELETED NODE_OPTIONS, leaving the real CLI at V8's default either way. MEASURED
# on a 48 GiB host: `heap_size_limit` 4,496,293,888 under cmux against 13,086,228,480 host-sized,
# and `recipe run-due --recipe resync-corpus-github` died exit 134 in `derive` at 4,085 MB. Repro inside a cmux
# seat: `printenv NODE_OPTIONS`, then `node -p 'require("v8").getHeapStatistics().heap_size_limit'`.
#
# This removes a THIRD PARTY's ambient ceiling; it adds none, which is why no line here
# assigns NODE_OPTIONS — the caller does, from this function's stdout.

# @param $1 the NODE_OPTIONS value to clean
# @param $2 CMUX_ORIGINAL_NODE_OPTIONS_PRESENT — `1` when cmux saved an operator value before merging
# @param $3 CMUX_ORIGINAL_NODE_OPTIONS — the operator's own value, heap flag included
# @returns on stdout the value with cmux's guard token and the heap token right after it removed, every other
#   token kept in order, and the operator's own heap token(s) put back at the FRONT (so a later appended one
#   still wins — V8 takes the last). Exit 1 with nothing printed when no cmux guard token is present, so the
#   caller leaves the value untouched. A subshell body so `set -f` (no globbing of split words) never leaks.
#
# Two edges cmux itself creates. Its merge strips only the hyphenated heap spelling, so an underscored one
# survives in the merged value AND in the original — the kept copy is dropped, or it would land after the
# restored tokens and override the operator's own order. A nested cmux launch saves the OUTER merged value as
# its original, guard pair included — that pair is skipped there too, or cmux's own number comes back as the
# operator's. Known limit, shared with cmux: tokens are re-joined with one space, so a quoted value's inner
# whitespace collapses, exactly as cmux's own merge already collapses it.
cmux_node_options_without_injection() (
  set -f
  value="${1:-}"
  original_present="${2:-}"
  original="${3:-}"
  original_heap=""
  leftover=" "
  if [ "$original_present" = 1 ]; then
    after_guard=0
    for tok in $original; do
      if [ "$after_guard" = 1 ]; then
        after_guard=0
        case "$tok" in --max-old-space-size=*) continue ;; esac
      fi
      case "$tok" in
        --require=*/cmux-claude-node-options/restore-node-options.cjs) after_guard=1 ;;
        --max-old-space-size=*) original_heap="${original_heap:+$original_heap }$tok" ;;
        --max_old_space_size=*)
          original_heap="${original_heap:+$original_heap }$tok"
          leftover="$leftover$tok "
          ;;
      esac
    done
  fi
  kept=""
  found=0
  drop_heap=0
  for tok in $value; do
    if [ "$drop_heap" = 1 ]; then
      drop_heap=0
      case "$tok" in --max-old-space-size=*) continue ;; esac
    fi
    case "$tok" in
      --require=*/cmux-claude-node-options/restore-node-options.cjs)
        found=1
        drop_heap=1
        continue
        ;;
      --max_old_space_size=*)
        # One kept copy per original occurrence is cmux's leftover; a further copy is the operator's own.
        case "$leftover" in
          *" $tok "*)
            leftover="${leftover/" $tok "/ }"
            continue
            ;;
        esac
        ;;
    esac
    kept="${kept:+$kept }$tok"
  done
  [ "$found" = 1 ] || return 1
  printf '%s' "$original_heap${original_heap:+${kept:+ }}$kept"
)
