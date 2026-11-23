/**
 * Typed failures for the bronze corpus reader ({@link ./corpusStore}). Reading a corpus root fails in three
 * genuinely different ways, each with its own fix: a stat call on the root itself errors (a permissions
 * problem on the root path), some subdirectory could not be listed (a `chmod` on that one directory), or
 * nothing is there at all (run `slopweaver refresh`). Collapsing the three into one string used to send a
 * reader to re-fetch 112 MB when the real fix was a permission bit — see {@link ./corpusStore.resolveCorpusDir}.
 * A fourth way is a corpus too large for the process's heap ceiling, which refuses with the numbers instead of
 * letting V8 kill the process — see {@link ../lib/heapBudget}.
 */
import { HEAP_RESERVE_FRACTION, type HeapShortfall, toMib } from "../lib/heapBudget.js";
import { type CorpusHeapProjection, projectWholeCorpusHeap } from "./heapGuard.js";

/** The root path's own `stat` call failed for a reason other than ENOENT — a rare, generic io error. */
export interface CorpusStatFailedError {
  readonly code: "CORPUS_STAT_FAILED";
  readonly message: string;
  readonly dir: string;
}

/** The corpus root exists, but one or more subdirectories under it could not be listed. */
export interface CorpusDirUnreadableError {
  readonly code: "CORPUS_DIR_UNREADABLE";
  readonly message: string;
  readonly dir: string;
  readonly unreadableCount: number;
}

/** The corpus root holds no `.jsonl` file at all — a genuine absence, not a read failure. */
export interface CorpusDirNotFoundError {
  readonly code: "CORPUS_DIR_NOT_FOUND";
  readonly message: string;
  readonly dir: string;
}

/**
 * The corpus would not fit under this process's heap ceiling, so the reader refused before the allocation
 * that would have crossed it. The alternative is the V8 out-of-memory fatal — a native stack trace with no
 * typed error, no message and nothing naming the fix — which is the one failure this repo's error handling
 * cannot otherwise dress.
 */
export interface CorpusHeapCeilingError {
  readonly code: "CORPUS_HEAP_CEILING";
  readonly message: string;
  readonly dir: string;
  readonly fileCount: number;
  /** Bytes of `.jsonl` under the root. */
  readonly diskBytes: number;
  /** Bytes already read when the guard refused — `0` when the whole-corpus preflight refused. */
  readonly readBytes: number;
  /**
   * Heap in use when the guard refused. A LIVE figure whenever the guard was able to collect first
   * (`../lib/heapBudget.guardHeap`); still garbage-inclusive in the one case it was not, which is why
   * {@link projection}'s own numbers say which they are rather than the message claiming.
   */
  readonly usedBytes: number;
  /** The ceiling this process may grow to — `--max-old-space-size`, or V8's machine default. */
  readonly limitBytes: number;
  /** What the refused read was projected to retain — ONE chunk mid-read, the whole corpus at preflight. */
  readonly projectedBytes: number;
  /** What the WHOLE corpus is projected to retain, extrapolated from what this read has measured. */
  readonly projection: CorpusHeapProjection;
  /**
   * The `--max-old-space-size` (MiB) that would carry the whole read IN ONE ATTEMPT. Not the ceiling that
   * holds the refused chunk: following that reads a little further and is refused again, which is the
   * non-converging advice this field exists to replace ({@link ./heapGuard} carries the measurement).
   */
  readonly suggestedLimitMib: number;
}

/**
 * The owner's protect list refuses part of the corpus, or cannot be read at all, so nothing under it is read. The
 * message is the judge's own line (`./bronzeProtection.ts`), carried rather than reworded.
 */
export interface CorpusProtectedError {
  readonly code: "CORPUS_PROTECTED";
  readonly message: string;
  readonly dir: string;
}

/** Every way {@link ./corpusStore} can fail to resolve or read a corpus root. */
export type CorpusStoreError =
  | CorpusStatFailedError
  | CorpusDirUnreadableError
  | CorpusDirNotFoundError
  | CorpusHeapCeilingError
  | CorpusProtectedError;

/**
 * The "nothing here yet" line, shared verbatim with {@link ../retrieval/loadCorpus.errors.LoadCorpusErrors}'s
 * `empty` factory — a different signal at a different layer (this one is the bronze reader finding no
 * `.jsonl` file; that one is `loadCorpus`'s own pre-check), but the same user-facing text, so one place
 * composes it rather than two copies drifting apart.
 *
 * @param dir the corpus directory that held nothing
 * @returns the shared message text
 */
