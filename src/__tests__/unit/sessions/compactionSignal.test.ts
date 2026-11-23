/** {@link compactionVerdict} and {@link baselineOf} — the two ways the signal refuses to say "fine". */
import { describe, expect, it } from "vitest";

import type { Measured } from "../../../measurement/status.js";
import type { CompactionReport } from "../../../sessions/compactionReport.js";
import {
  baselineOf,
  type CompactionBaseline,
  compactionVerdict,
  DROPPED_RE_READ_TOLERANCE,
  FLOOR_GROWTH_TOLERANCE,
  MIN_BOUNDARIES_TO_JUDGE,
  PER_CALL_GROWTH_TOLERANCE,
  percent,
} from "../../../sessions/compactionSignal.js";

/** A report carrying only the figures the verdict reads. */
function report({
  boundaryCount,
  droppedReReadRate,
  floorMedianTokens = 60_000,
  cacheReadPerCall = 186_000,
}: {
  boundaryCount: number;
  droppedReReadRate: number;
  floorMedianTokens?: number;
  cacheReadPerCall?: number;
}): CompactionReport {
  return {
    assumptions: [],
    context: { cacheReadPerCall, floorMedianTokens, floorSampled: 1 },
    boundaries: {
      byTrigger: { auto: boundaryCount },
      count: boundaryCount,
      medianDroppedTokens: 250_000,
      medianDurationMs: 130_000,
      medianPostTokens: 14_000,
      medianPreTokens: 267_000,
      totalDurationMs: 130_000 * boundaryCount,
    },
    corpus: { duplicates: 0, sidechainSkipped: 0, transcripts: 1, turns: 100, unreadable: 0 },
    days: 7,
    observedAtIso: "2026-09-21T00:00:00.000Z",
    observedContextCeiling: 300_000,
    quality: {
      droppedReReadRate,
      droppedReReads: 10,
      postBoundaryCalls: 100,
      reReadRate: droppedReReadRate,
      reReads: 10,
    },
    sinceIso: "2026-09-14T00:00:00.000Z",
    spend: {
      cacheReadTokens: 1_000,
      weightCardAsOf: "2026-09-01",
      weightCardId: "card",
      weighted: { known: false, why: "no models counted" },
    },
    windows: [],
  };
}

/** A baseline the ledger would have handed back. */
function baseline({
  boundaryCount,
  droppedReReadRate,
}: {
  boundaryCount: number;
  droppedReReadRate: number;
}): CompactionBaseline {
  return { boundaryCount, droppedReReadRate, observedAtIso: "2026-09-14T00:00:00.000Z" };
}

/** The baseline that document decodes to, or a throw naming why it did not — the `unwrap` shape. */
function valueOf({ read }: { read: Measured<CompactionBaseline> }): CompactionBaseline {
  if (!read.known) {
    throw new Error(`expected a baseline, got: ${read.why}`);
  }
  return read.value;
}

/** The reason that document was refused, or a throw saying it was accepted. */
function whyOf({ read }: { read: Measured<CompactionBaseline> }): string {
  if (read.known) {
    throw new Error("expected a refusal, got a baseline");
  }
  return read.why;
}

