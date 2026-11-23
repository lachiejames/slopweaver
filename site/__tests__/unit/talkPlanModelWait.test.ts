/*
 * Which items a plan call's Codex turn has in flight, and how long it waits on the model with none, as the call measures
 * it for the call file's `model-wait` line and the page's step. MEASURED, the incident: three waits of 346s, 326s and
 * 233s ran with no tool running and nothing in the call file said so. Plain maps and sets, a hand-set clock; nothing is
 * mocked.
 */
import { describe, expect, it } from "vitest";

import { type CallTurnItems, itemMoveOf, type TurnItemInput, turnItemMoveOf } from "../../lib/talkPlanModelWait";
import { STALL_MS } from "../../lib/voiceActivityState";

/** Fold a timed script of inputs into fresh turns, returning every move in order. */
function play({ script }: { script: readonly (readonly [number, TurnItemInput])[] }): readonly unknown[] {
  const turns: CallTurnItems = new Map();
  return script.map(([nowMs, input]) => turnItemMoveOf({ input, nowMs, turns }));
}

const REASONING = { kind: "reasoning" } as const;
const TOOL = { kind: "tool", name: "read_card" } as const;
const AWAITING = { kind: "awaiting", reason: "model" } as const;

describe("turnItemMoveOf", () => {
  it("writes a wait from the turn's start to its first item once it reaches the stall horizon, and not a millisecond before", () => {
    const at = (endMs: number) =>
      play({
        script: [
          [1_000, { kind: "turn-started", turnId: "t-1" }],
          [endMs, { itemId: "r-1", kind: "item-started", step: REASONING, turnId: "t-1" }],
        ],
      }).at(-1);
    expect([at(1_000 + STALL_MS - 1), at(1_000 + STALL_MS)]).toEqual([
      { step: REASONING, turnId: "t-1", wait: undefined },
      { step: REASONING, turnId: "t-1", wait: { kind: "model-wait", turnId: "t-1", waitMs: 35_000 } },
    ]);
  });

  // The wait after a 20s tool starts when the tool's item completes, never at the turn's start.
  it("opens the next wait at an item's completion, so the time an item ran is never counted as a wait", () => {
    const moves = play({
      script: [
        [0, { kind: "turn-started", turnId: "t-1" }],
        [2_000, { itemId: "d-1", kind: "item-started", step: TOOL, turnId: "t-1" }],
        [22_000, { itemId: "d-1", kind: "item-completed", turnId: "t-1" }],
        [348_000, { itemId: "r-1", kind: "item-started", step: REASONING, turnId: "t-1" }],
      ],
    });
    expect(moves.slice(2)).toEqual([
      { step: AWAITING, turnId: "t-1", wait: undefined },
      { step: REASONING, turnId: "t-1", wait: { kind: "model-wait", turnId: "t-1", waitMs: 326_000 } },
    ]);
  });

  // Codex review r1: one of two overlapping items ending opened a wait while the other still ran, writing 37s of it.
  it("leaves the turn on the item still in flight when one of two overlapping items ends, and counts no wait under it", () => {
    const moves = play({
      script: [
        [0, { kind: "turn-started", turnId: "t-1" }],
        [1_000, { itemId: "a", kind: "item-started", step: TOOL, turnId: "t-1" }],
        [2_000, { itemId: "b", kind: "item-started", step: REASONING, turnId: "t-1" }],
        [3_000, { itemId: "b", kind: "item-completed", turnId: "t-1" }],
        [40_000, { itemId: "a", kind: "item-completed", turnId: "t-1" }],
        [40_001, { kind: "turn-ended", turnId: "t-1" }],
      ],
    });
    expect(moves.slice(3)).toEqual([
      { step: TOOL, turnId: "t-1", wait: undefined },
      { step: AWAITING, turnId: "t-1", wait: undefined },
      { step: null, turnId: "t-1", wait: undefined },
    ]);
  });

  it("closes a wait the turn's end cuts short, as an interrupted turn's is, and forgets the turn", () => {
    const turns: CallTurnItems = new Map();
    turnItemMoveOf({ input: { kind: "turn-started", turnId: "t-1" }, nowMs: 10_000, turns });
    const closed = turnItemMoveOf({ input: { kind: "turn-ended", turnId: "t-1" }, nowMs: 243_000, turns });
    expect([closed, turns.size]).toEqual([
      { step: null, turnId: "t-1", wait: { kind: "model-wait", turnId: "t-1", waitMs: 233_000 } },
      0,
    ]);
  });

  it("keeps a wait's start through a replayed start or completion, and closes nothing that is not open", () => {
    const moves = play({
      script: [
        [0, { kind: "turn-started", turnId: "t-1" }],
        [30_000, { kind: "turn-started", turnId: "t-1" }],
        [35_000, { itemId: "gone", kind: "item-completed", turnId: "t-1" }],
        [40_000, { itemId: "r-1", kind: "item-started", step: REASONING, turnId: "t-1" }],
        [90_000, { itemId: "r-1", kind: "item-started", step: REASONING, turnId: "t-1" }],
      ],
    });
    expect(moves.slice(2)).toEqual([
      { step: AWAITING, turnId: "t-1", wait: undefined },
      { step: REASONING, turnId: "t-1", wait: { kind: "model-wait", turnId: "t-1", waitMs: 40_000 } },
      { step: REASONING, turnId: "t-1", wait: undefined },
    ]);
  });

  // Codex review r2: an ended item's start and end replayed split one 71s wait into lines of 36s and 35s.
  it("moves nothing for an ended item's start replayed, so one wait stays one line", () => {
    const moves = play({
      script: [
        [0, { kind: "turn-started", turnId: "t-1" }],
        [0, { itemId: "x", kind: "item-started", step: REASONING, turnId: "t-1" }],
        [1, { itemId: "x", kind: "item-completed", turnId: "t-1" }],
        [36_001, { itemId: "x", kind: "item-started", step: REASONING, turnId: "t-1" }],
        [36_002, { itemId: "x", kind: "item-completed", turnId: "t-1" }],
        [71_002, { kind: "turn-ended", turnId: "t-1" }],
      ],
    });
    expect(moves.slice(3)).toEqual([
      { step: null, turnId: "t-1", wait: undefined },
      { step: AWAITING, turnId: "t-1", wait: undefined },
      { step: null, turnId: "t-1", wait: { kind: "model-wait", turnId: "t-1", waitMs: 71_001 } },
    ]);
  });
});

