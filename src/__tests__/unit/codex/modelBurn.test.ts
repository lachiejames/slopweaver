import { describe, expect, it } from "vitest";

import { burnDaysOf } from "../../../cli/commands/codex/burnRun.js";
import { type BurnReading, type BurnSession, buildModelBurnReport } from "../../../codex/modelBurn.js";
import { renderModelBurn } from "../../../codex/modelBurnRender.js";
import { unwrap } from "../../../lib/result.js";

const WEEK_A = "2026-09-29T13:03:21.000Z";
const WEEK_B = "2026-10-06T13:03:21.000Z";

const reading = (over: Partial<BurnReading> = {}): BurnReading => ({
  observedAtIso: "2026-09-22T10:00:00.000Z",
  planType: "pro",
  resetAtIso: WEEK_A,
  usedPercent: 10,
  window: "weekly",
  ...over,
});

const session = (over: Partial<BurnSession> = {}): BurnSession => ({
  destination: "codex-ambient",
  effort: "medium",
  model: "gpt-6-astra",
  origin: "pass",
  readings: [],
  sessionId: "s1",
  ...over,
});

describe("buildModelBurnReport", () => {
  it("credits no rise to a reading taken after its own window had reset", () => {
    const closed = "2026-09-22T11:00:00.000Z";
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ resetAtIso: closed, usedPercent: 50 }),
            reading({ observedAtIso: "2026-09-22T12:00:00.000Z", resetAtIso: closed, usedPercent: 80 }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(0);
  });

  it("treats the first reading as a baseline and credits a later rise to the session that closed it", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({ readings: [reading({ usedPercent: 40 })], sessionId: "a" }),
        session({
          readings: [reading({ observedAtIso: "2026-09-22T11:00:00.000Z", usedPercent: 60 })],
          sessionId: "b",
        }),
      ],
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.weeklyDrawn).toBe(20);
    expect(report.rows[0]!.sessions).toBe(2);
    expect(report.rows[0]!.sessionsPerWeek).toBe(10);
    expect(report.readings).toBe(2);
  });

  it("credits a reading in a new window with its own percentage, and a fall with nothing", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ usedPercent: 90 }),
            reading({ observedAtIso: "2026-09-22T11:00:00.000Z", usedPercent: 85 }),
            reading({ observedAtIso: "2026-09-30T11:00:00.000Z", resetAtIso: WEEK_B, usedPercent: 7 }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(7);
  });

  it("measures from the high-water mark, so a stale report that dips and recovers is never drawn twice", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ observedAtIso: "2026-09-22T10:00:00.000Z", usedPercent: 50 }),
            reading({ observedAtIso: "2026-09-22T10:10:00.000Z", usedPercent: 55 }),
            reading({ observedAtIso: "2026-09-22T10:20:00.000Z", usedPercent: 53 }),
            reading({ observedAtIso: "2026-09-22T10:30:00.000Z", usedPercent: 56 }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(6);
  });

  it("keeps two interleaved windows on one home apart, so switching between them is never read as a reset", () => {
    const other = "2026-09-29T19:48:21.000Z";
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ observedAtIso: "2026-09-22T10:00:00.000Z", usedPercent: 50 }),
            reading({ observedAtIso: "2026-09-22T10:30:00.000Z", resetAtIso: other, usedPercent: 20 }),
            reading({ observedAtIso: "2026-09-22T11:00:00.000Z", usedPercent: 52 }),
            reading({ observedAtIso: "2026-09-22T11:30:00.000Z", resetAtIso: other, usedPercent: 23 }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(5);
  });

  it("never lets an unrelated expired window turn another account's pre-scan usage into a draw", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({
              observedAtIso: "2026-09-22T10:00:00.000Z",
              resetAtIso: "2026-09-22T11:00:00.000Z",
              usedPercent: 50,
            }),
            reading({
              observedAtIso: "2026-09-22T12:00:00.000Z",
              resetAtIso: "2026-09-29T08:00:00.000Z",
              usedPercent: 80,
            }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(0);
  });

  it("refuses a window whose claimed opening lies after the reading that reports it", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ observedAtIso: "2026-09-22T10:00:00.000Z", usedPercent: 50 }),
            reading({
              observedAtIso: "2026-09-22T12:00:00.000Z",
              resetAtIso: "2026-09-29T19:48:00.000Z",
              usedPercent: 80,
            }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(0);
  });

  it("never pairs two readings that name no window, so interleaved accounts cannot fabricate a rise", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({ readings: [reading({ resetAtIso: undefined, usedPercent: 20 })], sessionId: "a" }),
        session({
          readings: [reading({ observedAtIso: "2026-09-22T11:00:00.000Z", resetAtIso: undefined, usedPercent: 80 })],
          sessionId: "b",
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBeUndefined();
    expect(report.rows[0]!.sessionsPerWeek).toBeUndefined();
  });

  it("keeps two accounts' windows a minute apart separate, and one window's second of jitter together", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({
              observedAtIso: "2026-09-22T10:00:00.000Z",
              resetAtIso: "2026-09-29T10:00:00.000Z",
              usedPercent: 20,
            }),
            reading({
              observedAtIso: "2026-09-22T10:01:00.000Z",
              resetAtIso: "2026-09-29T09:59:00.000Z",
              usedPercent: 80,
            }),
            reading({
              observedAtIso: "2026-09-22T10:02:00.000Z",
              resetAtIso: "2026-09-29T10:00:29.000Z",
              usedPercent: 23,
            }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(3);
  });

  it("keeps one window together when Codex names its plan two ways", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ planType: "unknown", usedPercent: 20 }),
            reading({
              observedAtIso: "2026-09-22T11:00:00.000Z",
              planType: "self_serve_business_prolite",
              usedPercent: 26,
            }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(6);
  });

  it("keeps two homes' different accounts apart, so one account's baseline is never another's rise", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({ readings: [reading({ usedPercent: 5 })], sessionId: "a" }),
        session({
          destination: "codex-three",
          readings: [
            reading({
              observedAtIso: "2026-09-22T11:00:00.000Z",
              resetAtIso: "2026-09-29T19:48:21.000Z",
              usedPercent: 80,
            }),
          ],
          sessionId: "b",
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(0);
    expect(report.rows[0]!.sessionsPerWeek).toBeUndefined();
    expect(report.rows[0]!.destinations).toEqual(["codex-ambient", "codex-three"]);
  });

  it("draws one account's rise once when two homes are signed into it", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({ readings: [reading({ usedPercent: 10 })], sessionId: "a1" }),
        session({
          destination: "codex-three",
          readings: [reading({ observedAtIso: "2026-09-22T10:10:00.000Z", usedPercent: 10 })],
          sessionId: "b1",
        }),
        session({
          readings: [reading({ observedAtIso: "2026-09-22T11:00:00.000Z", usedPercent: 60 })],
          sessionId: "a2",
        }),
        session({
          destination: "codex-three",
          readings: [reading({ observedAtIso: "2026-09-22T11:10:00.000Z", usedPercent: 60 })],
          sessionId: "b2",
        }),
      ],
    });
    expect(report.rows[0]!.weeklyDrawn).toBe(50);
  });

  it("groups by model, effort and plan type, busiest first", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({ effort: "xhigh", model: "gpt-5.6-sol", readings: [reading({ planType: "plus" })], sessionId: "a" }),
        session({ sessionId: "b" }),
        session({ origin: "seat", sessionId: "c" }),
      ],
    });
    expect(
      report.rows.map((row) => [row.model, row.effort, row.planType, row.sessions, row.passes, row.seats]),
    ).toEqual([
      ["gpt-6-astra", "medium", "unread", 2, 1, 1],
      ["gpt-5.6-sol", "xhigh", "plus", 1, 1, 0],
    ]);
  });

  it("counts a session with no model as unattributed rather than folding it into a row", () => {
    const report = buildModelBurnReport({ sessions: [session({ model: undefined })] });
    expect(report.rows).toEqual([]);
    expect(report.unattributedSessions).toBe(1);
  });

  it("measures the five-hour window on its own timeline", () => {
    const report = buildModelBurnReport({
      sessions: [
        session({
          readings: [
            reading({ resetAtIso: "2026-09-22T14:00:00.000Z", usedPercent: 10, window: "five-hour" }),
            reading({
              observedAtIso: "2026-09-22T11:00:00.000Z",
              resetAtIso: "2026-09-22T14:00:00.000Z",
              usedPercent: 35,
              window: "five-hour",
            }),
          ],
        }),
      ],
    });
    expect(report.rows[0]!.fiveHourDrawn).toBe(25);
    expect(report.rows[0]!.sessionsPerFiveHours).toBe(4);
    expect(report.rows[0]!.weeklyDrawn).toBeUndefined();
  });
});

