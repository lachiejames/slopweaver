/**
 * The compaction report — what compaction cost the fleet this window, what a different window would have
 * cost, and whether the cost has got worse since the last reading.
 *
 * ## "Per hour" and "per dollar", each said the way it can honestly be said
 *
 * **Per hour** needs no model at all: a boundary record carries its own `durationMs`, so the seconds a
 * session spent summarising instead of working are read rather than estimated.
 *
 * **Per dollar is NOT printed in dollars**, and that is `./modelWeight.ts`'s standing ruling rather than a
 * gap here: the fleet runs on flat-rate plans, a transcript cannot distinguish a 5-minute from a 1-hour
 * cache write, long-context tiers are unreconstructable and published prices drift. So the spend side is
 * raw cache-read tokens — the counter a window actually moves — plus model-weighted index units carrying
 * the weight card's own id and date, and its coverage.
 *
 * ## The signal, and the two ways it refuses to fire
 *
 * The signal itself lives in `./compactionSignal.ts`: it compares this window’s dropped-re-read rate against the
 * last recorded reading of the same verb, and answers `unmeasurable` rather than `holding` when there is
 * no baseline or too few boundaries to say anything, because a comforting `holding` off three
 * boundaries is the same failure `./tokenDepth.ts` refuses when it declines to report a zero depth.
 *
 * Pure: folded transcripts in, a document out.
 */
import type { Measured } from "../measurement/status.js";
import type { BoundaryMeasurement, TranscriptCompaction } from "./compactionFold.js";
import { observedContextCeiling, replayWindows, type WindowRow } from "./compactionWindow.js";
import { CLAUDE_MODEL_WEIGHT_CARD, type ModelWeightedUsage, modelWeightedUsage } from "./modelWeight.js";

/** How much of the corpus the pass actually read. An absent count reads as "nothing to see", so none is absent. */
interface CompactionCorpus {
  readonly transcripts: number;
  readonly turns: number;
  readonly duplicates: number;
  readonly unreadable: number;
  readonly sidechainSkipped: number;
}

/** The boundaries themselves — the per-hour side, straight off the records. */
interface CompactionBoundaries {
  readonly count: number;
  readonly medianPreTokens: number;
  readonly medianPostTokens: number;
  readonly medianDroppedTokens: number;
  readonly medianDurationMs: number;
  readonly totalDurationMs: number;
  /** How many fired per trigger — `auto` against a typed `/compact`. */
  readonly byTrigger: Readonly<Record<string, number>>;
}

/** What compaction made sessions go and fetch again. The quality side. */
interface CompactionQuality {
  /** Read subjects named after a boundary. The denominator of both rates. */
  readonly postBoundaryCalls: number;
  /** Reads of a target the session had touched before the boundary. The coarse figure already on the owner's page. */
  readonly reReads: number;
  readonly reReadRate: number;
  /** Reads whose every earlier sighting sat in a record the summary DROPPED. The sharp figure. */
  readonly droppedReReads: number;
  readonly droppedReReadRate: number;
}

/** The spend side, in the two units this repository can defend. */
interface CompactionSpend {
  readonly cacheReadTokens: number;
  readonly weighted: Measured<ModelWeightedUsage>;
  readonly weightCardId: string;
  readonly weightCardAsOf: string;
}

/**
 * What every call carries before it does any work, and what an average call reads — the context-cost side.
 *
 * MEASURED (`slopweaver session compaction --days 7`, 629 transcripts): the median first call
 * carried about 60k tokens and the mean call read about 186k from the cache, so roughly a third of the
 * week's 27.6B cache-read tokens was the floor every session boots with. A growth in either is a cost every
 * later call pays, which is why the signal judges both.
 */
interface CompactionContext {
  /** The median, over transcripts with at least one counted call, of the FIRST call's context. */
  readonly floorMedianTokens: number;
  /** How many transcripts the floor median was taken over. */
  readonly floorSampled: number;
  /** Cache-read tokens per counted call — `spend.cacheReadTokens` over `corpus.turns`, 0 over none. */
  readonly cacheReadPerCall: number;
}

