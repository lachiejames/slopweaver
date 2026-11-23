/**
 * The chair-cadence rows for a chair whose OWN plan has no complete reading — plan-five,
 * spent to its wall while every tick read it as a stay. A chair on an invisible plan hands off when a different,
 * measured plan is the Fable route, and stays, saying UNMEASURED, when there is nowhere measured to go.
 */
import { describe, expect, it } from "vitest";

import { judgeChairCadence } from "../../../supervisor/chairCadence.js";
import { chairCadenceLines } from "../../../supervisor/chairCadenceLines.js";

import { CURRENT, DEFAULT_CADENCE_THRESHOLDS, gauge, NOW, session } from "./chairCadenceFixture.js";

/** The note every judgement of a chair on unread plan-five carries. */
const UNMEASURED_NOTE = "plan-five's budget is UNMEASURED — it has no complete reading in this tick's gauge";

describe("judgeChairCadence — a chair on a plan with no reading", () => {
  it("hands off an unread chair on a PARTIAL gauge too — a failed probe is what makes the gauge partial", () => {
    // One chair's tick-1: only plan-three and plan-four read, the chair spending unread plan-five, route plan-four.
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: {
        gap: "plan-five was not read: the rate-limit gauge is missing",
        kind: "read",
        nextChair: "plan-four",
        plans: [
          { fablePct: 40, plan: "plan-three", weekPct: 50 },
          { fablePct: 0, plan: "plan-four", weekPct: 20 },
        ],
        thresholds: DEFAULT_CADENCE_THRESHOLDS,
      },
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.283" })],
    });

    expect(verdict.kind).toBe("hand-off");
    expect(verdict).toMatchObject({
      reasons: [{ alias: "plan-five", kind: "plan-unmeasured", routeAlias: "plan-four" }],
      route: { kind: "unmeasured" },
    });
  });

  it("stays, noting UNMEASURED, when the route is nowhere, is the chair's own plan, or has no row itself", () => {
    const stayed = ({
      nextChair,
      plans,
    }: {
      nextChair: string | null;
      plans: readonly (readonly [string, number, number])[];
    }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({ nextChair, plans }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [session({ plan: "plan-five", version: "2.1.283" })],
      });
    const note = { kind: "stay", notes: [UNMEASURED_NOTE] };

    expect(stayed({ nextChair: null, plans: [["plan-one", 99, 99]] })).toStrictEqual(note);
    expect(stayed({ nextChair: "plan-five", plans: [["plan-one", 10, 10]] })).toStrictEqual(note);
    expect(stayed({ nextChair: "plan-two", plans: [["plan-one", 10, 10]] })).toStrictEqual(note);
  });

  it("stays on a wholly UNMEASURED gauge — an outage has no measured plan to leave for", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: { kind: "unmeasured", why: "the gauge refused every plan" },
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-five", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: ["the plan gauge is UNMEASURED this tick — the gauge refused every plan"],
    });
  });
});

describe("chairCadenceLines — the invisible-plan reason", () => {
  it("prints the invisible-plan reason naming the measured route", () => {
    const lines = chairCadenceLines({
      target: { kind: "claude" },
      verdict: {
        kind: "hand-off",
        notes: [],
        reasons: [{ alias: "plan-five", kind: "plan-unmeasured", routeAlias: "plan-four" }],
        route: { kind: "unmeasured" },
      },
    });

    expect(lines[1]!).toBe(
      "  - plan-five has no complete reading this tick while measured plan-four is the next Fable destination — leave the invisible plan rather than discovering its wall from the chair",
    );
  });
});
