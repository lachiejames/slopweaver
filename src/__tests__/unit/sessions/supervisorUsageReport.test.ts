/**
 * The one report a supervisor reads.
 *
 * The properties worth pinning are the ones a later edit would quietly break: the fleet fold ignores rows it
 * could not read WITHOUT pretending they were free, the units are never labelled as money, and the text
 * never tells a supervisor to respawn anything.
 */
import { describe, expect, it } from "vitest";
import type { Measured } from "../../../measurement/status.js";
import type { SessionDepthRow, SessionUsage } from "../../../sessions/depthReport.js";
import { modelWeightedUsage } from "../../../sessions/modelWeight.js";
import type { CostCursor, UsageTotals } from "../../../sessions/sessionCost.js";
import { modelUsageTotals } from "../../../sessions/sessionCost.js";
import {
  DEPTH_ECONOMICS_EVIDENCE,
  renderSupervisorUsageReport,
  summarizeSessionDepth,
  supervisorUsageReport,
} from "../../../sessions/supervisorUsageReport.js";

/** The value of a `Measured` this test asserts is known — throwing, so no assertion carries a conditional. */
function unwrapMeasured<T>({ measured }: { measured: Measured<T> }): T {
  if (!measured.known) {
    throw new Error(`expected a measured value, got: ${measured.why}`);
  }
  return measured.value;
}

/** A cursor holding one model's turns, so the fixtures below read as the arithmetic they are. */
function cursorFor({ model, turns, cacheRead }: { model: string; turns: number; cacheRead: number }): CostCursor {
  const totals: UsageTotals = {
    cacheCreationTokens: 0,
    cacheReadTokens: cacheRead,
    inputTokens: 0,
    outputTokens: 0,
    turns,
  };
  return {
    counted: new Set<string>(),
    duplicates: 0,
    models: [model],
    offsetBytes: 0,
    totals,
    unreadable: 0,
    usageByModel: new Map([[model, totals]]),
  };
}

/** One session's usage as the command builds it. */
function usageOf({
  model,
  turns,
  cacheRead,
  unreadable = 0,
}: {
  model: string;
  turns: number;
  cacheRead: number;
  unreadable?: number;
}): Measured<SessionUsage> {
  const cursor = cursorFor({ cacheRead, model, turns });
  const byModel = modelUsageTotals({ cursor });
  return {
    known: true,
    value: {
      byModel,
      duplicates: 0,
      totals: cursor.totals,
      unreadable,
      weighted: modelWeightedUsage({ usage: byModel }),
    },
  };
}

/** A row carrying only what this report reads off it. */
function row({ sessionId, usage }: { sessionId: string; usage: Measured<SessionUsage> }): SessionDepthRow {
  return {
    cwd: `/wt/${sessionId}`,
    cwdShared: false,
    depth: { known: false, why: "not read in this fixture" },
    pid: 1,
    self: false,
    sessionId,
    sessionKey: undefined,
    slug: undefined,
    standing: undefined,
    title: sessionId,
    usage,
    verdict: { known: false, why: "not read in this fixture" },
    workspaceRef: undefined,
  };
}

const FABLE = row({
  sessionId: "fable",
  usage: usageOf({ cacheRead: 1_000_000, model: "claude-fable-5-1", turns: 2 }),
});
const SONNET = row({
  sessionId: "sonnet",
  usage: usageOf({ cacheRead: 1_000_000, model: "claude-sonnet-5", turns: 10 }),
});
const UNREADABLE = row({
  sessionId: "unreadable",
  usage: { known: false, why: "transcript could not be read (ENOENT)" },
});

