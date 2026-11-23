/** {@link renderCompactionReport} — the verdict first, and never a silently omitted figure. */
import { describe, expect, it } from "vitest";

import { renderCompactionReport } from "../../../sessions/compactionRender.js";
import type { CompactionReport } from "../../../sessions/compactionReport.js";
import type { CompactionSignal } from "../../../sessions/compactionSignal.js";
import type { WindowRow } from "../../../sessions/compactionWindow.js";

/** A priced row, or an unpriceable one, as the replay hands it over. */
function row({
  windowTokens,
  priceable = true,
  trade,
}: {
  windowTokens: number;
  priceable?: boolean;
  trade?: { looserTokens: number; extraCompactions: number; extraTokensAvoided: number };
}): WindowRow {
  return {
    priceable: priceable ? { known: true, value: true } : { known: false, why: "the week never reached it" },
    replay: { avoidedCacheReadTokens: 5_000_000_000, compactions: 746, transcriptsReaching: 392, windowTokens },
    tradeVsNext:
      trade === undefined
        ? { known: false, why: "this is the loosest window priced" }
        : {
            known: true,
            value: {
              extraCompactions: trade.extraCompactions,
              extraTokensAvoided: trade.extraTokensAvoided,
              looserTokens: trade.looserTokens,
              tighterTokens: windowTokens,
              tokensPerExtraCompaction: trade.extraTokensAvoided / trade.extraCompactions,
            },
          },
  };
}

/** A report carrying the figures the renderer prints. */
function report({
  windows = [],
  weighted = true,
}: {
  windows?: readonly WindowRow[];
  weighted?: boolean;
} = {}): CompactionReport {
  return {
    assumptions: ["the count is a FLOOR", "the drop is modelled"],
    context: { cacheReadPerCall: 186_000, floorMedianTokens: 60_100, floorSampled: 631 },
    boundaries: {
      byTrigger: { auto: 378 },
      count: 378,
      medianDroppedTokens: 254_000,
      medianDurationMs: 134_300,
      medianPostTokens: 14_000,
      medianPreTokens: 267_000,
      totalDurationMs: 50_490_000,
    },
    corpus: { duplicates: 91_940, sidechainSkipped: 4, transcripts: 746, turns: 148_512, unreadable: 2 },
    days: 7,
    observedAtIso: "2026-09-21T09:36:39.947Z",
    observedContextCeiling: 966_000,
    quality: {
      droppedReReadRate: 0.473,
      droppedReReads: 30_895,
      postBoundaryCalls: 65_317,
      reReadRate: 0.48,
      reReads: 31_352,
    },
    sinceIso: "2026-09-14T09:42:29.862Z",
    spend: {
      cacheReadTokens: 31_700_000_000,
      weightCardAsOf: "2026-09-10",
      weightCardId: "anthropic-list-price-ratio-2026-09-10",
      weighted: weighted
        ? {
            known: true,
            value: {
              byFamily: [],
              coveredTurns: 147_854,
              excludedModels: [],
              totalTurns: 148_512,
              units: 9_930_000_000,
            },
          }
        : { known: false, why: "no model was named on any turn" },
    },
    windows,
  };
}

const HOLDING: CompactionSignal = { because: "47.3% → 47.3%, against 2026-09-14", verdict: "holding" };

describe("renderCompactionReport", () => {
  it("opens on the verdict, because that is the one line a reader may act on", () => {
    const lines = renderCompactionReport({ report: report(), signal: HOLDING });
    expect(lines[0]).toBe("compaction HOLDING — 47.3% → 47.3%, against 2026-09-14");
  });

  it("names the corpus and the instant the reading was true of, on the second line", () => {
    const lines = renderCompactionReport({ report: report(), signal: HOLDING });
    expect(lines[1]).toBe("read 746 transcript(s) written since 2026-09-14T09:42:29.862Z, at 2026-09-21T09:36:39.947Z");
  });

  it("prints the per-hour figures straight off the boundary records", () => {
    const text = renderCompactionReport({ report: report(), signal: HOLDING }).join("\n");
    expect(text).toContain("378 over 7 day(s), 134.3s each (median)");
    expect(text).toContain("841.5 min in total");
  });

  it("prints the dropped-re-read rate against its own denominator, and the coarser rate beside it", () => {
    const text = renderCompactionReport({ report: report(), signal: HOLDING }).join("\n");
    expect(text).toContain("47.3% of 65317 post-boundary reads");
    expect(text).toContain("48.0% for anything read before it");
  });

  it("names the weight card the units rest on, and its coverage", () => {
    const text = renderCompactionReport({ report: report(), signal: HOLDING }).join("\n");
    expect(text).toContain("anthropic-list-price-ratio-2026-09-10");
    expect(text).toContain("covering 147854/148512 turns");
  });

  it("prints the boot floor with the sample it was taken over, and the per-call cache read", () => {
    const text = renderCompactionReport({ report: report(), signal: HOLDING }).join("\n");
    expect(text).toContain(
      "  context          60.1k boot floor (median first call over 631 transcript(s)), 186k cache read per call",
    );
  });

  it("says why there are no weighted units rather than omitting the clause", () => {
    const text = renderCompactionReport({ report: report({ weighted: false }), signal: HOLDING }).join("\n");
    expect(text).toContain("weighted units NOT MEASURED (no model was named on any turn)");
  });

  it("marks an unpriceable window as such, rather than printing its zero", () => {
    const text = renderCompactionReport({
      report: report({ windows: [row({ priceable: false, windowTokens: 600_000 })] }),
      signal: HOLDING,
    }).join("\n");
    expect(text).toContain("600k  NOT PRICEABLE from this week — the week never reached it");
  });

  it("prints a priced row with the base it rests on, and the step out beneath it", () => {
    const text = renderCompactionReport({
      report: report({
        windows: [
          row({
            trade: { extraCompactions: 179, extraTokensAvoided: 2_670_000_000, looserTokens: 250_000 },
            windowTokens: 200_000,
          }),
        ],
      }),
      signal: HOLDING,
    }).join("\n");
    expect(text).toContain("392 transcript(s) reached it");
    expect(text).toContain("step out to 250k: 179 fewer compactions");
    expect(text).toContain("14.9M bought per extra compaction");
  });

  it("prints every assumption the document carries, never collapsing them away", () => {
    const text = renderCompactionReport({ report: report(), signal: HOLDING }).join("\n");
    expect(text).toContain("· the count is a FLOOR");
    expect(text).toContain("· the drop is modelled");
  });

  it("ends on what it could not read, so a partial pass cannot read as a complete one", () => {
    const lines = renderCompactionReport({ report: report(), signal: HOLDING });
    expect(lines.at(-1)).toBe(
      "Coverage: 91,940 duplicate content-block line(s) skipped, 2 unreadable, 4 subagent turn(s) excluded",
    );
  });
});
