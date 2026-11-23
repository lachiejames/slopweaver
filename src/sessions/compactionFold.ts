/**
 * One transcript folded into what compaction cost it: every boundary, what each one made the session go and
 * fetch again, and the per-call context sizes a candidate window is replayed over.
 *
 * ## Two re-read counts, because the sharp one is new and the coarse one is the baseline
 *
 * {@link BoundaryMeasurement.reReads} is the figure already on the owner's page — a post-boundary read of a target
 * the session had touched before the boundary, 53% of post-boundary calls measured over seven days.
 * It is an APPROXIMATION: a file whose contents the summary kept still counts.
 *
 * {@link BoundaryMeasurement.droppedReReads} is the exact question, and it is askable only because a
 * boundary record names `preservedMessages.uuids`. A read counts here when EVERY earlier read of that target
 * sat in a record the summary threw away — which is, precisely, information that went away and had to be
 * fetched again. Both are reported, under different names, so that a later reader can never mistake a
 * changed definition for a moved number.
 *
 * ## The doubling defence
 *
 * `sessions/sessionCost.ts` measured that Claude Code writes ONE LINE PER CONTENT BLOCK — 36 usage-bearing
 * lines over 18 distinct `message.id`s on one live transcript. A fold that counted lines would double every
 * token figure here and double every re-read, since a `thinking` block and the `tool_use` block after it
 * quote the same cumulative usage. So a turn whose id has been counted is skipped ENTIRELY: its targets are
 * not harvested either.
 *
 * Pure: lines in, numbers out. The file reading lives in `./compactionStore.ts`.
 */
import {
  type CompactionBoundary,
  type CompactionTurn,
  contextTokensOf,
  readCompactionLine,
} from "./compactionRecord.js";
import { addUsage, type UsageTotals, ZERO_USAGE } from "./sessionCost.js";

/** One turn's context and cache draw — all the replay in `./compactionWindow.ts` needs. */
export interface CallContext {
  /** Every token the turn was handed. Compared against a candidate window. */
  readonly contextTokens: number;
  /** Tokens served from the prompt cache. What a tighter window would have avoided paying for. */
  readonly cacheReadTokens: number;
  /**
   * Whether a REAL compaction fired immediately before this call.
   *
   * The replay needs it, and the first live run is what proved so: a simulation that carries its own
   * dropped-token total across a real boundary subtracts a drop the trace had already taken, leaving a
   * negative simulated context that can never cross a window again. Over one day at the shipped 300k
   * window that reported SIX simulated compactions against 212 real ones. A real boundary is where the
   * trace resets, so it is where the simulation resets too.
   */
  readonly afterRealBoundary: boolean;
}

/** One compaction, with what it went on to cost the session that ran it. */
export interface BoundaryMeasurement {
  readonly boundary: CompactionBoundary;
  /** Read subjects named after the boundary. The denominator both rates are taken over. */
  readonly afterCalls: number;
  /** Of those, reads of a target the session had already touched before the boundary. The coarse figure. */
  readonly reReads: number;
  /** Of those, reads whose every earlier sighting sat in a record the summary DROPPED. The sharp figure. */
  readonly droppedReReads: number;
}

/** One transcript, folded. */
export interface TranscriptCompaction {
  readonly boundaries: readonly BoundaryMeasurement[];
  /** Every counted turn's context, in file order. The replay's input. */
  readonly calls: readonly CallContext[];
  /** Usage split by the model that served it, for `./modelWeight.ts`. */
  readonly byModel: ReadonlyMap<string, UsageTotals>;
  /** Lines skipped because their `message.id` had already been counted. ~50%, and printed rather than hidden. */
  readonly duplicates: number;
  /** Lines that mentioned a boundary or usage and could not be read. Never silent — each is a missing fact. */
  readonly unreadable: number;
  /** Subagent turns skipped. A subagent's reads are not the main thread's, and would inflate the signal. */
  readonly sidechainSkipped: number;
}

/** Where a target was read, and by which record — enough to ask whether the summary kept that record. */
interface PriorRead {
  readonly callIndex: number;
  readonly uuid: string;
}

/** The mutable half of the fold. Rebuilt per transcript; never shared between two. */
export interface CompactionFold {
  readonly counted: Set<string>;
  readonly reads: Map<string, PriorRead[]>;
  readonly open: BoundaryProgress[];
  readonly byModel: Map<string, UsageTotals>;
  calls: CallContext[];
  /** Set by a boundary, consumed by the next counted turn — the flag on {@link CallContext}. */
  boundaryPending: boolean;
  duplicates: number;
  unreadable: number;
  sidechainSkipped: number;
}

/** A boundary seen, and the counts still accumulating behind it. */
interface BoundaryProgress {
  readonly boundary: CompactionBoundary;
  readonly atCallIndex: number;
  readonly preserved: ReadonlySet<string>;
  afterCalls: number;
  reReads: number;
  droppedReReads: number;
}