/** The whole document — printed by `--json`, and recorded as the next run's baseline. */
export interface CompactionReport {
  readonly context: CompactionContext;
  readonly observedAtIso: string;
  readonly sinceIso: string;
  readonly days: number;
  readonly corpus: CompactionCorpus;
  readonly boundaries: CompactionBoundaries;
  readonly quality: CompactionQuality;
  readonly spend: CompactionSpend;
  readonly windows: readonly WindowRow[];
  /** The largest context any counted call carried — how far out this corpus can price a window at all. */
  readonly observedContextCeiling: number;
  /** Every modelled step, on the document rather than only in a comment. */
  readonly assumptions: readonly string[];
}

/** The middle value of a sorted copy, or 0 when there is nothing to take one of. */
function median({ values }: { values: readonly number[] }): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) {
    return 0;
  }
  return middle;
}

/** A rate, or 0 when nothing was counted — a rate over no calls is not a quality finding. */
function rate({ part, whole }: { part: number; whole: number }): number {
  if (whole === 0) {
    return 0;
  }
  return part / whole;
}

/** Fold every boundary across every transcript into the per-hour row. */
function boundariesOf({ all }: { all: readonly BoundaryMeasurement[] }): CompactionBoundaries {
  const byTrigger: Record<string, number> = {};
  for (const entry of all) {
    const seen = byTrigger[entry.boundary.trigger];
    byTrigger[entry.boundary.trigger] = seen === undefined ? 1 : seen + 1;
  }
  return {
    byTrigger,
    count: all.length,
    medianDroppedTokens: median({ values: all.map((entry) => entry.boundary.droppedTokens) }),
    medianDurationMs: median({ values: all.map((entry) => entry.boundary.durationMs) }),
    medianPostTokens: median({ values: all.map((entry) => entry.boundary.postTokens) }),
    medianPreTokens: median({ values: all.map((entry) => entry.boundary.preTokens) }),
    totalDurationMs: all.reduce((sum, entry) => sum + entry.boundary.durationMs, 0),
  };
}

/** Fold every boundary's aftermath into the quality row. */
function qualityOf({ all }: { all: readonly BoundaryMeasurement[] }): CompactionQuality {
  const postBoundaryCalls = all.reduce((sum, entry) => sum + entry.afterCalls, 0);
  const reReads = all.reduce((sum, entry) => sum + entry.reReads, 0);
  const droppedReReads = all.reduce((sum, entry) => sum + entry.droppedReReads, 0);
  return {
    droppedReReadRate: rate({ part: droppedReReads, whole: postBoundaryCalls }),
    droppedReReads,
    postBoundaryCalls,
    reReadRate: rate({ part: reReads, whole: postBoundaryCalls }),
    reReads,
  };
}

/** One model's running total across the transcripts merged so far, or a fresh zeroed one. */
function runningTotal({
  merged,
  model,
}: {
  merged: ReadonlyMap<string, ModelRunningTotal>;
  model: string;
}): ModelRunningTotal {
  const seen = merged.get(model);
  if (seen === undefined) {
    return { cacheCreation: 0, cacheRead: 0, input: 0, output: 0, turns: 0 };
  }
  return seen;
}

/** What one model has accumulated while {@link spendOf} walks the corpus. */
interface ModelRunningTotal {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly turns: number;
}

/** The floor every session boots with and the mean call's cache read, folded from the counted calls. */
function contextOf({
  transcripts,
  cacheReadTokens,
  turns,
}: {
  transcripts: readonly TranscriptCompaction[];
  cacheReadTokens: number;
  turns: number;
}): CompactionContext {
  const floors = transcripts.flatMap((transcript) => transcript.calls.slice(0, 1).map((call) => call.contextTokens));
  return {
    cacheReadPerCall: Math.round(rate({ part: cacheReadTokens, whole: turns })),
    floorMedianTokens: median({ values: floors }),
    floorSampled: floors.length,
  };
}

