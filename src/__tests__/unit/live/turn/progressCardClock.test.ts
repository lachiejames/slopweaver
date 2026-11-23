/**
 * The turn clock on the live card, pinned against the incident's own instants: the owner asked
 * "yo" (`1789788122.066099`), read a card that had never moved 23 minutes later, and was answered at
 * the 51-minute mark. `src/__tests__/fixtures/replay/inline-turn-silent-card-19sep` is that turn frozen.
 */
import { describe, expect, it } from "vitest";

import {
  activityWindowStart,
  CARD_LINE_CAP,
  nowLine,
  progressChecklistSteps,
  stillWorkingLead,
  turnClockLead,
} from "../../../../live/turn/progressCard.js";
import { reviewNowLine } from "../../../../live/turn/reviewThroughput.js";

const ASK_TS = "1789788122.066099";
const OWNER_LOOKED = "2026-09-19T03:45:00.000Z";

describe("stillWorkingLead", () => {
  it("reads the wait the owner had at the moment they asked whether it worked", () => {
    expect(stillWorkingLead({ askTs: ASK_TS, nowIso: OWNER_LOOKED })).toBe("still working, 22m");
  });

  it("reads the whole wait at the moment the answer landed", () => {
    expect(stillWorkingLead({ askTs: ASK_TS, nowIso: "2026-09-19T04:13:06.000Z" })).toBe("still working, 51m");
  });

  it("names no clock for a timestamp it cannot read", () => {
    expect(stillWorkingLead({ askTs: "not-a-ts", nowIso: OWNER_LOOKED })).toBeUndefined();
  });
});

describe("nowLine with a turn clock", () => {
  const turnClock = "still working, 22m";

  it("is the clock alone when the worker's log has nothing, never a false `0 tool calls`", () => {
    expect(nowLine({ callsSoFar: 0, latest: undefined, nowIso: OWNER_LOOKED, turnClock })).toBe(
      "now: still working, 22m",
    );
  });

  it("leads the worker's own line when there is activity", () => {
    const latest = { target: "src/live/turn/answer.ts", tool: "Read", tsIso: "2026-09-19T03:43:00.000Z" };
    expect(nowLine({ callsSoFar: 7, latest, nowIso: OWNER_LOOKED, turnClock })).toBe(
      "now: still working, 22m · reading a file (started 2m ago) · 7 tool calls so far",
    );
  });

  it("keeps the clock when the cap cuts the line, because the clamp only eats the tail", () => {
    const latest = { target: undefined, tool: "mcp__".padEnd(110, "x"), tsIso: OWNER_LOOKED };
    const line = nowLine({ callsSoFar: 1, latest, nowIso: OWNER_LOOKED, turnClock });
    expect(line.length).toBeLessThanOrEqual(CARD_LINE_CAP);
    expect(line.startsWith("now: still working, 22m · mcp__")).toBe(true);
  });

  it("is dropped on a blocked step, which says what the owner has to do instead", () => {
    const steps = progressChecklistSteps({
      blocked: { detail: "waiting on the owner to sign in" },
      finished: false,
      nowDetail: nowLine({ callsSoFar: 0, latest: undefined, nowIso: OWNER_LOOKED, turnClock }),
      question: "yo",
      timeline: [],
    });
    expect(steps[steps.length - 1]!.children).toEqual(["waiting on the owner to sign in"]);
  });
});

describe("reviewNowLine with a turn clock", () => {
  it("leads the round with the reader's whole wait", () => {
    const record = { round: 1, spawnedAt: "2026-09-19T03:36:00.000Z" };
    expect(reviewNowLine({ nowIso: OWNER_LOOKED, record, turnClock: "still working, 22m" })).toBe(
      "now: still working, 22m · independent review, round 1 · open 9m",
    );
  });
});

describe("activityWindowStart", () => {
  it("counts from the first stage when the turn has declared one", () => {
    expect(
      activityWindowStart({ askTs: ASK_TS, firstStageIso: "2026-09-19T03:30:00.000Z", nowIso: OWNER_LOOKED }),
    ).toBe("2026-09-19T03:30:00.000Z");
  });

  it("counts from the ask itself on a stage-less turn, so an inline ticker reads its session's work", () => {
    expect(activityWindowStart({ askTs: ASK_TS, firstStageIso: undefined, nowIso: OWNER_LOOKED })).toBe(
      "2026-09-19T03:22:02.000Z",
    );
  });

  it("falls back to now only when the ask's timestamp cannot be read", () => {
    expect(activityWindowStart({ askTs: "not-a-ts", firstStageIso: undefined, nowIso: OWNER_LOOKED })).toBe(
      OWNER_LOOKED,
    );
  });
});

describe("turnClockLead", () => {
  const QUIET_AFTER_MS = 15 * 60 * 1000;

  it("says still working while the worker's last call is inside the bound", () => {
    expect(
      turnClockLead({
        askTs: ASK_TS,
        latestIso: "2026-09-19T03:40:00.000Z",
        nowIso: OWNER_LOOKED,
        quietAfterMs: QUIET_AFTER_MS,
      }),
    ).toBe("still working, 22m");
  });

  it("stops claiming work once the worker has been silent past the bound", () => {
    expect(
      turnClockLead({
        askTs: ASK_TS,
        latestIso: "2026-09-19T03:25:00.000Z",
        nowIso: OWNER_LOOKED,
        quietAfterMs: QUIET_AFTER_MS,
      }),
    ).toBe("asked 22m ago, nothing new for 20m");
  });

  it("measures a turn with no visible activity from the ask itself", () => {
    expect(
      turnClockLead({
        askTs: ASK_TS,
        latestIso: undefined,
        nowIso: "2026-09-19T03:30:00.000Z",
        quietAfterMs: QUIET_AFTER_MS,
      }),
    ).toBe("still working, 7m");
    expect(
      turnClockLead({ askTs: ASK_TS, latestIso: undefined, nowIso: OWNER_LOOKED, quietAfterMs: QUIET_AFTER_MS }),
    ).toBe("asked 22m ago, no activity visible");
  });

  it("names no clock for a timestamp it cannot read", () => {
    expect(
      turnClockLead({ askTs: "not-a-ts", latestIso: undefined, nowIso: OWNER_LOOKED, quietAfterMs: QUIET_AFTER_MS }),
    ).toBeUndefined();
  });
});