export function noCorpusFoundMessage({ dir }: { dir: string }): string {
  return `no corpus found at ${dir} — run \`slopweaver refresh\` first`;
}

/**
 * The refusal text for a corpus that will not fit — every number a reader needs to act, in one line each.
 * It names the flag that raises the ceiling because a reader has to be able to get an answer TODAY; it says
 * the flag is a mask because the owner's ruling is that raising the ceiling is never the fix — the corpus
 * grows, and a raised limit is the same failure deferred by however many months of ingest it buys.
 *
 * **The ceiling it names is sized for the WHOLE read, not for the chunk that was refused.** Mid-read the
 * guard projects one 16 MiB chunk, so a message built from the shortfall alone said "needs ~16 MiB more"
 * and suggested a ceiling one step up — advice that reads a little further and refuses again with the same
 * sentence. Measured over five attempts; {@link ./heapGuard} carries the numbers. So the
 * line quotes what the read has MEASURED (bytes of heap per byte of disk) and extrapolates the remainder
 * from it, which is a claim a reader can check and a ceiling a reader reaches in one attempt.
 *
 * It used to offer `slopweaver compact` as the standing fix, and that was false in exactly the case it was
 * printed in. Measured through the real verb, against a live multi-GiB Slack window symlinked
 * into a throwaway home: `compact --source slack` fails with
 * `Cannot create a string longer than 0x1fffffe8 characters` and leaves the source UNFINISHED, because it
 * reads each window file into one string. A corpus large enough to print this message is by construction a
 * corpus compaction cannot rewrite, so the advice sent a reader to a verb that could only fail.
 *
 * @param dir the corpus root
 * @param fileCount how many `.jsonl` files the root holds
 * @param diskBytes their total size
 * @param readBytes how much had been read when the guard refused
 * @param shortfall the guard's verdict
 * @param projection what the whole corpus is projected to retain, from what this read measured
 * @returns the multi-line message
 */
function heapCeilingMessage({
  dir,
  fileCount,
  diskBytes,
  readBytes,
  shortfall,
  projection,
}: {
  dir: string;
  fileCount: number;
  diskBytes: number;
  readBytes: number;
  shortfall: HeapShortfall;
  projection: CorpusHeapProjection;
}): string {
  const mib = ({ bytes }: { bytes: number }): string => String(toMib({ bytes }));
  const reservePct = String(Math.round(HEAP_RESERVE_FRACTION * 100));
  const heldLabel = shortfall.collected ? "live" : "in use (uncollected)";
  const progress =
    readBytes > 0
      ? ` (${mib({ bytes: readBytes })} MiB of it already read, holding ${mib({ bytes: shortfall.usedBytes })} MiB ${heldLabel})`
      : ` (nothing read yet, ${mib({ bytes: shortfall.usedBytes })} MiB ${heldLabel})`;
  const basis = projection.measured
    ? `at the ${projection.ratio.toFixed(2)} heap bytes per disk byte this read has measured`
    : `at the band's ${projection.ratio.toFixed(2)} heap bytes per disk byte (too little read to measure a rate)`;
  return [
    `corpus at ${dir} is too large for this process's heap ceiling: ${String(fileCount)} file(s), ` +
      `${mib({ bytes: diskBytes })} MiB on disk${progress}. The next ` +
      `${mib({ bytes: shortfall.projectedBytes })} MiB would cross the ceiling of ` +
      `${mib({ bytes: shortfall.limitBytes })} MiB with ${reservePct}% kept free for the collector, and ` +
      `${basis} the whole corpus needs about ${mib({ bytes: projection.wholeCorpusBytes })} MiB. Refused here ` +
      `rather than dying in V8 with "Ineffective mark-compacts near heap limit".`,
    `  to finish this read today: NODE_OPTIONS=--max-old-space-size=${String(shortfall.suggestedLimitMib)} — ` +
      `sized for the WHOLE corpus, so it is one attempt and not a ladder. Still a mask, not a fix; the ` +
      `corpus keeps growing and the next ceiling arrives the same way.`,
    `  to fix it: reduce what the corpus holds (\`slopweaver compact\` streams, so it rewrites a source ` +
      `whose window files are past V8's 512 MiB string ceiling — the shape a corpus this large already ` +
      `has), narrow the read (\`--corpus <one source dir>\`), or re-measure the growth curve ` +
      `(\`slopweaver dev heap-curve\`) and reduce what a query holds.`,
  ].join("\n");
}