/** Sum the per-model splits across every transcript, then weight them. */
function spendOf({ transcripts }: { transcripts: readonly TranscriptCompaction[] }): CompactionSpend {
  const merged = new Map<string, ModelRunningTotal>();
  let cacheReadTokens = 0;
  for (const transcript of transcripts) {
    for (const [model, totals] of transcript.byModel) {
      const base = runningTotal({ merged, model });
      merged.set(model, {
        cacheCreation: base.cacheCreation + totals.cacheCreationTokens,
        cacheRead: base.cacheRead + totals.cacheReadTokens,
        input: base.input + totals.inputTokens,
        output: base.output + totals.outputTokens,
        turns: base.turns + totals.turns,
      });
      cacheReadTokens += totals.cacheReadTokens;
    }
  }
  const usage = [...merged.entries()]
    .filter(([model]) => model !== "")
    .map(([model, totals]) => ({
      model,
      totals: {
        cacheCreationTokens: totals.cacheCreation,
        cacheReadTokens: totals.cacheRead,
        inputTokens: totals.input,
        outputTokens: totals.output,
        turns: totals.turns,
      },
    }))
    .toSorted((left, right) => left.model.localeCompare(right.model));
  return {
    cacheReadTokens,
    weightCardAsOf: CLAUDE_MODEL_WEIGHT_CARD.asOf,
    weightCardId: CLAUDE_MODEL_WEIGHT_CARD.id,
    weighted: modelWeightedUsage({ usage }),
  };
}

/** How many turns the pass counted, across every transcript. */
function turnsOf({ transcripts }: { transcripts: readonly TranscriptCompaction[] }): number {
  return transcripts.reduce(
    (sum, transcript) => sum + [...transcript.byModel.values()].reduce((inner, totals) => inner + totals.turns, 0),
    0,
  );
}

/**
 * Assemble the whole document from a folded corpus.
 *
 * @param transcripts every transcript folded by `./compactionFold.ts`
 * @param windows the candidate windows to price
 * @param observedAtIso when this was true of the world
 * @param sinceIso the oldest transcript write this pass looked at
 * @param days the width of the window, as the caller asked for it
 * @returns the report
 */
export function compactionReport({
  transcripts,
  windows,
  observedAtIso,
  sinceIso,
  days,
}: {
  transcripts: readonly TranscriptCompaction[];
  windows: readonly number[];
  observedAtIso: string;
  sinceIso: string;
  days: number;
}): CompactionReport {
  const all = transcripts.flatMap((transcript) => transcript.boundaries);
  const boundaries = boundariesOf({ all });
  const postTokens = boundaries.medianPostTokens;
  const spend = spendOf({ transcripts });
  const turns = turnsOf({ transcripts });
  return {
    assumptions: [
      `a simulated compaction drops the context to ${String(postTokens)} tokens — this window's own measured median postTokens; the avoided-token column does not depend on it, the compaction count does`,
      "auto-compact fires BELOW the configured window (a live boundary was measured at 267,547 against a 300,000 window), so every simulated compaction count here is a FLOOR",
      "a real compaction resets the simulation, because the trace has already taken that drop",
      "a window LOOSER than the one that actually ran cannot be priced from this data at all — the week never contained a context that big; move the window and compare two readings instead",
    ],
    boundaries,
    context: contextOf({ cacheReadTokens: spend.cacheReadTokens, transcripts, turns }),
    corpus: {
      duplicates: transcripts.reduce((sum, transcript) => sum + transcript.duplicates, 0),
      sidechainSkipped: transcripts.reduce((sum, transcript) => sum + transcript.sidechainSkipped, 0),
      transcripts: transcripts.length,
      turns,
      unreadable: transcripts.reduce((sum, transcript) => sum + transcript.unreadable, 0),
    },
    days,
    observedAtIso,
    quality: qualityOf({ all }),
    sinceIso,
    spend,
    observedContextCeiling: observedContextCeiling({ transcripts }),
    windows: replayWindows({ postTokens, ranAtTokens: ranAt({ boundaries, transcripts }), transcripts, windows }),
  };
}

/**
 * The window this corpus actually ran under: the median real `preTokens`.
 *
 * Falls back to the observed context ceiling when no compaction fired at all, because then nothing capped
 * the trace and the largest context anyone reached IS the limit of what can be priced.
 *
 * @param boundaries the already-folded boundary row
 * @param transcripts every folded transcript, for the fallback
 * @returns the effective window, in tokens
 */
function ranAt({
  boundaries,
  transcripts,
}: {
  boundaries: CompactionBoundaries;
  transcripts: readonly TranscriptCompaction[];
}): number {
  if (boundaries.count === 0) {
    return observedContextCeiling({ transcripts });
  }
  return boundaries.medianPreTokens;
}
