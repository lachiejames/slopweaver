/**
 * The menu bar's plan lines: the headline names when the numbers were read, and each plan's line follows the
 * precedence `planUsageTray.ts` states, so an old number is never drawn as a current one.
 */
import { describe, expect, it } from "vitest";

import type { PlanUsageReading, PlanUsageRow } from "../../src/planUsage";
import { PLAN_USAGE_INTERVAL_MS, planUsageTrayLines } from "../../src/planUsageTray";

const ZONE = "UTC";
const NOW_ISO = "2026-11-06T18:30:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

/** A weekly Claude row at 77% resetting on Sunday, its Fable week at 27%. */
function claude({ over = {} }: { over?: Partial<PlanUsageRow> }): PlanUsageRow {
  return {
    alias: "plan-one",
    modelHost: "claude",
    signIn: { kind: "ok" },
    usage: {
      kind: "weekly",
      windows: [
        {
          kind: "measured",
          label: "week",
          observedAtIso: "2026-11-06T18:25:00.000Z",
          resetAtIso: "2026-11-08T03:00:00.000Z",
          usedPercent: 77,
        },
        {
          kind: "measured",
          label: "fable-week",
          observedAtIso: "2026-11-06T18:25:00.000Z",
          resetAtIso: "2026-11-08T03:00:00.000Z",
          usedPercent: 27,
        },
      ],
    },
    ...over,
  };
}

/** The lines for these rows, answered just now. */
function linesFor({ receivedAtMs = NOW_MS, rows }: { receivedAtMs?: number; rows: readonly PlanUsageRow[] }) {
  const reading: PlanUsageReading = { kind: "report", observedAtIso: NOW_ISO, rows };
  return planUsageTrayLines({ nowMs: NOW_MS, state: { kind: "available", reading, receivedAtMs }, timeZone: ZONE });
}

