/** {@link compactionReport} — the per-hour, quality and spend rows a folded corpus produces. */
import { describe, expect, it } from "vitest";

import type { BoundaryMeasurement, TranscriptCompaction } from "../../../sessions/compactionFold.js";
import type { CompactionBoundary } from "../../../sessions/compactionRecord.js";
import { compactionReport } from "../../../sessions/compactionReport.js";

/** One boundary and what happened after it. */
function boundary({
  preTokens = 260_000,
  postTokens = 14_000,
  durationMs = 100_000,
  trigger = "auto",
  afterCalls = 0,
  reReads = 0,
  droppedReReads = 0,
}: {
  preTokens?: number;
  postTokens?: number;
  durationMs?: number;
  trigger?: string;
  afterCalls?: number;
  reReads?: number;
  droppedReReads?: number;
} = {}): BoundaryMeasurement {
  const record: CompactionBoundary = {
    cumulativeDroppedTokens: 900_000,
    droppedTokens: preTokens - postTokens,
    durationMs,
    postTokens,
    preservedUuids: [],
    preTokens,
    trigger,
  };
  return { afterCalls, boundary: record, droppedReReads, reReads };
}

/** A folded transcript carrying whatever the case under test needs. */
function transcript({
  boundaries = [],
  calls = [],
  byModel = new Map(),
  duplicates = 0,
  unreadable = 0,
  sidechainSkipped = 0,
}: Partial<TranscriptCompaction> = {}): TranscriptCompaction {
  return { boundaries, byModel, calls, duplicates, sidechainSkipped, unreadable };
}

/** A per-model usage total, as the fold hands one over. */
function totals({ cacheRead, turns }: { cacheRead: number; turns: number }) {
  return { cacheCreationTokens: 0, cacheReadTokens: cacheRead, inputTokens: 100, outputTokens: 50, turns };
}

const WHEN = { days: 7, observedAtIso: "2026-09-21T00:00:00.000Z", sinceIso: "2026-09-14T00:00:00.000Z" };

