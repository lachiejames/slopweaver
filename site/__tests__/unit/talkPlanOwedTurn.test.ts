/*
 * The owed turn a resume or nudge leaves when the voice hands nothing over: armed before
 * the developer message, timed from the moment the session took it, settled by any turn starting, and otherwise
 * started by the console with one `turn/start` whose failure is said. A fake clock and plain injected functions;
 * nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { type OwedTurnWhy, PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import { owedStartFailure } from "../../lib/talkPlanOwedTurn";
import { OWED_TURN_TEXT, RESUME_TURN_TEXT } from "../../lib/talkPlanWords";
import { TRIAGE_SUGGESTION_TURN_TEXT } from "../../lib/triageDueWords";
import { answers, harness, settle, TURN_STARTED, turnStarts } from "./talkPlanOwedTurnFixture";

describe("OwedTurnStarts", () => {
  it("registers its waiter at arm, before the message is taken, and starts nothing until the window passes", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const lease = h.starts.arm({ why: "resume" });
    expect(h.waiters.size).toBe(1);
    lease.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    expect(h.requests).toEqual([]);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(h.requests).toEqual([
      {
        method: "turn/start",
        params: { input: [{ text: RESUME_TURN_TEXT, type: "text" }], threadId: "thread-1" },
        timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
      },
    ]);
    expect(h.log).toEqual(["wrote turn/start", "started resume, telemetry true"]);
    expect(h.waiters.size).toBe(0);
  });

  // A resume asks the voice only to acknowledge the owner, so its turn is asked in words of its
  // own; a nudge and a promise press still owe a hand-off the voice did not make.
  it("asks each reason's turn in its own words: a resume's never claims the voice handed nothing over", async () => {
    const reasons: OwedTurnWhy[] = ["resume", "nudge", "promise"];
    const asked: unknown[] = [];
    for (const why of reasons) {
      const h = harness({ answer: answers(TURN_STARTED) });
      h.starts.arm({ why }).handed();
      h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
      await settle();
      asked.push(h.requests.map((r) => r.params));
    }
    const params = (text: string) => [{ input: [{ text, type: "text" }], threadId: "thread-1" }];
    expect(asked).toEqual([params(RESUME_TURN_TEXT), params(OWED_TURN_TEXT), params(OWED_TURN_TEXT)]);
    expect(RESUME_TURN_TEXT.includes("handed nothing over")).toBe(false);
  });

  // A resume's turn must not carry on with the next item off the Queue and re-pitch the card the owner has open and
  // is reading. Neither unasked turn may send the owner on from an open card.
  it("asks neither console-owned turn to move the owner off the card they have open", () => {
    // An Alignment card resolves beside the Queue's, so the sentence names both pages.
    const stays =
      "A card open on the owner's Queue or Alignment page is where they are: read_page says which. Move on from it only when their words SINCE it opened ruled it, asked for the next one, or said they are done with it, never the words that opened it; never " +
      "introduce it again, and never offer to send it back, park it or move past it.";
    expect([
      RESUME_TURN_TEXT.includes("next real thing off the owner's Queue"),
      RESUME_TURN_TEXT.includes(stays),
      OWED_TURN_TEXT.includes(stays),
      RESUME_TURN_TEXT.includes(
        "When they say they are still reading, answer only what they asked, if anything, and stop.",
      ),
      // Codex review: the owed turn's carry-on is conditioned on the open card, never a bare branch beside the guard.
      OWED_TURN_TEXT.includes("or carry on with the next thing"),
      OWED_TURN_TEXT.includes("only when no open card holds them (below), carry on with the next thing"),
    ]).toEqual([false, true, true, true, false, true]);
  });

  it("times the window from the message being taken, never from the arm", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const lease = h.starts.arm({ why: "nudge" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    lease.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    expect(h.requests).toEqual([]);
  });

  it("starts nothing when the voice's own hand-off starts a turn while the message is written", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const lease = h.starts.arm({ why: "resume" });
    turnStarts({ turnId: "t-1", waiters: h.waiters });
    h.state.running = 1;
    lease.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect(h.log).toEqual([]);
  });

  // A nudge joins the resume's window, the turn starts and ENDS while the nudge is written, and the nudge's taken
  // message must not be dropped with nothing running.
  it("owes afresh when the turn that settled its start has already ended by the time the message is taken", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    const nudge = h.starts.arm({ why: "nudge" });
    turnStarts({ turnId: "t-1", waiters: h.waiters });
    nudge.handed();
    expect(h.waiters.size).toBe(1);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["wrote turn/start", "started nudge, telemetry true"]);
  });

  it("owes nothing more when the turn that settled a joined start is still running as the message is taken", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    const nudge = h.starts.arm({ why: "nudge" });
    turnStarts({ turnId: "t-1", waiters: h.waiters });
    h.state.running = 1;
    nudge.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([[], 0]);
  });

  it("writes one start for a joined message taken while the console's own start's turn runs", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    const nudge = h.starts.arm({ why: "nudge" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    h.state.running = 1;
    nudge.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(h.requests.length).toBe(1);
  });

  // The console's own start's turn runs and ends before the joined nudge is taken.
  it("owes afresh when a joined message is taken after the console's own start's turn has ended", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    const nudge = h.starts.arm({ why: "nudge" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    nudge.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual([
      "wrote turn/start",
      "started resume, telemetry true",
      "wrote turn/start",
      "started nudge, telemetry true",
    ]);
  });

  it("owes nothing more when the call ended under a message taken after its start settled", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const nudge = h.starts.arm({ why: "nudge" });
    turnStarts({ turnId: "t-1", waiters: h.waiters });
    h.state.ended = "stopped";
    nudge.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([[], 0]);
  });

  it("starts nothing when a turn starts inside the window", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "promise" }).handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    turnStarts({ turnId: "t-1", waiters: h.waiters });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([[], 0]);
  });

  it("owes nothing when the message never reached the session, and leaves no waiter behind", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).abandoned();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([[], 0]);
  });

  it("ignores an abandon after a hand, which is how a caller's `finally` releases its lease", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const lease = h.starts.arm({ why: "nudge" });
    lease.handed();
    lease.abandoned();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["wrote turn/start", "started nudge, telemetry true"]);
  });

  it("joins a second arm to the owed start already held: one waiter, one start, the first taken reason", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const first = h.starts.arm({ why: "resume" });
    const second = h.starts.arm({ why: "nudge" });
    expect(h.waiters.size).toBe(1);
    second.handed();
    first.handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["wrote turn/start", "started nudge, telemetry true"]);
  });

  // A nudge taken inside a resume's window asks the voice to hand off, so the one start must not tell the thinking
  // model the voice was asked only to acknowledge the owner.
  it("asks a nudge taken inside a resume's window with the nudge's words, on the resume's deadline", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    h.starts.arm({ why: "nudge" }).handed();
    h.clock.advance({ ms: 1 });
    await settle();
    expect(h.requests.map((r) => r.params)).toEqual([
      { input: [{ text: OWED_TURN_TEXT, type: "text" }], threadId: "thread-1" },
    ]);
    expect(h.log).toEqual(["wrote turn/start", "started nudge, telemetry true"]);
  });

  it("keeps a nudge's start a nudge's when a resume joins its window", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "nudge" }).handed();
    h.starts.arm({ why: "resume" }).handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["wrote turn/start", "started nudge, telemetry true"]);
  });

  it("keeps the owed start when one lease fails and another was taken", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const taken = h.starts.arm({ why: "resume" });
    const lost = h.starts.arm({ why: "nudge" });
    taken.handed();
    lost.abandoned();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["wrote turn/start", "started resume, telemetry true"]);
  });

  // A nudge stopping a written start's running turn arms a start of its own: joined to that written start, it would be
  // owed nothing.
  it("arms afresh once the console's start is written, even while it is unanswered", async () => {
    const h = harness({ answer: () => new Promise(() => undefined) });
    h.starts.arm({ why: "resume" }).handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    expect(h.waiters.size).toBe(0);
    h.starts.arm({ why: "nudge" }).handed();
    expect(h.waiters.size).toBe(1);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual([
      "wrote turn/start",
      "started resume, telemetry true",
      "wrote turn/start",
      "started nudge, telemetry true",
    ]);
  });

  it("settles a fresh arm on the written start's own turn when that turn starts after the arm", () => {
    const h = harness({ answer: () => new Promise(() => undefined) });
    h.starts.arm({ why: "resume" }).handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    h.starts.arm({ why: "resume" }).handed();
    turnStarts({ turnId: "t-9", waiters: h.waiters });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect(h.requests.length).toBe(1);
  });

  it("writes nothing when the call ended inside the window", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    turnStarts({ turnId: undefined, waiters: h.waiters });
    h.state.ended = "the owner hung up";
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    expect(h.log).toEqual([]);
  });

  it("stops: the deadline is cancelled and no waiter is left", () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    h.starts.stop();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([[], 0]);
  });

  it("says why, naming the reason, when the start fails", async () => {
    const reasons: OwedTurnWhy[] = ["resume", "nudge", "promise"];
    const said: string[][] = [];
    for (const why of reasons) {
      const h = harness({ answer: answers({ kind: "error", message: "thread busy" }) });
      h.starts.arm({ why }).handed();
      h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
      await settle();
      said.push(h.log);
    }
    const end = "handed nothing to the thinking model, and the console's own start failed: thread busy";
    expect(said).toEqual([
      [
        "wrote turn/start",
        "started resume, telemetry true",
        "failed: the resume made the answer the thinking model's, and the console's own start failed: thread busy",
      ],
      ["wrote turn/start", "started nudge, telemetry true", `failed: the voice took the owner's nudge and ${end}`],
      [
        "wrote turn/start",
        "started promise, telemetry true",
        `failed: the voice took the page's promise press and ${end}`,
      ],
    ]);
  });

  it("says why when the start could not be written at all", async () => {
    const h = harness({ answer: () => Promise.reject(new Error("pipe closed")) });
    h.starts.arm({ why: "resume" }).handed();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual([
      "wrote turn/start",
      "started resume, telemetry true",
      "failed: the resume made the answer the thinking model's, and the console's own start could not be written: " +
        "pipe closed",
    ]);
  });
});

describe("OwedTurnStarts.handing", () => {
  it("hands the message with the owed start armed, so a taken one opens the window", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    const handing = h.starts.handing({ text: "take your turn", why: "resume" });
    expect(h.waiters.size).toBe(1);
    expect(await handing).toBe(undefined);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["handed take your turn", "wrote turn/start", "started resume, telemetry true"]);
  });

  // The call's provenance keeps why each message was handed, for the thread to repeat.
  it("names why it handed each message, in words the thread can repeat to the owner", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    await h.starts.handing({ text: "take your turn", why: "resume" });
    await h.starts.handing({ text: "you went quiet", why: "nudge" });
    await h.starts.handing({ text: "do what you said", why: "promise" });
    expect(h.whys).toEqual([
      "the owner's words had gone unanswered and the page judged the silence not theirs, so the voice was asked only to " +
        "acknowledge them while the console started the thinking model's turn",
      "the owner pressed nudge because the voice had gone quiet on their last words",
      "the voice promised to do something and started nothing, so the page pressed for it",
    ]);
  });

  it("answers why the session did not take it, and owes nothing", async () => {
    const h = harness({ answer: answers(TURN_STARTED), hand: answers({ kind: "error", message: "no session" }) });
    expect(await h.starts.handing({ text: "take your turn", why: "nudge" })).toBe("no session");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([["handed take your turn"], 0]);
  });

  // A developer message the session took whose answer was lost still leaves something owed.
  it("opens the window on a request that went unanswered, which may still have been taken, and says its fate", async () => {
    const h = harness({ answer: answers(TURN_STARTED), hand: answers({ kind: "timeout" }) });
    expect(await h.starts.handing({ text: "take your turn", why: "resume" })).toBe("no answer in time");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.log).toEqual(["handed take your turn", "wrote turn/start", "started resume, telemetry true"]);
  });

  it("owes nothing once the call ended under the request", async () => {
    const h = harness({ answer: answers(TURN_STARTED), hand: answers({ kind: "ended", reason: "the owner hung up" }) });
    expect(await h.starts.handing({ text: "take your turn", why: "resume" })).toBe("the owner hung up");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([["handed take your turn"], 0]);
  });

  it("lets a throw through, and owes nothing", async () => {
    const h = harness({ answer: answers(TURN_STARTED), hand: () => Promise.reject(new Error("pipe closed")) });
    await expect(h.starts.handing({ text: "take your turn", why: "promise" })).rejects.toThrow("pipe closed");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    expect([h.log, h.waiters.size]).toEqual([["handed take your turn"], 0]);
  });
});

// The voice, asked to hand the triage suggestion off, said "Send it, then." itself.
describe("OwedTurnStarts.handing the triage clock's line", () => {
  it("starts the suggestion's turn the moment the line is taken, with no window, naming why it was handed", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    expect(await h.starts.handing({ text: "time is up", why: "triage" })).toBe(undefined);
    await settle();
    expect(h.requests).toEqual([
      {
        method: "turn/start",
        params: { input: [{ text: TRIAGE_SUGGESTION_TURN_TEXT, type: "text" }], threadId: "thread-1" },
        timeoutMs: PLAN_CALL_LIMITS.nudgeStepMs,
      },
    ]);
    expect(h.log).toEqual(["handed time is up", "wrote turn/start", "started triage, telemetry true"]);
    expect(h.whys).toEqual(["the triage card in front of the owner ran past the clock they asked to be told about"]);
    expect(h.waiters.size).toBe(0);
  });

  it("starts nothing when the voice hands it off while the line is written", async () => {
    const h = harness({
      answer: answers(TURN_STARTED),
      hand: () => {
        turnStarts({ turnId: "t-2", waiters: h.waiters });
        h.state.running = 1;
        return Promise.resolve({ kind: "result", result: {} });
      },
    });
    await h.starts.handing({ text: "time is up", why: "triage" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(h.requests).toEqual([]);
  });

  // The settled lease must not re-arm and start a second suggestion turn.
  it("starts nothing when the voice's own turn starts and ends while the line is written", async () => {
    const h = harness({
      answer: answers(TURN_STARTED),
      hand: () => {
        turnStarts({ turnId: "t-2", waiters: h.waiters });
        h.state.running = 0;
        return Promise.resolve({ kind: "result", result: {} });
      },
    });
    await h.starts.handing({ text: "time is up", why: "triage" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(h.requests).toEqual([]);
    expect(h.log).toEqual(["handed time is up"]);
  });

  it("starts at once inside a resume's window it joined, as the triage suggestion, and once only", async () => {
    const h = harness({ answer: answers(TURN_STARTED) });
    h.starts.arm({ why: "resume" }).handed();
    await h.starts.handing({ text: "time is up", why: "triage" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(h.log).toEqual(["handed time is up", "wrote turn/start", "started triage, telemetry true"]);
  });

  it("owes nothing when the session refused the line", async () => {
    const h = harness({ answer: answers(TURN_STARTED), hand: answers({ kind: "error", message: "no session" }) });
    expect(await h.starts.handing({ text: "time is up", why: "triage" })).toBe("no session");
    await settle();
    expect([h.requests, h.waiters.size]).toEqual([[], 0]);
  });
});

describe("owedStartFailure", () => {
  it("is silent when the thread names the turn it started", () => {
    expect(owedStartFailure({ started: TURN_STARTED })).toBe(undefined);
  });

  it("names each way the start did not come to a turn", () => {
    expect([
      owedStartFailure({ started: { kind: "timeout" } }),
      owedStartFailure({ started: { kind: "ended", reason: "the owner hung up" } }),
      owedStartFailure({ started: { kind: "error", message: "no thread" } }),
      owedStartFailure({ started: { kind: "result", result: {} } }),
    ]).toEqual([
      "the console's own start went unanswered, and may still run",
      "the call ended before the console's own start answered: the owner hung up",
      "the console's own start failed: no thread",
      "the thread took the console's own start and named no turn",
    ]);
  });
});
