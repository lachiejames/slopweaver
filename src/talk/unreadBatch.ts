/**
 * How much of what is unread one `talk unread` batch takes: the most whole lines whose REPORT, as really rendered,
 * fits in what every host the chair runs on keeps of a command's output.
 *
 * Printed is not seen. A mark records every line of a batch as read, so a report larger than a host keeps of a
 * command's output would leave the lines past the cut recorded read unseen. Two estimates of
 * the report's size were each broken by a line shape they did not price — raw line bytes charged every folded snapshot
 * and cut a real read at 7 words, and a per-word allowance missed each revision's own line — so there is
 * no estimate here. The caller renders the report it would print and says whether it fits; this finds the longest
 * prefix of lines that does, by bisection.
 *
 * Pure: the rendering is the caller's (`src/cli/commands/talk/unreadRun.ts`).
 */
import type { CallTail, UnreadRead } from "./unreadWords.js";

/**
 * How many UTF-8 bytes one invocation may print — bytes, because no host counts a character as more than its bytes,
 * so a limit in bytes holds whatever unit a host truncates by (characters were only safe if the
 * host counted characters). Claude Code's Bash tool keeps 30,000 characters (`BASH_MAX_OUTPUT_LENGTH`, its settings
 * docs). Codex, the substitute host (AGENTS.md rule 5), truncates a tool result too — its own binary names byte, token
 * and line cuts (`strings node_modules/@openai/codex-darwin-arm64/vendor/<arch>/bin/codex | grep truncated_after_lines`)
 * — and its limit was not measured here, so this sits under the smallest recalled for it, 10 KiB and 256 lines.
 */
export const UNREAD_BATCH_BYTES = 8_000;

/** How many lines one invocation may print, under the line cut a host may make; see {@link UNREAD_BATCH_BYTES}. */
export const UNREAD_BATCH_LINES = 200;

/** One batch: the read cut to what fits, and what was left out of it. */
export interface UnreadBatch {
  readonly read: UnreadRead;
  /** Whether whole lines remain past this batch — a mark records only the batch; the next read shows the rest. */
  readonly more: boolean;
  /** Whether the first line could not fit even alone — no batch carries it whole, so it prints in parts (`./unreadParts.ts`). */
  readonly oversized: boolean;
}

/**
 * How many whole lines a read holds, across every call.
 *
 * @returns the count
 */
export function lineCount({ read }: { read: UnreadRead }): number {
  return read.tails.reduce((sum, tail) => sum + tail.lines.length, 0);
}

/**
 * The read cut after its first `take` whole lines, calls in the read's order and each file in its own order — so
 * every tail's last kept line is the frontier a mark records.
 *
 * @param take how many whole lines to keep
 * @returns the cut read
 */
export function readThrough({ read, take }: { read: UnreadRead; take: number }): UnreadRead {
  let remaining = take;
  const tails: CallTail[] = read.tails.map((tail) => {
    const lines = tail.lines.slice(0, Math.max(remaining, 0));
    remaining -= lines.length;
    return { ...tail, lines };
  });
  return { ...read, tails };
}

/**
 * The longest prefix of a read's lines whose report fits. `fits` is asked of the whole read first, which is the
 * common case; otherwise bisection keeps a prefix that fits at every step, so what comes back always fits, whether or
 * not the report grows evenly with its lines.
 *
 * @param read everything unread
 * @param fits whether a report of this read, rendered as it would be printed, fits
 * @returns the batch
 */
export function batchOf({ read, fits }: { read: UnreadRead; fits: (candidate: UnreadRead) => boolean }): UnreadBatch {
  const total = lineCount({ read });
  if (fits(read)) {
    return { more: false, oversized: false, read };
  }
  let kept = 0;
  let over = total;
  while (over - kept > 1) {
    const middle = Math.floor((kept + over) / 2);
    if (fits(readThrough({ read, take: middle }))) {
      kept = middle;
    } else {
      over = middle;
    }
  }
  return {
    more: true,
    oversized: kept === 0,
    read: readThrough({ read, take: kept }),
  };
}