describe("compactionReport", () => {
  it("takes the MEDIAN of each boundary figure, not the mean, so one outlier cannot move the row", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({
          boundaries: [
            boundary({ durationMs: 10_000, preTokens: 100_000 }),
            boundary({ durationMs: 20_000, preTokens: 200_000 }),
            boundary({ durationMs: 9_000_000, preTokens: 900_000 }),
          ],
        }),
      ],
      windows: [],
    });
    expect(report.boundaries.count).toBe(3);
    expect(report.boundaries.medianPreTokens).toBe(200_000);
    expect(report.boundaries.medianDurationMs).toBe(20_000);
    expect(report.boundaries.totalDurationMs).toBe(9_030_000);
  });

  it("takes each drop off the boundary's own pre-minus-post, never the running cumulative total", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [transcript({ boundaries: [boundary({ postTokens: 14_000, preTokens: 260_000 })] })],
      windows: [],
    });
    expect(report.boundaries.medianDroppedTokens).toBe(246_000);
  });

  it("splits the boundaries by trigger, so a typed /compact is visible against an auto one", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({
          boundaries: [boundary({ trigger: "auto" }), boundary({ trigger: "auto" }), boundary({ trigger: "manual" })],
        }),
      ],
      windows: [],
    });
    expect(report.boundaries.byTrigger).toEqual({ auto: 2, manual: 1 });
  });

  it("rates both re-read counts over the same post-boundary denominator, summed across transcripts", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({ boundaries: [boundary({ afterCalls: 60, droppedReReads: 20, reReads: 30 })] }),
        transcript({ boundaries: [boundary({ afterCalls: 40, droppedReReads: 10, reReads: 20 })] }),
      ],
      windows: [],
    });
    expect(report.quality.postBoundaryCalls).toBe(100);
    expect(report.quality.reReads).toBe(50);
    expect(report.quality.reReadRate).toBe(0.5);
    expect(report.quality.droppedReReads).toBe(30);
    expect(report.quality.droppedReReadRate).toBe(0.3);
  });

  it("answers a zero rate rather than a NaN over a corpus with no boundary at all", () => {
    const report = compactionReport({ ...WHEN, transcripts: [transcript()], windows: [] });
    expect(report.boundaries.count).toBe(0);
    expect(report.quality.droppedReReadRate).toBe(0);
    expect(report.boundaries.medianPreTokens).toBe(0);
  });

  it("sums the cache draw and the turn count across every model and transcript", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({
          byModel: new Map([
            ["claude-opus-5", totals({ cacheRead: 1_000_000, turns: 10 })],
            ["claude-sonnet-5", totals({ cacheRead: 500_000, turns: 5 })],
          ]),
        }),
        transcript({ byModel: new Map([["claude-opus-5", totals({ cacheRead: 250_000, turns: 2 })]]) }),
      ],
      windows: [],
    });
    expect(report.spend.cacheReadTokens).toBe(1_750_000);
    expect(report.corpus.turns).toBe(17);
  });

  it("takes the boot floor as the median FIRST call across transcripts, and the per-call cache read as draw over turns", () => {
    const call = ({ context }: { context: number }) => ({
      afterRealBoundary: false,
      cacheReadTokens: 0,
      contextTokens: context,
    });
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({
          byModel: new Map([["claude-opus-5", totals({ cacheRead: 900_000, turns: 3 })]]),
          calls: [call({ context: 58_000 }), call({ context: 200_000 })],
        }),
        transcript({ calls: [call({ context: 61_000 })] }),
        transcript({ calls: [call({ context: 64_000 }), call({ context: 90_000 })] }),
        transcript({}),
      ],
      windows: [],
    });
    expect(report.context).toEqual({ cacheReadPerCall: 300_000, floorMedianTokens: 61_000, floorSampled: 3 });
  });

  it("reports a zero per-call read and an empty floor sample over a corpus with no calls", () => {
    const report = compactionReport({ ...WHEN, transcripts: [], windows: [] });
    expect(report.context).toEqual({ cacheReadPerCall: 0, floorMedianTokens: 0, floorSampled: 0 });
  });

  it("carries the weight card's own id and date, so the units can never be read without their basis", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [transcript({ byModel: new Map([["claude-opus-5", totals({ cacheRead: 10, turns: 1 })]]) })],
      windows: [],
    });
    expect(report.spend.weightCardId.length).toBeGreaterThan(0);
    expect(report.spend.weightCardAsOf.length).toBeGreaterThan(0);
  });

  it("reports what it could not read rather than dropping it, on every coverage field", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({ duplicates: 4, sidechainSkipped: 2, unreadable: 1 }),
        transcript({ duplicates: 1, sidechainSkipped: 3, unreadable: 0 }),
      ],
      windows: [],
    });
    expect(report.corpus).toEqual({ duplicates: 5, sidechainSkipped: 5, transcripts: 2, turns: 0, unreadable: 1 });
  });

  it("prices each candidate window against the window that ACTUALLY ran — the median real preTokens", () => {
    const report = compactionReport({
      ...WHEN,
      transcripts: [
        transcript({
          boundaries: [boundary({ preTokens: 260_000 })],
          calls: [
            { afterRealBoundary: false, cacheReadTokens: 50_000, contextTokens: 150_000 },
            { afterRealBoundary: false, cacheReadTokens: 80_000, contextTokens: 250_000 },
          ],
        }),
      ],
      windows: [100_000, 600_000],
    });
    expect(report.windows.map((row) => row.replay.windowTokens)).toEqual([100_000, 600_000]);
    expect(report.windows[0]!.priceable.known).toBe(true);
    expect(report.windows[1]!.priceable.known).toBe(false);
    expect(report.observedContextCeiling).toBe(250_000);
  });

  it("states every modelled step on the document itself, not only in a comment", () => {
    const report = compactionReport({ ...WHEN, transcripts: [transcript()], windows: [] });
    expect(report.assumptions.length).toBe(4);
    expect(report.assumptions.join("\n")).toContain("FLOOR");
    expect(report.assumptions.join("\n")).toContain("move the window and compare two readings instead");
  });

  it("carries the window it was asked for back onto the document", () => {
    const report = compactionReport({ ...WHEN, transcripts: [], windows: [] });
    expect(report.days).toBe(7);
    expect(report.sinceIso).toBe("2026-09-14T00:00:00.000Z");
    expect(report.observedAtIso).toBe("2026-09-21T00:00:00.000Z");
    expect(report.corpus.transcripts).toBe(0);
  });
});
