/**
 * Where a subset build's kept lines go — the write half of {@link ./subsetBuild}'s streaming copy, either every
 * line batched to disk or only the newest N held and written at the end.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";

/** How many bytes of kept lines accumulate before an append flushes. One batch is the peak write heap. */
const FLUSH_BYTES = 8 * 1024 * 1024;

/**
 * Where kept lines go. Two implementations, and the difference is the whole `--limit` feature: the streaming
 * one writes every line it is given, the capped one keeps only the newest N and writes them at the end.
 */
export interface LineSink {
  push: (args: { line: string; tsIso: string }) => void;
  flush: () => void;
  /** How many lines this sink will actually have written — differs from what it was pushed only when capped. */
  written: () => number;
}

/** Append a batch of lines to `path`, creating its parent directory. */
function appendBatch({ path, lines }: { path: string; lines: readonly string[] }): void {
  if (lines.length > 0) {
    mkdirSync(dirname(path), { recursive: true });
    appendLines({ path, text: `${lines.join("\n")}\n` });
  }
}

/**
 * Open a batched append sink at `path`, creating its parent directory.
 *
 * @returns a sink writing every line it is pushed, flushing a batch whenever `FLUSH_BYTES` have accumulated
 */
export function openSink({ path }: { path: string }): LineSink {
  const pending: string[] = [];
  let pendingBytes = 0;
  let total = 0;
  const flush = (): void => {
    appendBatch({ lines: pending, path });
    pending.length = 0;
    pendingBytes = 0;
  };
  return {
    flush,
    push: ({ line }) => {
      pending.push(line);
      pendingBytes += line.length + 1;
      total += 1;
      if (pendingBytes >= FLUSH_BYTES) {
        flush();
      }
    },
    written: () => total,
  };
}

/**
 * Open a sink that keeps only the NEWEST `limit` lines it is offered, by `tsIso`.
 *
 * Bounded in memory by construction: it holds at most `limit` lines, never the source file. That is what lets
 * `--limit` be the cheap knob it is meant to be — a capped build over the same 8 GB costs the same single
 * streaming pass, and its peak heap is a function of `limit` rather than of the corpus.
 *
 * Ties on `tsIso` resolve toward the line seen FIRST, which is bronze's own on-disk order. There is no better
 * tiebreak available — the corpus carries one timestamp per record — and a stable one is what makes a rebuild
 * from unchanged bronze produce the same subset twice.
 *
 * @returns a sink holding the newest `limit` lines, which it writes oldest first on `flush`
 */
export function openCappedSink({ path, limit }: { path: string; limit: number }): LineSink {
  // A cap of zero would make every `kept[0]!` below unreachable-but-unprovable; the flag parser already
  // refuses a non-positive `--limit`, so this is a belt on a braces rather than a live branch.
  // Ascending by tsIso, so index 0 is the oldest kept line and the one a newer arrival displaces.
  const kept: { line: string; tsIso: string }[] = [];
  return {
    flush: () => {
      appendBatch({ lines: kept.map((entry) => entry.line), path });
      kept.length = 0;
    },
    push: ({ line, tsIso }) => {
      if (kept.length >= limit) {
        // `kept[0]!` is safe: the branch is guarded by `kept.length >= limit` and `limit` is at least 1.
        if (tsIso <= kept[0]!.tsIso) {
          return;
        }
        kept.shift();
      }
      let at = kept.length;
      // `kept[at - 1]!` is safe: the loop condition guarantees `at - 1` is in range.
      while (at > 0 && kept[at - 1]!.tsIso > tsIso) {
        at -= 1;
      }
      kept.splice(at, 0, { line, tsIso });
    },
    written: () => kept.length,
  };
}
