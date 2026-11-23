/**
 * The compaction report, as lines on a terminal.
 *
 * Progressive disclosure in a plain-text surface means ORDER: the verdict first, because that is the one
 * thing a reader may act on; then the three figures that decided it; then the window table, which is the
 * argument rather than the answer; then the assumptions, which are never collapsed away because the
 * compaction counts in that table depend on one of them.
 *
 * Pure: a report in, lines out.
 */
import type { CompactionReport } from "./compactionReport.js";
import type { CompactionSignal } from "./compactionSignal.js";
import { percent } from "./compactionSignal.js";
import { compactTokens, groupedTokens } from "./sessionCost.js";

/** Seconds, to one decimal place, from a millisecond figure. */
function seconds({ ms }: { ms: number }): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The lines that say what compaction, and the context every call carries, cost this window. */
function costLines({ report }: { report: CompactionReport }): readonly string[] {
  const { boundaries, quality, spend } = report;
  return [
    `  compactions      ${String(boundaries.count)} over ${String(report.days)} day(s), ${seconds({ ms: boundaries.medianDurationMs })} each (median), ${(boundaries.totalDurationMs / 60_000).toFixed(1)} min in total`,
    `  what went away   ${compactTokens({ count: boundaries.medianDroppedTokens })} dropped per compaction (median), ${compactTokens({ count: boundaries.medianPreTokens })} in → ${compactTokens({ count: boundaries.medianPostTokens })} out`,
    `  fetched again    ${percent({ value: quality.droppedReReadRate })} of ${String(quality.postBoundaryCalls)} post-boundary reads went back for something the summary DROPPED (${percent({ value: quality.reReadRate })} for anything read before it)`,
    `  cache draw       ${compactTokens({ count: spend.cacheReadTokens })} cache-read tokens across ${String(report.corpus.turns)} turns${weightedSuffix({ report })}`,
    `  context          ${compactTokens({ count: report.context.floorMedianTokens })} boot floor (median first call over ${String(report.context.floorSampled)} transcript(s)), ${compactTokens({ count: report.context.cacheReadPerCall })} cache read per call`,
  ];
}

/** The weighted-units clause, or the reason there is none. Never a silent omission. */
function weightedSuffix({ report }: { report: CompactionReport }): string {
  const { weighted, weightCardId } = report.spend;
  if (!weighted.known) {
    return ` — weighted units NOT MEASURED (${weighted.why})`;
  }
  return ` — ${compactTokens({ count: weighted.value.units })} weighted units on ${weightCardId}, covering ${String(weighted.value.coveredTurns)}/${String(weighted.value.totalTurns)} turns`;
}

/** The candidate-window table: what each window would have cost this same week. */
function windowLines({ report }: { report: CompactionReport }): readonly string[] {
  const rows = report.windows.map((row) => {
    const { replay, tradeVsNext, priceable } = row;
    const head = `  ${String(replay.windowTokens / 1000).padStart(4)}k`;
    if (!priceable.known) {
      return `${head}  NOT PRICEABLE from this week — ${priceable.why}`;
    }
    const priced = `${head}  ${compactTokens({ count: replay.avoidedCacheReadTokens }).padStart(7)} cache-read tokens avoided  ${String(replay.compactions).padStart(5)} compactions (floor)  ${String(replay.transcriptsReaching)} transcript(s) reached it`;
    if (!tradeVsNext.known) {
      return priced;
    }
    const trade = tradeVsNext.value;
    return `${priced}\n        step out to ${String(trade.looserTokens / 1000)}k: ${String(trade.extraCompactions)} fewer compactions costs ${compactTokens({ count: trade.extraTokensAvoided })} tokens — ${compactTokens({ count: trade.tokensPerExtraCompaction })} bought per extra compaction`;
  });
  return [
    "",
    `What another window would have cost this same week (it compacted at about ${compactTokens({ count: report.boundaries.medianPreTokens })}, reaching ${compactTokens({ count: report.observedContextCeiling })} at most, so it can only price DOWNWARD from there)`,
    ...rows,
  ];
}

/**
 * Render the whole report.
 *
 * @param report the document to print
 * @param signal the verdict taken against the last reading
 * @returns the lines to print, in order
 */
export function renderCompactionReport({
  report,
  signal,
}: {
  report: CompactionReport;
  signal: CompactionSignal;
}): readonly string[] {
  return [
    `compaction ${signal.verdict.toUpperCase()} — ${signal.because}`,
    `read ${String(report.corpus.transcripts)} transcript(s) written since ${report.sinceIso}, at ${report.observedAtIso}`,
    "",
    ...costLines({ report }),
    ...windowLines({ report }),
    "",
    "Assumptions this rests on",
    ...report.assumptions.map((line) => `  · ${line}`),
    ...problemLines({ report }),
  ];
}

/** What the pass could not read, or a line saying it read everything. Never silence either way. */
function problemLines({ report }: { report: CompactionReport }): readonly string[] {
  const { duplicates, unreadable, sidechainSkipped } = report.corpus;
  return [
    "",
    `Coverage: ${groupedTokens({ count: duplicates })} duplicate content-block line(s) skipped, ${String(unreadable)} unreadable, ${String(sidechainSkipped)} subagent turn(s) excluded`,
  ];
}