describe("renderModelBurn", () => {
  it("prints a window the group never read as not read, and an undrawn rate as a dash, never zero", () => {
    const report = buildModelBurnReport({ sessions: [session({ readings: [reading()] })] });
    const lines = renderModelBurn({ days: 21, destinations: ["codex-ambient"], filesRead: 1, report });
    expect(lines[0]).toBe(
      "codex burn: 1 session(s) on codex-ambient, files modified within 21 day(s) of each home's newest, 1 reading(s)",
    );
    expect(lines[1]).toBe(
      "  gpt-6-astra · effort medium · plan pro: 1 session(s) (1 pass / 0 seat) · week 0% drawn → — per week · " +
        "5h not read → — per 5h · 2026-09-22 → 2026-09-22 on codex-ambient",
    );
  });

  it("says so when no session carried a model", () => {
    const report = buildModelBurnReport({ sessions: [session({ model: undefined })] });
    const lines = renderModelBurn({ days: 3, destinations: ["codex-three"], filesRead: 1, report });
    expect(lines[1]).toBe("  no session carried a model");
    expect(lines[2]).toBe("  unattributed: 1 session(s) carried no turn_context model");
  });
});

describe("burnDaysOf", () => {
  it("defaults to three weeks when --days is absent", () => {
    expect(unwrap(burnDaysOf({ values: {} }))).toBe(21);
  });

  it("accepts a positive whole number", () => {
    expect(unwrap(burnDaysOf({ values: { days: "7" } }))).toBe(7);
  });

  it("refuses zero and a fraction by name", () => {
    expect(burnDaysOf({ values: { days: "0" } })._unsafeUnwrapErr()).toEqual([
      "--days must be a positive whole number",
    ]);
    expect(burnDaysOf({ values: { days: "1.5" } })._unsafeUnwrapErr()).toEqual([
      "--days must be a positive whole number",
    ]);
  });
});
