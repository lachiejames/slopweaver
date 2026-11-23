/**
 * The pure core of thread-reply recovery — hint parsing, reply-row filtering, root registration and
 * checkpoint seeding, and the background-poll planner's budget, two-lane rotation and ordering. Zero I/O.
 */
import { describe, expect, it } from "vitest";

import { planRecoveryThreadChecks } from "../../../../live/listen/recoverThreadPlan.js";
import {
  answerIdentitiesFromMessages,
  type RecoveryThreadCheckpoints,
  type RecoveryThreadHint,
  recoveryReplyRows,
  recoveryRootRegistrations,
  recoveryThreadHints,
  seedThreadCheckpointKeys,
} from "../../../../live/listen/recoverThreads.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../outbound/assistant/answerMessage.js";

describe("recoveryThreadHints", () => {
  it("hints a root carrying a positive reply_count", () => {
    const hints = recoveryThreadHints({
      channel: "C1",
      rawMessages: [{ reply_count: 3, ts: "1785000000.000100" }],
    });
    expect(hints).toEqual([{ channel: "C1", threadTs: "1785000000.000100" }]);
  });

  it("hints a root carrying a well-formed latest_reply, even with reply_count absent", () => {
    const hints = recoveryThreadHints({
      channel: "C1",
      rawMessages: [{ latest_reply: "1785000100.000200", ts: "1785000000.000100" }],
    });
    expect(hints).toEqual([{ channel: "C1", latestReplyTs: "1785000100.000200", threadTs: "1785000000.000100" }]);
  });

  it("never treats a malformed latest_reply as a signal, but still hints on reply_count alone", () => {
    const hints = recoveryThreadHints({
      channel: "C1",
      rawMessages: [{ latest_reply: "not-a-ts", reply_count: 1, ts: "1785000000.000100" }],
    });
    expect(hints).toEqual([{ channel: "C1", threadTs: "1785000000.000100" }]);
  });

  it("skips a row with reply_count 0 and no latest_reply at all", () => {
    expect(recoveryThreadHints({ channel: "C1", rawMessages: [{ reply_count: 0, ts: "1785000000.000100" }] })).toEqual(
      [],
    );
  });

  it("skips a row missing ts entirely", () => {
    expect(recoveryThreadHints({ channel: "C1", rawMessages: [{ reply_count: 3 }] })).toEqual([]);
  });

  it("never treats a broadcast reply masquerading as a root as a hint", () => {
    expect(
      recoveryThreadHints({
        channel: "C1",
        rawMessages: [{ reply_count: 3, subtype: "thread_broadcast", ts: "1785000000.000100" }],
      }),
    ).toEqual([]);
  });

  it("skips a non-record row without throwing", () => {
    expect(recoveryThreadHints({ channel: "C1", rawMessages: ["nope", 42, null] })).toEqual([]);
  });
});

describe("answerIdentitiesFromMessages", () => {
  const askIdentity = {
    channel: "C1",
    messageTs: "1785000000.000100",
    quality: "exact" as const,
    threadTs: "1785000000.000100",
  };

  it("extracts a v2 exact-quality answer identity", () => {
    const identities = answerIdentitiesFromMessages({
      rawMessages: [
        {
          metadata: {
            event_payload: { artifactFingerprint: "fp", askIdentity, renderer: "r" },
            event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
          },
          ts: "1785000100.000200",
        },
      ],
    });
    expect(identities).toEqual([askIdentity]);
  });

  it("finds nothing in a page carrying no assistant-answer metadata", () => {
    expect(answerIdentitiesFromMessages({ rawMessages: [{ text: "hi", ts: "1785000000.000100" }] })).toEqual([]);
  });
});

