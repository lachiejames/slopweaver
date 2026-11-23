/**
 * The chair's hand-off cadence when every routable plan is past the alert bar: a successor would boot on a plan just
 * as far past it, so the plan's own week is not a reason to hand off, while a reason a fresh boot fixes anywhere
 * still is (`src/supervisor/chairCadence.ts`).
 */
import { describe, expect, it } from "vitest";

import { judgeChairCadence } from "../../../supervisor/chairCadence.js";

import { CURRENT, gauge, NOW, session } from "./chairCadenceFixture.js";

describe("judgeChairCadence with every routable plan past the bar", () => {
  it("keeps the chair seated while every routable plan is past the bar, and still hands off a stale version", () => {
    const saturated = gauge({
      nextChair: "plan-two",
      plans: [
        ["plan-one", 87, 36],
        ["plan-two", 82, 61],
        ["plan-three", 89, 65],
        ["plan-four", 78, 38],
      ],
    });
    const note =
      "plan-three is at 89% of its seven-day week, but the chair's successor routes to plan-two, itself at 82% of its " +
      "seven-day week, so a successor would be just as far past the bar — not a reason to hand off until a plan " +
      "under it is the route or plan-three reaches its spawn bar";
    const stays = judgeChairCadence({
      boots: CURRENT,
      gauge: saturated,
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-three", version: "2.1.283" })],
    });
    expect(stays).toStrictEqual({ kind: "stay", notes: [note] });

    const behind = judgeChairCadence({
      boots: CURRENT,
      gauge: saturated,
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-three", version: "2.1.280" })],
    });
    expect(behind).toStrictEqual({
      kind: "hand-off",
      notes: [note],
      reasons: [{ boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" }],
      route: { alias: "plan-two", kind: "picks" },
    });
  });
});
