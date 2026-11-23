/**
 * A chair on a plan the owner limited below the routing bar hands off at that limit, because routing refuses a
 * Fable seat there too. A plan limited to 50% at 50% of its
 * week read STAY, since 50 is under both the 75% alert bar and the 95% routing bar.
 */
import { describe, expect, it } from "vitest";

import { judgeChairCadence } from "../../../supervisor/chairCadence.js";

import { CURRENT, gauge, NOW, session } from "./chairCadenceFixture.js";

const rowVerdictAt = ({ weekPct }: { weekPct: number }) =>
  judgeChairCadence({
    boots: CURRENT,
    gauge: gauge({ nextChair: "plan-a", plans: [["plan-a", weekPct, 0]], usageLimits: { "plan-a": 50 } }),
    newestInstalled: CURRENT,
    nowIso: NOW,
    sessions: [session({ plan: "plan-a", version: "2.1.283" })],
  });

const weekOnlyVerdictAt = ({ weekPct }: { weekPct: number }) =>
  judgeChairCadence({
    boots: CURRENT,
    gauge: gauge({ nextChair: null, plans: [], weekOnly: [{ plan: "plan-a", usageLimitPercent: 50, weekPct }] }),
    newestInstalled: CURRENT,
    nowIso: NOW,
    sessions: [session({ plan: "plan-a", version: "2.1.283" })],
  });

describe("judgeChairCadence on a plan with a usage limit under the routing bar", () => {
  it("hands off at the 50% limit while routing still names the chair's plan, judged at that limit", () => {
    expect(rowVerdictAt({ weekPct: 50 })).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [{ alias: "plan-a", kind: "plan-window-near", pct: 50, thresholdPercent: 50, window: "seven-day" }],
      route: { alias: "plan-a", kind: "picks" },
    });
  });

  it("stays one point under the limit, where neither bar is reached", () => {
    expect(rowVerdictAt({ weekPct: 49 })).toStrictEqual({ kind: "stay", notes: [] });
  });

  it("hands off at the limit on a plan whose Fable week was unread", () => {
    expect(weekOnlyVerdictAt({ weekPct: 50 })).toStrictEqual({
      kind: "hand-off",
      notes: ["plan-a's budget is UNMEASURED — it has no complete reading in this tick's gauge"],
      reasons: [{ alias: "plan-a", kind: "plan-window-near", pct: 50, thresholdPercent: 50, window: "seven-day" }],
      route: { kind: "none" },
    });
  });
});