describe("compactionVerdict — the context classes", () => {
  const withContext = ({ floor, perCall }: { floor: number; perCall: number }): CompactionBaseline => ({
    ...baseline({ boundaryCount: 100, droppedReReadRate: 0.2 }),
    cacheReadPerCall: perCall,
    floorMedianTokens: floor,
  });

  it("fires when the boot floor grows past its relative tolerance, naming that class alone", () => {
    const signal = compactionVerdict({
      baseline: withContext({ floor: 60_000, perCall: 186_000 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.2, floorMedianTokens: 67_000 }),
    });
    expect(signal.verdict).toBe("regressed");
    expect(signal.because).toBe(
      "boot floor (median first-call context) 60000 → 67000 tokens — a growth of 11.7%, past the 10.0% tolerance",
    );
  });

  it("holds when the floor grew by less than its tolerance", () => {
    const signal = compactionVerdict({
      baseline: withContext({ floor: 60_000, perCall: 186_000 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.2, floorMedianTokens: 65_000 }),
    });
    expect(signal.verdict).toBe("holding");
    expect(signal.because).toContain("boot floor (median first-call context) 60000 → 65000 tokens");
  });

  it("fires when the per-call cache read grows past its relative tolerance", () => {
    const signal = compactionVerdict({
      baseline: withContext({ floor: 60_000, perCall: 186_000 }),
      current: report({ boundaryCount: 100, cacheReadPerCall: 230_000, droppedReReadRate: 0.2 }),
    });
    expect(signal.verdict).toBe("regressed");
    expect(signal.because).toBe(
      "cache read per call 186000 → 230000 tokens — a growth of 23.7%, past the 20.0% tolerance",
    );
  });

  it("names every class that regressed, joined, when more than one did", () => {
    const signal = compactionVerdict({
      baseline: withContext({ floor: 60_000, perCall: 186_000 }),
      current: report({
        boundaryCount: 100,
        cacheReadPerCall: 300_000,
        droppedReReadRate: 0.3,
        floorMedianTokens: 90_000,
      }),
    });
    expect(signal.verdict).toBe("regressed");
    expect(signal.because.split("; ")).toHaveLength(3);
  });

  it("skips both context classes against a baseline that predates them, judging the re-read class alone", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 100, droppedReReadRate: 0.2 }),
      current: report({
        boundaryCount: 100,
        cacheReadPerCall: 900_000,
        droppedReReadRate: 0.2,
        floorMedianTokens: 900_000,
      }),
    });
    expect(signal.verdict).toBe("holding");
    expect(signal.because).toBe(
      "20.0% → 20.0% of post-boundary reads fetched something the summary had dropped, against 2026-09-14T00:00:00.000Z",
    );
  });

  it("fails on a grown floor even when too few boundaries leave the re-read rate unjudgeable", () => {
    const signal = compactionVerdict({
      baseline: withContext({ floor: 60_000, perCall: 186_000 }),
      current: report({ boundaryCount: 3, droppedReReadRate: 0.2, floorMedianTokens: 120_000 }),
    });
    expect(signal.verdict).toBe("regressed");
    expect(signal.because).toBe(
      "boot floor (median first-call context) 60000 → 120000 tokens — a growth of 100.0%, past the 10.0% tolerance",
    );
  });

  it("stays unmeasurable, naming the boundary gate, when the context held and the rate cannot be judged", () => {
    const signal = compactionVerdict({
      baseline: withContext({ floor: 60_000, perCall: 186_000 }),
      current: report({ boundaryCount: 3, droppedReReadRate: 0.2 }),
    });
    expect(signal.verdict).toBe("unmeasurable");
    expect(signal.because).toBe("3 boundaries in this window, under the 20 a rate needs to mean anything");
  });

  it("declares the tolerances the doc comments measure", () => {
    expect([FLOOR_GROWTH_TOLERANCE, PER_CALL_GROWTH_TOLERANCE]).toEqual([0.1, 0.2]);
  });
});