/** Factories for {@link CorpusStoreError} — the one place its message text is composed. */
export const CorpusStoreErrors = {
  /**
   * Build a {@link CorpusDirNotFoundError}.
   *
   * @param dir the corpus root that held no `.jsonl` file
   * @returns the typed error
   */
  dirNotFound: ({ dir }: { dir: string }): CorpusDirNotFoundError => ({
    code: "CORPUS_DIR_NOT_FOUND",
    dir,
    message: noCorpusFoundMessage({ dir }),
  }),

  /**
   * Build a {@link CorpusDirUnreadableError}.
   *
   * @param dir the corpus root
   * @param unreadableCount how many directories under it could not be listed
   * @returns the typed error
   */
  dirUnreadable: ({ dir, unreadableCount }: { dir: string; unreadableCount: number }): CorpusDirUnreadableError => ({
    code: "CORPUS_DIR_UNREADABLE",
    dir,
    message: `corpus at ${dir} could not be read (${String(unreadableCount)} unreadable director(ies))`,
    unreadableCount,
  }),

  /**
   * Build a {@link CorpusHeapCeilingError} from the guard's shortfall, carrying every number forward and
   * replacing the guard's own chunk-sized ceiling with one sized for the whole read.
   *
   * The guard cannot compute that ceiling itself: it is handed one projection at a time and knows nothing
   * about a corpus. This factory is the first place that holds both halves — the live heap the read is
   * standing on, and how much of the corpus is left — so it is where the two become advice.
   *
   * @param dir the corpus root
   * @param fileCount how many `.jsonl` files the root holds
   * @param diskBytes their total size
   * @param readBytes how much had been read when the guard refused
   * @param band the projection band — the floor a measured ratio may not fall below, and the ceiling that
   *   stands in for the preflight, which has measured nothing
   * @param shortfall the guard's verdict
   * @returns the typed error
   */
  heapCeiling: ({
    dir,
    fileCount,
    diskBytes,
    readBytes,
    band,
    shortfall,
  }: {
    dir: string;
    fileCount: number;
    diskBytes: number;
    readBytes: number;
    band: { readonly floor: number; readonly ceiling: number };
    shortfall: HeapShortfall;
  }): CorpusHeapCeilingError => {
    const projection = projectWholeCorpusHeap({
      band,
      diskBytes,
      liveBytes: shortfall.usedBytes,
      readBytes,
    });
    // Never suggest LESS than the guard's own chunk-sized figure: the extrapolation is about the rest of
    // the corpus, and the chunk in front of the read still has to land.
    const suggestedLimitMib = Math.max(projection.ceilingMib, shortfall.suggestedLimitMib);
    return {
      code: "CORPUS_HEAP_CEILING",
      dir,
      diskBytes,
      fileCount,
      limitBytes: shortfall.limitBytes,
      message: heapCeilingMessage({
        diskBytes,
        dir,
        fileCount,
        projection,
        readBytes,
        shortfall: { ...shortfall, suggestedLimitMib },
      }),
      projectedBytes: shortfall.projectedBytes,
      projection,
      readBytes,
      suggestedLimitMib,
      usedBytes: shortfall.usedBytes,
    };
  },

  /**
   * Build a {@link CorpusProtectedError} from the judge's refusal lines.
   *
   * @param dir the corpus root the read was for
   * @param lines the judge's refusal, one line each
   * @returns the typed error
   */
  protectedRead: ({ dir, lines }: { dir: string; lines: readonly string[] }): CorpusProtectedError => ({
    code: "CORPUS_PROTECTED",
    dir,
    message: lines.join("; "),
  }),

  /**
   * Build a {@link CorpusStatFailedError}.
   *
   * @param dir the corpus root whose stat call failed
   * @param message the underlying io error message
   * @returns the typed error
   */
  statFailed: ({ dir, message }: { dir: string; message: string }): CorpusStatFailedError => ({
    code: "CORPUS_STAT_FAILED",
    dir,
    message,
  }),
} as const;