describe("recoveryReplyRows", () => {
  const THREAD = "1785000000.000100";

  it("keeps rows strictly after afterTs and strictly before beforeTs", () => {
    const rows = recoveryReplyRows({
      afterTs: "1785000000.000100",
      beforeTs: "1785000000.000400",
      rawMessages: [
        { ts: THREAD },
        { ts: "1785000000.000200" },
        { ts: "1785000000.000300" },
        { ts: "1785000000.000400" },
      ],
      threadTs: THREAD,
    });
    expect(rows).toEqual([{ ts: "1785000000.000200" }, { ts: "1785000000.000300" }]);
  });

  it("drops the echoed parent even when it is repeated across pages", () => {
    const rows = recoveryReplyRows({
      afterTs: "0",
      beforeTs: "9999999999.000000",
      rawMessages: [{ ts: THREAD }, { ts: "1785000000.000200" }, { ts: THREAD }],
      threadTs: THREAD,
    });
    expect(rows).toEqual([{ ts: "1785000000.000200" }]);
  });

  it("de-duplicates a repeated reply row by ts", () => {
    const rows = recoveryReplyRows({
      afterTs: "0",
      beforeTs: "9999999999.000000",
      rawMessages: [
        { ts: "1785000000.000200", text: "a" },
        { ts: "1785000000.000200", text: "a" },
      ],
      threadTs: THREAD,
    });
    expect(rows.length).toBe(1);
  });

  it("orders afterTs/beforeTs NUMERICALLY, not lexically, across a digit-count rollover", () => {
    const rows = recoveryReplyRows({
      afterTs: "999999999.000000",
      beforeTs: "9999999999.000000",
      rawMessages: [{ ts: "1000000000.000000" }],
      threadTs: THREAD,
    });
    expect(rows).toEqual([{ ts: "1000000000.000000" }]);
  });

  it("skips a row with no well-formed ts", () => {
    expect(
      recoveryReplyRows({
        afterTs: "0",
        beforeTs: "9999999999.000000",
        rawMessages: [{ text: "no ts" }],
        threadTs: THREAD,
      }),
    ).toEqual([]);
  });
});

describe("seedThreadCheckpointKeys", () => {
  it("seeds a corpus key existing checkpoints do not already have", () => {
    const seeded = seedThreadCheckpointKeys({
      bootstrapCursorTs: "1785000000.000000",
      corpusKeys: ["C1:1785000000.000100"],
      existing: {},
    });
    expect(seeded).toEqual({ "C1:1785000000.000100": { cursorTs: "1785000000.000000" } });
  });

  it("never overwrites an existing checkpoint's own cursor value", () => {
    const seeded = seedThreadCheckpointKeys({
      bootstrapCursorTs: "1785000000.000000",
      corpusKeys: ["C1:1785000000.000100"],
      existing: { "C1:1785000000.000100": { cursorTs: "1786000000.000000" } },
    });
    expect(seeded).toEqual({ "C1:1785000000.000100": { cursorTs: "1786000000.000000" } });
  });
});

describe("recoveryRootRegistrations", () => {
  it("registers a root that advertises NO replies — the case a hint can never see", () => {
    const registrations = recoveryRootRegistrations({
      channel: "C1",
      rawMessages: [{ text: "fresh batch of vulnerability-fix PRs", ts: "1785000000.000100" }],
    });
    expect(registrations).toEqual({ "C1:1785000000.000100": { cursorTs: "1785000000.000100" } });
  });

  it("seeds the cursor at the root's own ts, which no reply can precede", () => {
    const registrations = recoveryRootRegistrations({
      channel: "C1",
      rawMessages: [{ reply_count: 4, ts: "1785000000.000100" }],
    });
    expect(registrations["C1:1785000000.000100"]).toEqual({ cursorTs: "1785000000.000100" });
  });

  it("leaves lastCheckedAtIso absent — nothing polled this thread", () => {
    const registrations = recoveryRootRegistrations({
      channel: "C1",
      rawMessages: [{ ts: "1785000000.000100" }],
    });
    expect(registrations["C1:1785000000.000100"]?.lastCheckedAtIso).toBe(undefined);
  });

  it("never registers a thread_broadcast row — it is a reply wearing a root's clothes", () => {
    const registrations = recoveryRootRegistrations({
      channel: "C1",
      rawMessages: [{ subtype: "thread_broadcast", thread_ts: "1785000000.000100", ts: "1785000500.000200" }],
    });
    expect(registrations).toEqual({});
  });

  it("skips a ts the durable schema would reject rather than writing an unreadable state", () => {
    const registrations = recoveryRootRegistrations({
      channel: "C1",
      rawMessages: [{ ts: "1785000000" }, { ts: "1785000000.0001" }, { ts: "" }, "not-a-record", null],
    });
    expect(registrations).toEqual({});
  });

  it("registers every root in one page, keyed by channel and root ts", () => {
    const registrations = recoveryRootRegistrations({
      channel: "C1",
      rawMessages: [{ ts: "1785000000.000100" }, { ts: "1785000500.000200" }],
    });
    expect(Object.keys(registrations).toSorted()).toEqual(["C1:1785000000.000100", "C1:1785000500.000200"]);
  });

  it("returns nothing for an empty page", () => {
    expect(recoveryRootRegistrations({ channel: "C1", rawMessages: [] })).toEqual({});
  });
});