describe("planUsageTrayLines", () => {
  it("heads the menu with the verdict and when it was read, and puts each plan's windows and reset under it", () => {
    expect(linesFor({ rows: [claude({})] })).toEqual({
      headline: "Plans: 1 signed in · read 6:30 pm",
      rows: ["plan-one · week 77%, resets Sun 3:00 am · Fable 27%, resets Sun 3:00 am"],
    });
  });

  it("drops the percentage of a plan that needs a sign-in, and counts it in the headline", () => {
    const signedOut = claude({ over: { signIn: { kind: "needs-sign-in", reason: "the stored login was rejected" } } });

    expect(linesFor({ rows: [signedOut, claude({ over: { alias: "plan-two" } })] })).toEqual({
      headline: "Plans: 1 needs sign-in · read 6:30 pm",
      rows: [
        "plan-one · needs sign-in: the stored login was rejected",
        "plan-two · week 77%, resets Sun 3:00 am · Fable 27%, resets Sun 3:00 am",
      ],
    });
  });

  it("shows a pause ahead of a sign-in, and leaves a paused plan out of the headline's count", () => {
    const paused = claude({
      over: {
        signIn: { kind: "needs-sign-in", reason: "auth.json is absent" },
        usage: { kind: "paused", reason: "the subscription lapsed" },
      },
    });

    expect(linesFor({ rows: [paused] })).toEqual({
      headline: "Plans: 0 signed in · read 6:30 pm",
      rows: ["plan-one · paused: the subscription lapsed"],
    });
  });

  it("says a monthly plan is not measured, a missing window has no reading, and a stale one when it was read", () => {
    const monthly = claude({ over: { alias: "plan-two", usage: { kind: "not-measured", reason: "monthly spend" } } });
    const partial = claude({
      over: {
        signIn: { kind: "unknown", reason: "no probe of this plan is recorded" },
        usage: {
          kind: "weekly",
          windows: [
            {
              kind: "stale",
              label: "week",
              observedAtIso: "2026-11-05T09:00:00.000Z",
              reason: "older than the hour",
              resetAtIso: null,
              usedPercent: 40,
            },
            { kind: "no-reading", label: "fable-week", reason: "absent" },
          ],
        },
      },
    });

    expect(linesFor({ rows: [partial, monthly] })).toEqual({
      headline: "Plans: 1 sign-in unknown · read 6:30 pm",
      rows: [
        "plan-one · week 40% (stale, read Thu 9:00 am) · Fable no reading · sign-in unknown",
        "plan-two · not measured: monthly spend",
      ],
    });
  });

  it("reads a window whose reset passed since the answer as reopened, never as its old percentage", () => {
    const reading: PlanUsageReading = {
      kind: "report",
      observedAtIso: "2026-11-06T12:00:00.000Z",
      rows: [
        claude({
          over: {
            alias: "codex-one",
            modelHost: "codex",
            usage: {
              kind: "weekly",
              windows: [
                {
                  kind: "measured",
                  label: "week",
                  observedAtIso: "2026-11-06T12:00:00.000Z",
                  resetAtIso: "2026-11-06T12:01:00.000Z",
                  usedPercent: 42,
                },
              ],
            },
          },
        }),
      ],
    };
    const at = Date.parse("2026-11-06T12:02:00.000Z");

    const lines = planUsageTrayLines({
      nowMs: at,
      state: { kind: "available", reading, receivedAtMs: Date.parse("2026-11-06T12:00:00.000Z") },
      timeZone: ZONE,
    });

    expect(lines.rows).toEqual(["codex-one · week reset 12:01 pm, no reading since"]);
  });

  it("prints when a window with no recorded reset was read, and calls one older than a week no reading", () => {
    const codexWeek = ({ alias, observedAtIso }: { alias: string; observedAtIso: string }): PlanUsageRow =>
      claude({
        over: {
          alias,
          modelHost: "codex",
          usage: {
            kind: "weekly",
            windows: [{ kind: "measured", label: "week", observedAtIso, resetAtIso: null, usedPercent: 42 }],
          },
        },
      });

    expect(
      linesFor({
        rows: [
          codexWeek({ alias: "codex-one", observedAtIso: "2026-11-05T09:00:00.000Z" }),
          codexWeek({ alias: "codex-two", observedAtIso: "2026-10-30T18:29:59.000Z" }),
        ],
      }).rows,
    ).toEqual(["codex-one · week 42% (read Thu 9:00 am, reset unrecorded)", "codex-two · week no reading"]);
  });

  it("reads a Claude reading that crossed its hour since the answer as stale", () => {
    const lines = planUsageTrayLines({
      nowMs: Date.parse("2026-11-06T19:26:00.000Z"),
      state: {
        kind: "available",
        reading: { kind: "report", observedAtIso: NOW_ISO, rows: [claude({})] },
        receivedAtMs: Date.parse("2026-11-06T19:20:00.000Z"),
      },
      timeZone: ZONE,
    });

    expect(lines.rows).toEqual(["plan-one · week 77% (stale, read 6:25 pm) · Fable 27% (stale, read 6:25 pm)"]);
  });

  it("calls the headline stale once two polls have passed without an answer", () => {
    const lines = linesFor({ receivedAtMs: NOW_MS - 2 * PLAN_USAGE_INTERVAL_MS - 1, rows: [claude({})] });

    expect(lines.headline).toBe("Plans: stale, last read 6:30 pm");
  });

  it("keeps the verdict at exactly two polls", () => {
    const lines = linesFor({ receivedAtMs: NOW_MS - 2 * PLAN_USAGE_INTERVAL_MS, rows: [claude({})] });

    expect(lines.headline).toBe("Plans: 1 signed in · read 6:30 pm");
  });

  it("says when nothing has arrived, nothing is registered, or the console could not answer", () => {
    expect(planUsageTrayLines({ nowMs: NOW_MS, state: { kind: "reading" }, timeZone: ZONE })).toEqual({
      headline: "Plans: reading",
      rows: [],
    });
    expect(
      planUsageTrayLines({
        nowMs: NOW_MS,
        state: { kind: "available", reading: { kind: "none-registered" }, receivedAtMs: NOW_MS },
        timeZone: ZONE,
      }),
    ).toEqual({ headline: "Plans: none registered", rows: [] });
    expect(
      planUsageTrayLines({
        nowMs: NOW_MS,
        state: { kind: "unavailable", reason: "the console did not answer" },
        timeZone: ZONE,
      }),
    ).toEqual({ headline: "Plans: unavailable", rows: ["the console did not answer"] });
  });
});
