/**
 * The chair's hand-off cadence on a ONE-plan install, where the chair may hand off to a successor on its own
 * plan. The budget alone never moves the chair there, because its successor would land
 * on the same plan, and no plan floor refuses the hand-off either.
 */
import { describe, expect, it } from "vitest";

import { judgeChairCadence } from "../../../supervisor/chairCadence.js";

import { CURRENT, gauge, NOW, session } from "./chairCadenceFixture.js";

describe("judgeChairCadence on a one-plan install", () => {
  it("stays for budget alone, naming why, with no plan floor in the way", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 90, 88]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [session({ plan: "plan-one", version: "2.1.283" })],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: [
        "plan-one is at 90% of its seven-day week, but the chair's successor routes to plan-one too, so a successor would land on the same plan — not a reason to hand off until routing moves off it",
        "plan-one is at 88% of its seven-day Fable week, but the chair's successor routes to plan-one too, so a successor would land on the same plan — not a reason to hand off until routing moves off it",
      ],
    });
  });
});
