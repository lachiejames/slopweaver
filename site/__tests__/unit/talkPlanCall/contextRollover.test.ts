/**
 * `PlanCall` rolling a nearly full thread over before Codex compacts it: the calm ask at the context share, and the
 * urgent one past the urgent share. The age rollover is `turns.test.ts`'s.
 */

import { describe, expect, it } from "vitest";
import {
  CONTEXT_ROLLOVER_REASON,
  contextRolloverDue,
  contextRolloverUrgent,
  PLAN_CALL_LIMITS,
} from "../../../lib/planCallContract";
import { eventsOf, listening, NUDGES, turnLine } from "./harness";
import { TURN_USAGE, usageAt, usageLine } from "./usage";

/** The context rollover event while the lifetime's cut is far, as the page's stream carries it. */
const CONTEXT_CALM = {
  contextUrgent: false,
  kind: "rollover",
  lifetimeRemainingMs: null,
  reason: CONTEXT_ROLLOVER_REASON,
};
/** The same ask once the thread passed the urgent share. */
const CONTEXT_URGENT = { ...CONTEXT_CALM, contextUrgent: true };
/** The thread's last request filled to the urgent share of {@link TURN_USAGE}'s window. */
const URGENT_USAGE = usageAt({
  inputTokens: Math.ceil(TURN_USAGE.modelContextWindow * PLAN_CALL_LIMITS.rolloverContextUrgentShare),
});

describe("context rollover", () => {
  // Measured: the thread compacted for 118s inside "What is the reply?", 38s before the age rollover.
  it("rolls over at the next free floor once the thread's context nears full, whatever the call's age", async () => {
    const h = await listening({ script: NUDGES });
    const under = Math.ceil(TURN_USAGE.modelContextWindow * PLAN_CALL_LIMITS.rolloverContextShare) - 1;
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({
      chunk: usageLine({ threadId: "thread-1", tokenUsage: usageAt({ inputTokens: under }), turnId: "t-1" }),
    });
    const full = usageAt({ inputTokens: under + 1 });
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: full, turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs * 8 });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([]);
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverQuietMs });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([CONTEXT_CALM]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([CONTEXT_CALM]);
    expect(h.call.ended).toBe(false);
  });

  // Measured: a calm ask was held for nine minutes past 85%, until Codex compacted the thread inside the owner's question.
  it("asks again at once, context-urgent, however busy the floor, once the thread passes the urgent share", async () => {
    const h = await listening({ script: NUDGES });
    const due = usageAt({
      inputTokens: Math.ceil(TURN_USAGE.modelContextWindow * PLAN_CALL_LIMITS.rolloverContextShare),
    });
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: due, turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: URGENT_USAGE, turnId: "t-2" }) });
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: URGENT_USAGE, turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs * 8 });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([
      CONTEXT_CALM,
      CONTEXT_URGENT,
    ]);
  });

  it("asks context-urgent at once on a thread that jumps past the urgent share, never calm first", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: URGENT_USAGE, turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([CONTEXT_URGENT]);
  });

  it("never judges a thread full that reports no context window", () => {
    expect(contextRolloverDue({ contextWindow: null, inputTokens: 1_000_000 })).toBe(false);
    expect(contextRolloverDue({ contextWindow: 258_400, inputTokens: 219_639 })).toBe(false);
    expect(contextRolloverDue({ contextWindow: 258_400, inputTokens: 219_640 })).toBe(true);
  });

  it("judges a thread's context urgent from 88% of the window it reports, and never one that reports none", () => {
    expect([
      contextRolloverUrgent({ contextWindow: null, inputTokens: 1_000_000 }),
      contextRolloverUrgent({ contextWindow: 0, inputTokens: 1_000_000 }),
      contextRolloverUrgent({ contextWindow: 258_400, inputTokens: 227_391 }),
      contextRolloverUrgent({ contextWindow: 258_400, inputTokens: 227_392 }),
    ]).toEqual([false, false, false, true]);
  });
});