describe("itemMoveOf", () => {
  const params = { threadId: "thread-1", turnId: "t-1" };
  const running = new Set<string>(["t-1"]);

  it("closes a running turn's wait on its own thread's item start and opens the next on that item's completion", () => {
    const turns: CallTurnItems = new Map([["t-1", { ended: new Set<string>(), inFlight: new Map(), openedMs: 0 }]]);
    const shared = { running, threadId: "thread-1", turns };
    const item = { ...params, item: { id: "d-1", tool: "read_card", type: "dynamicToolCall" } };
    const moves = [
      itemMoveOf({ ...shared, method: "item/started", nowMs: 346_000, params: item }),
      itemMoveOf({ ...shared, method: "item/completed", nowMs: 366_000, params: item }),
    ];
    expect([moves, turns.get("t-1")]).toEqual([
      [
        { step: TOOL, turnId: "t-1", wait: { kind: "model-wait", turnId: "t-1", waitMs: 346_000 } },
        { step: AWAITING, turnId: "t-1", wait: undefined },
      ],
      { ended: new Set(["d-1"]), inFlight: new Map(), openedMs: 366_000 },
    ]);
  });

  it("moves no wait for a delta or the owner's own message, and reads nothing of another thread or a turn not running", () => {
    const turns: CallTurnItems = new Map([["t-1", { ended: new Set<string>(), inFlight: new Map(), openedMs: 0 }]]);
    const shared = { nowMs: 100_000, turns };
    const userMessage = { ...params, item: { id: "u-1", type: "userMessage" } };
    const item = { ...params, item: { id: "r-1", type: "reasoning" } };
    const moved = [
      itemMoveOf({ ...shared, method: "item/agentMessage/delta", params, running, threadId: "thread-1" }),
      itemMoveOf({ ...shared, method: "item/started", params: userMessage, running, threadId: "thread-1" }),
      itemMoveOf({ ...shared, method: "item/started", params: item, running, threadId: "thread-9" }),
      itemMoveOf({ ...shared, method: "item/started", params: item, running: new Set(), threadId: "thread-1" }),
    ];
    const still = { step: null, turnId: "t-1", wait: undefined };
    expect([moved, turns.get("t-1")]).toEqual([
      [still, still, undefined, undefined],
      { ended: new Set(), inFlight: new Map(), openedMs: 0 },
    ]);
  });
});