describe("compactionVerdict", () => {
  it("fires when the dropped-re-read rate rises past the tolerance", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 100, droppedReReadRate: 0.2 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.31 }),
    });
    expect(signal.verdict).toBe("regressed");
    expect(signal.because).toContain("20.0% → 31.0%");
    expect(signal.because).toContain("past the 5.0% tolerance");
  });

  it("holds when the rate rose by less than the tolerance", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 100, droppedReReadRate: 0.2 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.24 }),
    });
    expect(signal.verdict).toBe("holding");
    expect(signal.because).toContain("2026-09-14T00:00:00.000Z");
  });

  it("holds when the rate FELL, however far", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 100, droppedReReadRate: 0.5 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.1 }),
    });
    expect(signal.verdict).toBe("holding");
  });

  it("takes a caller's own tolerance over the default", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 100, droppedReReadRate: 0.2 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.24 }),
      tolerance: 0.01,
    });
    expect(signal.verdict).toBe("regressed");
  });

  it("is unmeasurable rather than holding when THIS window holds too few boundaries", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 100, droppedReReadRate: 0.2 }),
      current: report({ boundaryCount: MIN_BOUNDARIES_TO_JUDGE - 1, droppedReReadRate: 0.0 }),
    });
    expect(signal.verdict).toBe("unmeasurable");
    expect(signal.because).toContain("19 boundaries in this window");
  });

  it("is unmeasurable when the ledger holds no earlier reading at all", () => {
    const signal = compactionVerdict({
      baseline: undefined,
      current: report({ boundaryCount: 100, droppedReReadRate: 0.2 }),
    });
    expect(signal.verdict).toBe("unmeasurable");
    expect(signal.because).toContain("no earlier reading");
  });

  it("is unmeasurable when the BASELINE holds too few boundaries, so a rise off noise cannot fire it", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: 3, droppedReReadRate: 0.0 }),
      current: report({ boundaryCount: 100, droppedReReadRate: 0.9 }),
    });
    expect(signal.verdict).toBe("unmeasurable");
    expect(signal.because).toContain("holds 3 boundaries");
  });

  it("judges exactly at the bar, so the documented minimum is the minimum", () => {
    const signal = compactionVerdict({
      baseline: baseline({ boundaryCount: MIN_BOUNDARIES_TO_JUDGE, droppedReReadRate: 0.2 }),
      current: report({ boundaryCount: MIN_BOUNDARIES_TO_JUDGE, droppedReReadRate: 0.2 }),
    });
    expect(signal.verdict).toBe("holding");
  });
});

describe("baselineOf", () => {
  it("reads the three fields off a whole stored report", () => {
    const stored: unknown = report({ boundaryCount: 212, droppedReReadRate: 0.533 });
    expect(valueOf({ read: baselineOf({ document: stored }) })).toEqual({
      boundaryCount: 212,
      cacheReadPerCall: 186_000,
      droppedReReadRate: 0.533,
      floorMedianTokens: 60_000,
      observedAtIso: "2026-09-21T00:00:00.000Z",
    });
  });

  it("reads a reading taken before the context classes existed as a baseline without them", () => {
    const document = {
      boundaries: { count: 378 },
      observedAtIso: "2026-09-21T09:36:39.947Z",
      quality: { droppedReReadRate: 0.473 },
    };
    expect(valueOf({ read: baselineOf({ document }) })).toEqual({
      boundaryCount: 378,
      droppedReReadRate: 0.473,
      observedAtIso: "2026-09-21T09:36:39.947Z",
    });
  });

  it("names an unnamed instant rather than refusing a document with no observedAtIso", () => {
    const document = { boundaries: { count: 30 }, quality: { droppedReReadRate: 0.1 } };
    expect(valueOf({ read: baselineOf({ document }) }).observedAtIso).toBe("an unnamed instant");
  });

  it("refuses a document that is not an object", () => {
    expect(whyOf({ read: baselineOf({ document: "compaction is fine" }) })).toContain("not a JSON object");
  });

  it("refuses a document whose sections have drifted, rather than zeroing the baseline", () => {
    expect(whyOf({ read: baselineOf({ document: { quality: { droppedReReadRate: 0.1 } } }) })).toContain(
      "shape has drifted",
    );
  });

  it("refuses a document whose rate is missing, rather than reading it as zero", () => {
    const document = { boundaries: { count: 30 }, quality: { reReadRate: 0.1 } };
    expect(whyOf({ read: baselineOf({ document }) })).toContain("no boundary count or dropped-re-read rate");
  });

  it("refuses a rate that is not finite, so a NaN cannot read as a clean baseline", () => {
    const document = { boundaries: { count: 30 }, quality: { droppedReReadRate: Number.NaN } };
    expect(whyOf({ read: baselineOf({ document }) })).toContain("no boundary count or dropped-re-read rate");
  });
});

describe("percent", () => {
  it("renders a rate to one decimal place", () => {
    expect(percent({ value: 0.5333 })).toBe("53.3%");
  });

  it("renders the default tolerance the refusal text quotes", () => {
    expect(percent({ value: DROPPED_RE_READ_TOLERANCE })).toBe("5.0%");
  });
});