describe("summarizeSessionDepth", () => {
  it("folds every readable row's turns", () => {
    expect(summarizeSessionDepth({ rows: [FABLE, SONNET] }).totals.turns).toBe(12);
  });

  it("counts an unreadable row in the total but not in the measured count", () => {
    const summary = summarizeSessionDepth({ rows: [FABLE, SONNET, UNREADABLE] });
    expect(summary.totalSessions).toBe(3);
    expect(summary.measuredSessions).toBe(2);
  });

  it("does not let an unreadable row change the fold, which would read as a free session", () => {
    const withIt = summarizeSessionDepth({ rows: [FABLE, SONNET, UNREADABLE] });
    const without = summarizeSessionDepth({ rows: [FABLE, SONNET] });
    expect(withIt.totals).toEqual(without.totals);
  });

  it("weights the fleet so two Fable turns outweigh ten Sonnet ones", () => {
    const summary = summarizeSessionDepth({ rows: [FABLE, SONNET] });
    const families = unwrapMeasured({ measured: summary.weighted }).byFamily;
    expect(families.map((entry) => entry.family)).toEqual(["fable-5.1", "sonnet-5"]);
  });

  it("adds two sessions on one model into that model's split rather than keeping only the last", () => {
    const again = row({
      sessionId: "fable-again",
      usage: usageOf({ cacheRead: 1_000_000, model: "claude-fable-5-1", turns: 3 }),
    });
    const split = summarizeSessionDepth({ rows: [FABLE, again] }).byModel;
    expect(split.map((entry) => [entry.model, entry.totals.turns])).toEqual([["claude-fable-5-1", 5]]);
  });

  it("carries unreadable usage lines forward rather than swallowing them", () => {
    const noisy = row({
      sessionId: "noisy",
      usage: usageOf({ cacheRead: 10, model: "claude-opus-5", turns: 1, unreadable: 4 }),
    });
    expect(summarizeSessionDepth({ rows: [noisy] }).unreadableUsageLines).toBe(4);
  });
});

describe("the rendered report", () => {
  const report = supervisorUsageReport({
    observedAtIso: "2026-09-10T12:00:00.000Z",
    rows: [FABLE, SONNET],
    thresholdTokens: 600_000,
  });
  const lines = renderSupervisorUsageReport({ renderRow: ({ row: each }) => each.sessionId, report });
  const text = lines.join("\n");

  it("leads with how much of the fleet it speaks for", () => {
    expect(lines[0]).toBe("sessions 2 (2 with a readable transcript) · observed 2026-09-10T12:00:00.000Z");
  });

  it("names the rate card and its date beside the mix", () => {
    expect(text).toContain("anthropic-list-price-ratio-2026-09-24");
    expect(text).toContain("as of 2026-09-24");
  });

  it("says outright that the units are not dollars", () => {
    expect(text).toContain("Index units, NOT dollars");
  });

  it("never prints a currency sign against a session's own figure", () => {
    expect(text).not.toContain("$1");
    expect(text).not.toContain("cost:");
  });

  it("tells the supervisor a row reads review, and why it never reads respawn", () => {
    expect(text).toContain("A row reads `review` past 600k. It never reads `respawn`");
    expect(text).toContain("a third of the pickup's own turn count");
  });

  it("carries the measured split that justifies leaving the call to a human", () => {
    expect(text).toContain("of 62 sessions that crossed 600k, 41 were past that line and 21 were not");
  });

  it("stays quiet about unreadable lines when there are none", () => {
    expect(text).not.toContain("could not be read — that spend is missing");
  });
});

describe("the report says so when spend is missing", () => {
  it("names the count of unreadable usage lines", () => {
    const noisy = row({
      sessionId: "noisy",
      usage: usageOf({ cacheRead: 10, model: "claude-opus-5", turns: 1, unreadable: 3 }),
    });
    const report = supervisorUsageReport({
      observedAtIso: "2026-09-10T12:00:00.000Z",
      rows: [noisy],
      thresholdTokens: 600_000,
    });
    const text = renderSupervisorUsageReport({ renderRow: ({ row: each }) => each.sessionId, report }).join("\n");
    expect(text).toContain("3 usage line(s) mentioned usage and could not be read");
  });
});

describe("the economics evidence is data, so the prose cannot drift from it", () => {
  it("holds the measured crossing counts", () => {
    expect(DEPTH_ECONOMICS_EVIDENCE.crossedSixHundred).toBe(62);
    expect(DEPTH_ECONOMICS_EVIDENCE.pastBreakEvenAtSixHundred).toBe(41);
  });

  it("holds the per-band figures the saving is derived from", () => {
    expect(DEPTH_ECONOMICS_EVIDENCE.dollarsPerThousandTurnsShallow).toBe(128);
    expect(DEPTH_ECONOMICS_EVIDENCE.dollarsPerThousandTurnsDeep).toBe(500);
  });

  it("leaves a minority of crossings on the wrong side, which is why the verdict is not an action", () => {
    expect(DEPTH_ECONOMICS_EVIDENCE.pastBreakEvenAtSixHundred).toBeLessThan(DEPTH_ECONOMICS_EVIDENCE.crossedSixHundred);
  });
});
