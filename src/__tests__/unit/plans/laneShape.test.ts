import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { capacityObligation, judgeLaneShapes, type LaneShapeRead, laneShapeLine } from "../../../plans/laneShape.js";
import type { RegisteredPlan } from "../../../plans/types.js";

const NOW = "2026-11-21T12:00:00.000Z";

const plan = (over: Partial<RegisteredPlan> & { alias: string }): RegisteredPlan => ({
  allowance: { kind: "weekly-window" },
  provider: "claude",
  storeDir: `/stores/${over.alias}`,
  usageLimitPercent: 100,
  ...over,
});

const claudePlans = ({ count }: { count: number }): readonly RegisteredPlan[] =>
  Array.from({ length: count }, (_, index) => plan({ alias: `plan-${String(index + 1)}` }));

const codexPlans = ({ count }: { count: number }): readonly RegisteredPlan[] =>
  Array.from({ length: count }, (_, index) => plan({ alias: `codex-${String(index + 1)}`, provider: "codex" }));

describe("judgeLaneShapes", () => {
  it("reads both lanes fill on five Claude and four Codex plans with no lapse recorded", () => {
    const plans = [...claudePlans({ count: 5 }), ...codexPlans({ count: 4 })];
    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(shapes).toStrictEqual({
      claude: {
        host: "claude",
        lapsedPlans: 0,
        mode: "fill",
        pausedPlans: 0,
        standingPlans: 5,
        unrecordedLapses: 5,
      },
      codex: {
        host: "codex",
        lapsedPlans: 0,
        mode: "fill",
        pausedPlans: 0,
        standingPlans: 4,
        unrecordedLapses: 4,
      },
      observedAtIso: NOW,
    });
  });

  it("reads a lane lean when exactly one plan stands, and the other lane is judged on its own count", () => {
    const plans = [...claudePlans({ count: 1 }), ...codexPlans({ count: 3 })];
    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(shapes.claude.mode).toBe("lean");
    expect(shapes.claude.standingPlans).toBe(1);
    expect(shapes.codex.mode).toBe("fill");
  });

  it("reads a lane whose every row has lapsed unavailable, never lean", () => {
    const plans = [plan({ alias: "gone", lapsesAtIso: "2026-11-01T00:00:00.000Z" }), ...codexPlans({ count: 2 })];

    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(shapes.claude.mode).toBe("unavailable");
    expect(shapes.claude.standingPlans).toBe(0);
  });

  it("reads a lane with no row at all unregistered, not unavailable", () => {
    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans: codexPlans({ count: 2 }) }));

    expect(shapes.claude.mode).toBe("unregistered");
    expect(shapes.codex.mode).toBe("fill");
  });

  it("counts a paused plan out of the standing plans", () => {
    const plans = [plan({ alias: "a" }), plan({ alias: "b", paused: { reason: "out", sinceIso: NOW } })];

    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(shapes.claude.mode).toBe("lean");
    expect(shapes.claude.pausedPlans).toBe(1);
  });

  it("keeps a plan whose lapse is still ahead standing, and counts one at or before now as lapsed", () => {
    const plans = [
      plan({ alias: "ahead", lapsesAtIso: "2026-11-21T12:00:00.001Z" }),
      plan({ alias: "boundary", lapsesAtIso: NOW }),
      plan({ alias: "past", lapsesAtIso: "2026-11-01T00:00:00.000Z" }),
    ];

    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(shapes.claude).toStrictEqual({
      host: "claude",
      lapsedPlans: 2,
      mode: "lean",
      pausedPlans: 0,
      standingPlans: 1,
      unrecordedLapses: 0,
    });
  });

  it("refuses an observation instant that is not ISO-8601", () => {
    const problems = unwrapErr(judgeLaneShapes({ nowIso: "yesterday", plans: claudePlans({ count: 2 }) }));

    expect(problems).toStrictEqual(["the observation instant yesterday is not an ISO-8601 instant"]);
  });

  it("refuses a recorded lapse that does not parse, naming the plan", () => {
    const plans = [plan({ alias: "bad", lapsesAtIso: "soon" }), plan({ alias: "good" })];

    const problems = unwrapErr(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(problems).toStrictEqual(["claude plan bad's recorded lapse soon is not an ISO-8601 instant"]);
  });
});

describe("capacityObligation", () => {
  const current = ({ plans }: { plans: readonly RegisteredPlan[] }): LaneShapeRead => ({
    kind: "current",
    shapes: unwrap(judgeLaneShapes({ nowIso: NOW, plans })),
  });

  it("is owed while either lane still fills", () => {
    const lanes = current({ plans: [...claudePlans({ count: 1 }), ...codexPlans({ count: 2 })] });
    expect(capacityObligation({ lanes })).toStrictEqual({ kind: "owed" });
  });

  it("is not owed once both lanes are recorded lean, naming both modes", () => {
    const lanes = current({ plans: [...claudePlans({ count: 1 }), ...codexPlans({ count: 1 })] });
    expect(capacityObligation({ lanes })).toStrictEqual({
      kind: "not-owed",
      why: "no lane is filling (claude lean, codex lean), so idle capacity is saved rather than filled",
    });
  });

  it("is owed while a lane has no row, which is unmeasured rather than absent, whichever lane is lean", () => {
    expect(capacityObligation({ lanes: current({ plans: claudePlans({ count: 1 }) }) })).toStrictEqual({
      kind: "owed",
    });
    expect(capacityObligation({ lanes: current({ plans: codexPlans({ count: 1 }) }) })).toStrictEqual({
      kind: "owed",
    });
  });

  it("is owed when neither lane has a row, an unreadable register, or no read at all", () => {
    expect(capacityObligation({ lanes: current({ plans: [] }) }).kind).toBe("owed");
    expect(capacityObligation({ lanes: { kind: "unreadable", why: "x" } }).kind).toBe("owed");
    expect(capacityObligation({ lanes: undefined }).kind).toBe("owed");
  });
});

describe("laneShapeLine", () => {
  it("names the mode and the standing count, with each nonzero side count", () => {
    const plans = [
      plan({ alias: "a" }),
      plan({ alias: "b", lapsesAtIso: "2026-12-01T00:00:00.000Z" }),
      plan({ alias: "c", paused: { reason: "out", sinceIso: NOW } }),
      plan({ alias: "d", lapsesAtIso: "2026-11-01T00:00:00.000Z" }),
    ];
    const shapes = unwrap(judgeLaneShapes({ nowIso: NOW, plans }));

    expect(laneShapeLine({ lane: shapes.claude })).toBe(
      "claude lane: fill — 2 standing (1 with no recorded lapse, 1 paused, 1 lapsed)",
    );
  });

  it("prints no parenthesis when every side count is zero", () => {
    const shapes = unwrap(
      judgeLaneShapes({ nowIso: NOW, plans: [plan({ alias: "a", lapsesAtIso: "2026-12-01T00:00:00.000Z" })] }),
    );

    expect(laneShapeLine({ lane: shapes.claude })).toBe("claude lane: lean — 1 standing");
  });
});
