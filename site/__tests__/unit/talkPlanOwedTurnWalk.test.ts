/*
 * The owed start the owner's own next-card ask opens: no developer message, the same window as a
 * nudge's, settled by any turn starting, otherwise one `turn/start` asking WALK_TURN_TEXT; it outranks a resume's,
 * nudge's or promise's reason in a shared window, keeping the first deadline; and a start that finds a turn running
 * writes nothing. A fake clock and plain injected functions; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { type OwedTurnWhy, PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import type { RpcOutcome } from "../../lib/talkPlanProtocol";
import { WALK_TURN_TEXT } from "../../lib/talkPlanWords";
import { answers, harness, settle, TURN_STARTED, turnStarts } from "./talkPlanOwedTurnFixture";

/** The one `turn/start` a walk window writes once it passes. */
const WALK_START = {
  method: "turn/start",
  params: { input: [{ text: WALK_TURN_TEXT, type: "text" }], threadId: "thread-1" },
  timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
};

describe("OwedTurnStarts.startWindow — the owner's next-card ask", () => {
  it("hands the voice nothing, and starts the walk turn itself once the window passes with no turn", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.startWindow({ why: "walk" });
    expect(h.waiters.size).toBe(1);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    expect(h.requests).toEqual([]);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
    expect(h.whys).toEqual([]);
    expect(h.log).toEqual(["wrote turn/start", "started walk, telemetry true"]);
    // The written start waits on its turn's own start, so a replayed ask before it writes nothing (Codex
    // r3-card-next-witness-q); that start clears it.
    expect(h.waiters.size).toBe(1);
    turnStarts({ turnId: "t-9", waiters: h.waiters });
    expect(h.waiters.size).toBe(0);
  });

  it("is settled by the voice's own late hand-off inside the window, writing nothing", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.startWindow({ why: "walk" });
    h.clock.advance({ ms: 1_000 });
    turnStarts({ turnId: "t-voice", waiters: h.waiters });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.requests).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it("writes nothing when a turn is running at the deadline, though no start reached the waiter", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.startWindow({ why: "walk" });
    h.state.running = 1;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.requests).toEqual([]);
    expect(h.waiters.size).toBe(0);
  });

  // An end read between two asks answers the first, never the second.
  it("writes nothing for an end after the owner's only ask, but starts for a second ask after that end", async () => {
    const answered = harness({ answer: answers(TURN_STARTED) });
    answered.starts.startWindow({ why: "walk" });
    answered.state.turnsEnded = 1;
    answered.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(answered.requests).toEqual([]);
    const asked = harness({ answer: answers(TURN_STARTED) });
    asked.starts.startWindow({ why: "walk" });
    asked.state.turnsEnded = 1;
    asked.starts.startWindow({ why: "walk" });
    asked.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(asked.requests).toEqual([WALK_START]);
  });

  // An ask whose deadline passes while a written start stands is not lost when that write then comes to no turn.
  it("retries an ask that rode on a standing write once that write comes to no turn, and only then", async () => {
    let answerFirst: (outcome: RpcOutcome) => void = () => undefined;
    const first = new Promise<RpcOutcome>((resolve) => {
      answerFirst = resolve;
    });
    const outcomes = [first, Promise.resolve(TURN_STARTED)];
    const h = harness({ answer: () => outcomes.shift()! });
    h.starts.startWindow({ why: "walk" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
    h.clock.advance({ ms: 500 });
    h.starts.startWindow({ why: "walk" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
    answerFirst({ kind: "result", result: {} });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.requests).toEqual([WALK_START, WALK_START]);
  });

  it("does not retry when the failed write carried no later ask", async () => {
    const h = harness({ answer: answers({ kind: "result", result: {} }) });
    h.starts.startWindow({ why: "walk" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 3 });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
  });

  it("outranks a resume, nudge or promise in a shared window whichever came first, and keeps the first deadline", async () => {
    const others: OwedTurnWhy[] = ["resume", "nudge", "promise"];
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      for (const walkFirst of [true, false]) {
        const h = harness({ answer: answers(TURN_STARTED) });
        if (walkFirst) {
          h.starts.startWindow({ why: "walk" });
          h.clock.advance({ ms: 1_000 });
          h.starts.arm({ why: other }).handed();
        } else {
          h.starts.arm({ why: other }).handed();
          h.clock.advance({ ms: 1_000 });
          h.starts.startWindow({ why: "walk" });
        }
        h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1_000 });
        await settle();
        expect({ other, requests: h.requests, walkFirst }).toEqual({ other, requests: [WALK_START], walkFirst });
      }
    }
  });

  // A triage line taken inside the owner's walk window starts the walk, never the triage suggestion.
  it("starts at once as the walk, once only, when a triage line joins its window", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.startWindow({ why: "walk" });
    h.clock.advance({ ms: 1_000 });
    await h.starts.handing({ text: "time is up", why: "triage" });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(h.requests).toEqual([WALK_START]);
  });

  it("says a failed walk start as its own sentence", async () => {
    const h = harness({ answer: answers({ kind: "timeout" }) });
    h.starts.startWindow({ why: "walk" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual([
      "wrote turn/start",
      "started walk, telemetry true",
      "failed: the owner's ask for the next card reached no thinking-model turn, and the console's own start went unanswered, and may still run",
    ]);
  });
});
