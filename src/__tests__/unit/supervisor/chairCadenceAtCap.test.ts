/**
 * A chair whose plan is AT the routing bar hands off whatever the tick's route names. A tick's close once read:
 * `plan-two is at 95% of its seven-day week, but the chair's successor routes to plan-two too … not a reason to hand
 * off`, and the owner caught the 96% on their own screen.
 */
import { describe, expect, it } from "vitest";

import { judgeChairCadence } from "../../../supervisor/chairCadence.js";
import { chairCadenceLines } from "../../../supervisor/chairCadenceLines.js";

import { CURRENT, gauge, handOffOf, NOW, session } from "./chairCadenceFixture.js";

const verdictAt = ({ weekPct }: { weekPct: number }) =>
  judgeChairCadence({
    boots: CURRENT,
    gauge: gauge({
      nextChair: "plan-two",
      plans: [
        ["plan-two", weekPct, 44],
        ["plan-five", 22, 0],
      ],
    }),
    newestInstalled: CURRENT,
    nowIso: NOW,
    sessions: [session({ plan: "plan-two", version: "2.1.283" })],
  });

describe("judgeChairCadence at the routing bar", () => {
  it("hands off at 95% of the week even while the route still names the chair's plan, judged at the routing bar", () => {
    expect(verdictAt({ weekPct: 95 })).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [{ alias: "plan-two", kind: "plan-window-near", pct: 95, thresholdPercent: 95, window: "seven-day" }],
      route: { alias: "plan-two", kind: "picks" },
    });
  });

  it("prints the reason as leaving before the wall, never as routing still picking it", () => {
    const lines = chairCadenceLines({
      target: { kind: "claude" },
      verdict: handOffOf({ verdict: verdictAt({ weekPct: 96 }) }),
    });

    expect(lines[1]).toBe("  - plan-two is at 96% of its seven-day week — at or past 95%, so leave it before the wall");
    expect(lines.join("\n")).not.toContain("not a reason to hand off");
  });

  it("never names the at-cap plan the captured route picked as where the successor lands", () => {
    const lines = chairCadenceLines({
      target: { kind: "claude" },
      verdict: handOffOf({ verdict: verdictAt({ weekPct: 96 }) }),
    });

    expect(lines[2]).toBe(
      "  this tick's gauge routed a Fable spawn to plan-two, which is at the routing bar, so that pick is stale — " +
        "the spawn re-reads every plan live and refuses plan-two while it stays there; " +
        "the successor boots the current Claude Code on whatever plan routing picks.",
    );
  });

  it("stays one point under the routing bar, naming that routing still picks the chair's plan", () => {
    expect(verdictAt({ weekPct: 94 })).toStrictEqual({
      kind: "stay",
      notes: [
        "plan-two is at 94% of its seven-day week, but the chair's successor routes to plan-two too, so a successor would land on the same plan — not a reason to hand off until routing moves off it",
      ],
    });
  });
});