/**
 * A fold that has read nothing.
 *
 * @returns a fresh, empty fold
 */
export function emptyCompactionFold(): CompactionFold {
  return {
    boundaryPending: false,
    byModel: new Map<string, UsageTotals>(),
    calls: [],
    counted: new Set<string>(),
    duplicates: 0,
    open: [],
    reads: new Map<string, PriorRead[]>(),
    sidechainSkipped: 0,
    unreadable: 0,
  };
}

/** Attribute one read to every boundary already behind it, and then remember it. */
function creditRead({ fold, target, uuid }: { fold: CompactionFold; target: string; uuid: string }): void {
  const priors = fold.reads.get(target);
  for (const progress of fold.open) {
    progress.afterCalls += 1;
    if (priors === undefined) {
      continue;
    }
    const before = priors.filter((prior) => prior.callIndex < progress.atCallIndex);
    if (before.length === 0) {
      continue;
    }
    progress.reReads += 1;
    if (before.every((prior) => !progress.preserved.has(prior.uuid))) {
      progress.droppedReReads += 1;
    }
  }
  if (priors === undefined) {
    fold.reads.set(target, [{ callIndex: fold.calls.length, uuid }]);
    return;
  }
  priors.push({ callIndex: fold.calls.length, uuid });
}

/** Fold one counted turn: its usage, its context, and every subject it read. */
function creditTurn({ fold, turn }: { fold: CompactionFold; turn: CompactionTurn }): void {
  for (const { target } of turn.targets) {
    creditRead({ fold, target, uuid: turn.uuid });
  }
  fold.byModel.set(
    turn.usage.model,
    addUsage({ totals: totalsFor({ fold, model: turn.usage.model }), turn: turn.usage }),
  );
  fold.calls.push({
    afterRealBoundary: fold.boundaryPending,
    cacheReadTokens: turn.usage.cacheReadTokens,
    contextTokens: contextTokensOf({ turn }),
  });
  fold.boundaryPending = false;
}

/** One model's running total, or a zeroed one when it has not been seen. */
function totalsFor({ fold, model }: { fold: CompactionFold; model: string }): UsageTotals {
  const seen = fold.byModel.get(model);
  if (seen === undefined) {
    return ZERO_USAGE;
  }
  return seen;
}

/**
 * Fold one transcript line onto the running state.
 *
 * Mutates rather than rebuilding: a 42 MB transcript is millions of lines, and copying a `Set` of counted
 * ids per line is the one shape that would make a full-corpus pass unaffordable. The state is private to
 * one transcript's walk and is never shared, so the mutation cannot be observed anywhere else.
 *
 * @param fold the state so far
 * @param line one raw line of the transcript
 * @returns nothing; {@link fold} carries the result
 */
export function advanceCompactionFold({ fold, line }: { fold: CompactionFold; line: string }): void {
  const read = readCompactionLine({ line });
  if (read.kind === "other") {
    return;
  }
  if (read.kind === "unreadable") {
    fold.unreadable += 1;
    return;
  }
  if (read.kind === "boundary") {
    fold.open.push({
      afterCalls: 0,
      atCallIndex: fold.calls.length,
      boundary: read.boundary,
      droppedReReads: 0,
      preserved: new Set(read.boundary.preservedUuids),
      reReads: 0,
    });
    fold.boundaryPending = true;
    return;
  }
  if (read.turn.sidechain) {
    fold.sidechainSkipped += 1;
    return;
  }
  if (fold.counted.has(read.turn.usage.messageId)) {
    fold.duplicates += 1;
    return;
  }
  fold.counted.add(read.turn.usage.messageId);
  creditTurn({ fold, turn: read.turn });
}

/**
 * Close the fold and hand over what one transcript measured.
 *
 * @param fold the state a whole transcript was walked into
 * @returns the transcript's boundaries, calls and counts
 */
export function finishCompactionFold({ fold }: { fold: CompactionFold }): TranscriptCompaction {
  return {
    boundaries: fold.open.map((progress) => ({
      afterCalls: progress.afterCalls,
      boundary: progress.boundary,
      droppedReReads: progress.droppedReReads,
      reReads: progress.reReads,
    })),
    byModel: fold.byModel,
    calls: fold.calls,
    duplicates: fold.duplicates,
    sidechainSkipped: fold.sidechainSkipped,
    unreadable: fold.unreadable,
  };
}

/**
 * Fold a whole transcript, given its lines.
 *
 * @param lines the transcript's raw lines, in file order
 * @returns what compaction cost that transcript
 */
export function foldCompaction({ lines }: { lines: Iterable<string> }): TranscriptCompaction {
  const fold = emptyCompactionFold();
  for (const line of lines) {
    advanceCompactionFold({ fold, line });
  }
  return finishCompactionFold({ fold });
}
