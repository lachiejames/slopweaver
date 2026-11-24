/**
 * The chair-cadence decision table's auto-compaction rows — the trial's boundary, a count that could not be read,
 * and two processes resuming one session id — judged against the same chair as every other family.
 */
import { describe, expect, it } from "vitest";

import type { ChairAutoCompactionReading } from "../../../supervisor/chairAutoCompaction.js";
import { judgeChairCadence } from "../../../supervisor/chairCadence.js";

import { CURRENT, gauge, NOW, session } from "./chairCadenceFixture.js";

describe("judgeChairCadence on auto-compactions", () => {
  it("stays at four auto-compactions and hands off at the fifth — the trial", () => {
    const run = ({ autoCompactions }: { autoCompactions: ChairAutoCompactionReading }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [session({ autoCompactions, plan: "plan-one", version: "2.1.283" })],
      });

    expect(run({ autoCompactions: { autoCompactions: 4, kind: "below-trial" } })).toStrictEqual({
      kind: "stay",
      notes: [],
    });
    expect(run({ autoCompactions: { autoCompactionsAtLeast: 5, kind: "trial-reached" } })).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [{ autoCompactionsAtLeast: 5, kind: "auto-compacted", sessionId: "a0000032", trialCount: 5 }],
      route: { alias: "plan-one", kind: "picks" },
    });
  });

  it("names an unreadable auto-compaction count UNMEASURED and decides nothing on it", () => {
    const verdict = judgeChairCadence({
      boots: CURRENT,
      gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
      newestInstalled: CURRENT,
      nowIso: NOW,
      sessions: [
        session({
          autoCompactions: { kind: "unmeasured", why: "no transcript for this session" },
          plan: "plan-one",
          version: "2.1.283",
        }),
      ],
    });

    expect(verdict).toStrictEqual({
      kind: "stay",
      notes: ["session a0000032: its auto-compactions are UNMEASURED — no transcript for this session"],
    });
  });

  it("judges two processes resuming one session id as one count, one reason and one note", () => {
    const reached = { autoCompactionsAtLeast: 5, kind: "trial-reached" } as const;
    const unread = { kind: "unmeasured", why: "no transcript for this session" } as const;
    const twice = ({ autoCompactions }: { autoCompactions: ChairAutoCompactionReading }) =>
      judgeChairCadence({
        boots: CURRENT,
        gauge: gauge({ nextChair: "plan-one", plans: [["plan-one", 10, 10]] }),
        newestInstalled: CURRENT,
        nowIso: NOW,
        sessions: [
          session({ autoCompactions, plan: "plan-one", version: "2.1.283" }),
          { ...session({ autoCompactions, plan: "plan-one", version: "2.1.283" }), pid: 40000 },
        ],
      });

    expect(twice({ autoCompactions: reached })).toStrictEqual({
      kind: "hand-off",
      notes: [],
      reasons: [{ autoCompactionsAtLeast: 5, kind: "auto-compacted", sessionId: "a0000032", trialCount: 5 }],
      route: { alias: "plan-one", kind: "picks" },
    });
    expect(twice({ autoCompactions: unread })).toStrictEqual({
      kind: "stay",
      notes: ["session a0000032: its auto-compactions are UNMEASURED — no transcript for this session"],
    });
  });
});
