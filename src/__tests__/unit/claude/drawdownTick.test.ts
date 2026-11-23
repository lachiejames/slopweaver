/**
 * One pass of the drawdown watch.
 *
 * Every effect is a plain recorder function, never a mock. The tests that matter most are the ones proving a
 * pass CANNOT spawn outside the watch's own recurring mode, and that a failed spawn is never retried — those
 * are the two ways this feature could turn into a workspace flood.
 */
import { describe, expect, it } from "vitest";
import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import type { DrawdownIncident, DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import type { DrawdownJournalEvent, DrawdownJournalRead } from "../../../claude/drawdownJournal.js";
import {
  type DrawdownTickDeps,
  type DrawdownTickMode,
  drawdownInvestigationBrief,
  processDrawdownTick,
} from "../../../claude/drawdownTick.js";
import { err, ok } from "../../../lib/result.js";

const HOME = "/tmp/not-touched";

/** A quiet week of 1%/h samples, so a baseline is mature enough to judge against. */
function quietHistory(): readonly DrawdownSample[] {
  const samples: DrawdownSample[] = [];
  for (let hour = 0; hour < 300; hour += 1) {
    samples.push({
      kind: "sample",
      observedAtIso: new Date(Date.UTC(2026, 8, 1) + hour * 3_600_000).toISOString(),
      planAlias: "plan-a",
      resetAtIso: `reset-${String(Math.floor(hour / 5))}`,
      schemaVersion: 1,
      utilization: 0.01 * (hour % 5),
      window: "five-hour",
    });
  }
  return samples;
}

const BASE = Date.UTC(2026, 8, 1) + 300 * 3_600_000;
const NOW_ISO = new Date(BASE + 3_600_000).toISOString();

/** Two prior burst samples in the journal, plus this tick's gauge, make the two consecutive fast intervals. */
function burstHistory(): readonly DrawdownSample[] {
  return [
    ...quietHistory(),
    {
      kind: "sample",
      observedAtIso: new Date(BASE).toISOString(),
      planAlias: "plan-a",
      resetAtIso: "reset-live",
      schemaVersion: 1,
      utilization: 0.0,
      window: "five-hour",
    },
    {
      kind: "sample",
      observedAtIso: new Date(BASE + 1_800_000).toISOString(),
      planAlias: "plan-a",
      resetAtIso: "reset-live",
      schemaVersion: 1,
      utilization: 0.1,
      window: "five-hour",
    },
  ];
}

/** This tick's reading, continuing the burst. */
const BURST_GAUGE: ClaudeAccountGauge = {
  alias: "plan-a",
  fiveHour: { resetAtIso: "reset-live", status: "allowed", utilization: 0.25 },
  observedAtIso: NOW_ISO,
  sevenDay: { resetAtIso: "seven-day-reset", status: "allowed", utilization: 0.3 },
};

/** A quiet reading that continues the calm. */
const CALM_GAUGE: ClaudeAccountGauge = {
  alias: "plan-a",
  fiveHour: { resetAtIso: "reset-live", status: "allowed", utilization: 0.101 },
  observedAtIso: NOW_ISO,
  sevenDay: { resetAtIso: "seven-day-reset", status: "allowed", utilization: 0.3 },
};

/** A recorder standing in for every effect, so nothing here touches a file or a socket. */
function recorder({
  history,
  opens = true,
  readFails = false,
}: {
  history: readonly DrawdownJournalEvent[];
  opens?: boolean;
  readFails?: boolean;
}): { deps: DrawdownTickDeps; appended: DrawdownJournalEvent[]; openCalls: number } {
  const appended: DrawdownJournalEvent[] = [];
  const state = { openCalls: 0 };
  const deps: DrawdownTickDeps = {
    appendJournal: ({ events }) => {
      appended.push(...events);
      return ok(undefined);
    },
    openInvestigation: () => {
      state.openCalls += 1;
      return Promise.resolve(
        opens ? ok({ incidentId: "i", workspaceRef: "workspace:99" }) : err(["cmux refused the spawn"]),
      );
    },
    readJournal: (): ReturnType<DrawdownTickDeps["readJournal"]> =>
      readFails
        ? err(["the drawdown journal could not be read: EACCES"])
        : ok({ events: history, unreadable: 0 } satisfies DrawdownJournalRead),
  };
  return {
    appended,
    get openCalls() {
      return state.openCalls;
    },
    deps,
  };
}

/** Run one pass in a named mode. */
async function tick({
  mode,
  history,
  gauge = BURST_GAUGE,
  opens = true,
  readFails = false,
}: {
  mode: DrawdownTickMode;
  history: readonly DrawdownJournalEvent[];
  gauge?: ClaudeAccountGauge;
  opens?: boolean;
  readFails?: boolean;
}) {
  const rec = recorder({ history, opens, readFails });
  const outcome = await processDrawdownTick({
    deps: rec.deps,
    gauges: [gauge],
    home: HOME,
    mode,
    nowIso: NOW_ISO,
  });
  return { outcome, rec };
}

describe("only the watch's own recurring mode can open anything", () => {
  it("opens an investigation in watch mode when the pace is anomalous", async () => {
    const { outcome, rec } = await tick({ history: burstHistory(), mode: "watch" });
    expect(outcome.investigation).toBe("opened");
    expect(rec.openCalls).toBe(1);
  });

  it("NEVER opens one in sample-only mode, however bad the pace", async () => {
    const { outcome, rec } = await tick({ history: burstHistory(), mode: "sample-only" });
    expect(outcome.investigation).toBe("none");
    expect(rec.openCalls).toBe(0);
  });

  it("NEVER opens one in dry-run mode", async () => {
    const { outcome, rec } = await tick({ history: burstHistory(), mode: "dry-run" });
    expect(outcome.investigation).toBe("none");
    expect(rec.openCalls).toBe(0);
  });

  it("writes nothing at all in dry-run mode", async () => {
    const { rec } = await tick({ history: burstHistory(), mode: "dry-run" });
    expect(rec.appended).toEqual([]);
  });

  it("records this tick's samples in sample-only mode", async () => {
    const { rec } = await tick({ history: burstHistory(), mode: "sample-only" });
    expect(rec.appended.every((event) => event.kind === "sample")).toBe(true);
    expect(rec.appended.length).toBe(2);
  });
});

describe("a calm tick", () => {
  it("opens nothing", async () => {
    const { outcome, rec } = await tick({ gauge: CALM_GAUGE, history: burstHistory(), mode: "watch" });
    expect(outcome.investigation).toBe("none");
    expect(rec.openCalls).toBe(0);
  });

  it("still records its samples, because a baseline is built from quiet hours", async () => {
    const { rec } = await tick({ gauge: CALM_GAUGE, history: burstHistory(), mode: "watch" });
    expect(rec.appended.length).toBe(2);
  });
});

describe("the attempt is journalled before the spawn", () => {
  it("writes an attempt row ahead of the opened row", async () => {
    const { rec } = await tick({ history: burstHistory(), mode: "watch" });
    const kinds = rec.appended.map((event) => event.kind);
    expect(kinds.indexOf("investigation-attempted")).toBeLessThan(kinds.indexOf("investigation-opened"));
  });

  it("records a failure and does not retry it", async () => {
    const { outcome, rec } = await tick({ history: burstHistory(), mode: "watch", opens: false });
    expect(outcome.investigation).toBe("failed");
    expect(rec.openCalls).toBe(1);
    expect(rec.appended.some((event) => event.kind === "investigation-failed")).toBe(true);
  });

  it("says in its own output that a failed investigation is not retried", async () => {
    const { outcome } = await tick({ history: burstHistory(), mode: "watch", opens: false });
    expect(outcome.lines.join("\n")).toContain("not retried automatically");
  });

  it("suppresses a second investigation of the same episode", async () => {
    const history: readonly DrawdownJournalEvent[] = [
      ...burstHistory(),
      {
        attemptedAtIso: NOW_ISO,
        incidentId: "plan-a:five-hour:reset-live",
        kind: "investigation-attempted",
        schemaVersion: 1,
        triggers: [],
      },
    ];
    const { outcome, rec } = await tick({ history, mode: "watch" });
    expect(outcome.investigation).toBe("suppressed");
    expect(rec.openCalls).toBe(0);
  });
});

describe("an unreadable journal judges nothing", () => {
  it("reports NOT MEASURED rather than treating an empty history as calm", async () => {
    const { outcome, rec } = await tick({ history: [], mode: "watch", readFails: true });
    expect(outcome.investigation).toBe("none");
    expect(outcome.lines[0]).toContain("NOT MEASURED");
    expect(rec.openCalls).toBe(0);
  });

  it("carries the read failure out as an error rather than swallowing it", async () => {
    const { outcome } = await tick({ history: [], mode: "watch", readFails: true });
    expect(outcome.errors.join("\n")).toContain("could not be read");
  });
});

describe("drawdownInvestigationBrief", () => {
  const incident: DrawdownIncident = {
    incidentId: "plan-a:five-hour:reset-live",
    observedAtIso: NOW_ISO,
    triggers: [
      {
        baselineFractionPerHour: 0.01,
        currentFractionPerHour: 0.3,
        maturity: "ready",
        planAlias: "plan-a",
        ratio: 30,
        resetAtIso: "reset-live",
        window: "five-hour",
      },
    ],
  };
  const brief = drawdownInvestigationBrief({ incident });

  it("names the plan, the window and the multiple", () => {
    expect(brief).toContain("plan-a five-hour");
    expect(brief).toContain("30.0x its normal");
  });

  it("tells the session to explain, never to act", () => {
    expect(brief).toContain("Do not rotate plans, change any session's model, or close anything.");
  });

  it("points it at the one command that ranks the sessions responsible", () => {
    expect(brief).toContain("slopweaver session depth");
  });
});