describe("planRecoveryThreadChecks", () => {
  const NO_CHECKPOINTS: RecoveryThreadCheckpoints = {};
  const NO_FOREGROUND: ReadonlySet<string> = new Set();
  /**
   * The sweep's own exclusive upper bound. Every `1785000000.*` root below sits 100,000s (27.8h) before it,
   * inside `RECENT_ROOT_HORIZON_HOURS`; every `1784300000.*` root sits 800,000s (222h) before it, outside.
   */
  const NOW_TS = "1785100000.000000";

  it("plans a check for a never-checked hint, oldest '0'", () => {
    const hints: readonly RecoveryThreadHint[] = [{ channel: "C1", threadTs: "1785000000.000100" }];
    const plan = planRecoveryThreadChecks({
      checkpoints: NO_CHECKPOINTS,
      foregroundKeys: NO_FOREGROUND,
      hints,
      nowTs: NOW_TS,
    });
    expect(plan.checks).toEqual([{ channel: "C1", oldest: "0", threadTs: "1785000000.000100" }]);
    expect(plan.skippedByLatestReply).toBe(0);
    expect(plan.deferred).toBe(0);
  });

  it("skips a visible root whose latest_reply is not newer than its checkpoint's cursor", () => {
    const hints: readonly RecoveryThreadHint[] = [
      { channel: "C1", latestReplyTs: "1785000100.000000", threadTs: "1785000000.000100" },
    ];
    const checkpoints: RecoveryThreadCheckpoints = { "C1:1785000000.000100": { cursorTs: "1785000100.000000" } };
    const plan = planRecoveryThreadChecks({ checkpoints, foregroundKeys: NO_FOREGROUND, hints, nowTs: NOW_TS });
    expect(plan.checks).toEqual([]);
    expect(plan.skippedByLatestReply).toBe(1);
  });

  it("plans a check for a visible root whose latest_reply is newer than its checkpoint", () => {
    const hints: readonly RecoveryThreadHint[] = [
      { channel: "C1", latestReplyTs: "1785000200.000000", threadTs: "1785000000.000100" },
    ];
    const checkpoints: RecoveryThreadCheckpoints = { "C1:1785000000.000100": { cursorTs: "1785000100.000000" } };
    const plan = planRecoveryThreadChecks({ checkpoints, foregroundKeys: NO_FOREGROUND, hints, nowTs: NOW_TS });
    expect(plan.checks).toEqual([{ channel: "C1", oldest: "1785000100.000000", threadTs: "1785000000.000100" }]);
  });

  it("never skips a visible root with a missing/malformed latest_reply — poll conservatively", () => {
    const hints: readonly RecoveryThreadHint[] = [{ channel: "C1", threadTs: "1785000000.000100" }];
    const checkpoints: RecoveryThreadCheckpoints = { "C1:1785000000.000100": { cursorTs: "1785000100.000000" } };
    const plan = planRecoveryThreadChecks({ checkpoints, foregroundKeys: NO_FOREGROUND, hints, nowTs: NOW_TS });
    expect(plan.checks).toEqual([{ channel: "C1", oldest: "1785000100.000000", threadTs: "1785000000.000100" }]);
    expect(plan.skippedByLatestReply).toBe(0);
  });

  it("never double-processes a thread already covered by the foreground fast path", () => {
    const hints: readonly RecoveryThreadHint[] = [{ channel: "C1", threadTs: "1785000000.000100" }];
    const plan = planRecoveryThreadChecks({
      checkpoints: NO_CHECKPOINTS,
      foregroundKeys: new Set(["C1:1785000000.000100"]),
      hints,
      nowTs: NOW_TS,
    });
    expect(plan.checks).toEqual([]);
    expect(plan.skippedByLatestReply).toBe(0);
    expect(plan.deferred).toBe(0);
  });

  it("polls an old checkpoint whose root has left the current history window", () => {
    const checkpoints: RecoveryThreadCheckpoints = {
      "C1:1785000000.000100": { cursorTs: "1785000100.000000", lastCheckedAtIso: "2026-08-10T00:00:00.000Z" },
    };
    const plan = planRecoveryThreadChecks({
      checkpoints,
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks).toEqual([{ channel: "C1", oldest: "1785000100.000000", threadTs: "1785000000.000100" }]);
  });

  it("orders observed-newer first, never-checked second, then oldest lastCheckedAtIso, then key", () => {
    const hints: readonly RecoveryThreadHint[] = [
      { channel: "C1", latestReplyTs: "1785000900.000000", threadTs: "1785000000.000100" },
    ];
    const checkpoints: RecoveryThreadCheckpoints = {
      "C1:1785000000.000100": { cursorTs: "1785000100.000000" },
      "C2:1785000000.000200": { cursorTs: "1785000100.000000" },
      "C3:1785000000.000300": { cursorTs: "1785000100.000000", lastCheckedAtIso: "2026-08-12T00:00:00.000Z" },
      "C4:1785000000.000400": { cursorTs: "1785000100.000000", lastCheckedAtIso: "2026-08-11T00:00:00.000Z" },
    };
    const plan = planRecoveryThreadChecks({ checkpoints, foregroundKeys: NO_FOREGROUND, hints, nowTs: NOW_TS });
    expect(plan.checks.map((c) => c.threadTs)).toEqual([
      "1785000000.000100",
      "1785000000.000200",
      "1785000000.000400",
      "1785000000.000300",
    ]);
  });

  it("breaks a tie between two equally-due threads by key, deterministically", () => {
    const checkpoints: RecoveryThreadCheckpoints = {
      "C2:1785000000.000200": { cursorTs: "1785000100.000000" },
      "C1:1785000000.000100": { cursorTs: "1785000100.000000" },
    };
    const plan = planRecoveryThreadChecks({
      checkpoints,
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks.map((c) => c.channel)).toEqual(["C1", "C2"]);
  });

  it("plans nothing when no thread is due at all", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: NO_CHECKPOINTS,
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks).toEqual([]);
    expect(plan.deferred).toBe(0);
  });

  it("still polls a due thread on a sweep whose history window returned nothing at all", () => {
    const checkpoints: RecoveryThreadCheckpoints = { "C1:1785000000.000100": { cursorTs: "1785000100.000000" } };
    const plan = planRecoveryThreadChecks({
      checkpoints,
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks).toEqual([{ channel: "C1", oldest: "1785000100.000000", threadTs: "1785000000.000100" }]);
  });

  /**
   * N distinct, already-checked, due checkpoints — a plain mutable record built once, then frozen by type.
   *
   * `rootSeconds` decides which LANE they land in: the default sits inside `RECENT_ROOT_HORIZON_HOURS` of
   * `NOW_TS`, and `1784300000` is 222h before it, outside.
   */
  function manyDueCheckpoints({
    count,
    rootSeconds = 1785000000,
    lastCheckedAtIso = "2026-08-10T00:00:00.000Z",
  }: {
    count: number;
    rootSeconds?: number;
    /** The empty string means NEVER checked — the tier the 16,251 bootstrap seeds sit in. */
    lastCheckedAtIso?: string;
  }): RecoveryThreadCheckpoints {
    const checked = lastCheckedAtIso.length > 0;
    const checkpoints: Record<string, { cursorTs: string; lastCheckedAtIso?: string }> = {};
    for (let i = 0; i < count; i += 1) {
      const entry = { cursorTs: "1785000100.000000" };
      checkpoints[`C1:${String(rootSeconds)}.${String(i).padStart(6, "0")}`] = checked
        ? { ...entry, lastCheckedAtIso }
        : entry;
    }
    return checkpoints;
  }

  it("caps the background budget at 25 however many threads are due", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: manyDueCheckpoints({ count: 40 }),
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks.length).toBe(25);
    expect(plan.deferred).toBe(15);
  });

  it("subtracts the foreground reads this sweep already spent from the cap", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: manyDueCheckpoints({ count: 40 }),
      foregroundKeys: new Set(["Cx:1785000000.999999"]),
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks.length).toBe(24);
    expect(plan.deferred).toBe(16);
  });

  it("reaches an already-checked recent thread behind a never-checked old-root backlog — the starvation regression", () => {
    // The shape that starved this install: 16,251 never-checked pre-24-Aug bootstrap seeds sat ahead of
    // EVERY already-checked thread in one queue, so a thread polled once on the day its root appeared was
    // never polled again, and the tag that landed in it two days later was unreachable.
    const backlog = manyDueCheckpoints({ count: 200, lastCheckedAtIso: "", rootSeconds: 1784300000 });
    const plan = planRecoveryThreadChecks({
      checkpoints: {
        ...backlog,
        "C9:1785000000.000100": { cursorTs: "1785000100.000000", lastCheckedAtIso: "2026-08-10T00:00:00.000Z" },
      },
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks.map((c) => c.channel)).toContain("C9");
  });

  it("gives the recent lane four fifths of the budget when both lanes are oversubscribed", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: {
        ...manyDueCheckpoints({ count: 100, rootSeconds: 1784300000 }),
        ...manyDueCheckpoints({ count: 100, rootSeconds: 1785000000 }),
      },
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    const recent = plan.checks.filter((c) => c.threadTs.startsWith("1785000000"));
    expect(recent.length).toBe(20);
    expect(plan.checks.length).toBe(25);
  });

  it("keeps one read for the old-root lane on a busy sweep, where four fifths would round to everything", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: {
        ...manyDueCheckpoints({ count: 100, rootSeconds: 1784300000 }),
        ...manyDueCheckpoints({ count: 100, rootSeconds: 1785000000 }),
      },
      // 21 of the 25 reads already spent by the foreground fast path leaves a budget of four, and
      // `ceil(4 * 0.8)` is four — the whole of it, which used to hand the recent lane everything.
      foregroundKeys: new Set(
        Array.from({ length: 21 }, (_unused, i) => `C9:1785000000.${String(i).padStart(6, "0")}`),
      ),
      hints: [],
      nowTs: NOW_TS,
    });

    expect(plan.checks.length).toBe(4);
    expect(plan.checks.filter((c) => c.threadTs.startsWith("1784300000")).length).toBe(1);
    expect(plan.checks.filter((c) => c.threadTs.startsWith("1785000000")).length).toBe(3);
  });

  it.each([24, 25, 40])(
    "keeps one read per lane when the foreground spent %i of the 25 — a busy sweep never starves a registered thread",
    (spent) => {
      const plan = planRecoveryThreadChecks({
        checkpoints: {
          ...manyDueCheckpoints({ count: 100, rootSeconds: 1784300000 }),
          ...manyDueCheckpoints({ count: 100, rootSeconds: 1785000000 }),
        },
        foregroundKeys: new Set(
          Array.from({ length: spent }, (_unused, i) => `C9:1785000000.${String(i).padStart(6, "0")}`),
        ),
        hints: [],
        nowTs: NOW_TS,
      });

      expect(plan.checks.length).toBe(2);
      expect(plan.checks.filter((c) => c.threadTs.startsWith("1785000000")).length).toBe(1);
      expect(plan.checks.filter((c) => c.threadTs.startsWith("1784300000")).length).toBe(1);
    },
  );

  it("spills the recent lane's unspent share to the old-root backlog rather than wasting it", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: {
        ...manyDueCheckpoints({ count: 100, rootSeconds: 1784300000 }),
        ...manyDueCheckpoints({ count: 3, rootSeconds: 1785000000 }),
      },
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks.filter((c) => c.threadTs.startsWith("1785000000")).length).toBe(3);
    expect(plan.checks.length).toBe(25);
  });

  it("spills the old-root lane's unspent share to the recent lane rather than wasting it", () => {
    const plan = planRecoveryThreadChecks({
      checkpoints: {
        ...manyDueCheckpoints({ count: 2, rootSeconds: 1784300000 }),
        ...manyDueCheckpoints({ count: 100, rootSeconds: 1785000000 }),
      },
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(plan.checks.filter((c) => c.threadTs.startsWith("1784300000")).length).toBe(2);
    expect(plan.checks.filter((c) => c.threadTs.startsWith("1785000000")).length).toBe(23);
  });

  it("never starves: a due thread reaches the front once older due threads are drained", () => {
    const backlog = manyDueCheckpoints({ count: 30, lastCheckedAtIso: "2026-08-01T00:00:00.000Z" });
    const checkpoints: RecoveryThreadCheckpoints = {
      ...backlog,
      "C9:1785000000.000900": { cursorTs: "1785000100.000000", lastCheckedAtIso: "2026-08-10T00:00:00.000Z" },
    };
    const first = planRecoveryThreadChecks({ checkpoints, foregroundKeys: NO_FOREGROUND, hints: [], nowTs: NOW_TS });
    expect(first.checks.map((c) => c.channel)).not.toContain("C9");
    const advanced: RecoveryThreadCheckpoints = {
      ...manyDueCheckpoints({ count: 30, lastCheckedAtIso: "2026-08-20T00:00:00.000Z" }),
      "C9:1785000000.000900": { cursorTs: "1785000100.000000", lastCheckedAtIso: "2026-08-10T00:00:00.000Z" },
    };
    const second = planRecoveryThreadChecks({
      checkpoints: advanced,
      foregroundKeys: NO_FOREGROUND,
      hints: [],
      nowTs: NOW_TS,
    });
    expect(second.checks[0]?.channel).toBe("C9");
  });
});
