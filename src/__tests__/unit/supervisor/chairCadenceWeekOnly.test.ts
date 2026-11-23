/**
 * A chair whose plan has no complete row — its Fable week unread — still hands off once its all-models week alone
 * is at the routing bar, even when no plan can take a Fable seat. Before this,
 * that chair read STAY because the only reason a rowless plan could raise needed a
 * different measured plan to be the Fable route.
 */
import { describe, expect, it } from "vitest";

import { judgeChairCadence } from "../../../supervisor/chairCadence.js";

import { CURRENT, gauge, NOW, session } from "./chairCadenceFixture.js";

const verdictAt = ({ weekPct }: { weekPct: number }) =>
  judgeChairCadence({
    boots: CURRENT,
    gauge: gauge({ nextChair: null, plans: [["plan-b", 96, 80]], weekOnly: [{ plan: "plan-a", weekPct }] }),
    newestInstalled: CURRENT,
    nowIso: NOW,
    sessions: [session({ plan: "plan-a", version: "2.1.283" })],
  });

describe("judgeChairCadence on a plan with no complete row", () => {
  it("hands off when the all-models week alone is at the routing bar and no plan can take a Fable seat", () => {
    expect(verdictAt({ weekPct: 95 })).toStrictEqual({
      kind: "hand-off",
      notes: ["plan-a's budget is UNMEASURED — it has no complete reading in this tick's gauge"],
      reasons: [{ alias: "plan-a", kind: "plan-window-near", pct: 95, thresholdPercent: 95, window: "seven-day" }],
      route: { kind: "none" },
    });
  });

  it("hands off on a partial gauge where NO plan carried a Fable week", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({
        gap: "no plan in gauge.json yielded a complete reading",
        nextChair: null,
        plans: [],
        weekOnly: [
          { plan: "plan-a", usageLimitPercent: 100, weekPct: 95 },
          { plan: "plan-b", usageLimitPercent: 100, weekPct: 20 },
        ],
      }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-a", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "hand-off",
      notes: [
        "the plan gauge is PARTIAL this tick, so a plan it missed is UNMEASURED — no plan in gauge.json yielded a complete reading",
        "plan-a's budget is UNMEASURED — it has no complete reading in this tick's gauge",
      ],
      reasons: [{ alias: "plan-a", kind: "plan-window-near", pct: 95, thresholdPercent: 95, window: "seven-day" }],
      route: { kind: "unmeasured" },
    });
  });

  it("stays one point under the routing bar, saying the budget is unmeasured", () => {
    expect(verdictAt({ weekPct: 94 })).toStrictEqual({
      kind: "stay",
      notes: ["plan-a's budget is UNMEASURED — it has no complete reading in this tick's gauge"],
    });
  });
});
