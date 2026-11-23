/**
 * `PlanCall.nudge`, and the progress cues it speaks while a turn runs.
 */

import { describe, expect, it } from "vitest";
import { PLAN_CALL_LIMITS, type SequencedEvent } from "../../../lib/planCallContract";
import {
  NUDGE_OWED_TEXT,
  NUDGE_STOPPED_TEXT,
  NUDGE_TEXT,
  PROMISE_OWED_TEXT,
  SCRIPTED_SPEECH,
} from "../../../lib/talkPlanWords";
import {
  COMPOSITION,
  cuesOf,
  eventsOf,
  failure,
  harness,
  heardDoneLine,
  heardLine,
  itemLine,
  listening,
  NOTE_ANSWER,
  NOTE_ANSWER_LINE,
  NUDGES,
  opened,
  SDP_LINE,
  settle,
  spokenAfter,
  TOOL_REQUEST,
  transcriptLine,
  turnLine,
} from "./harness";

/** The developer message a nudge writes, under its RPC id. */
const nudgeRequest = ({ id, text }: { id: number; text: string }) => ({
  id,
  method: "thread/realtime/appendText",
  params: { role: "developer", text, threadId: "thread-1" },
});

// A nudge press never draws one canned line. Measured: the nudge said "I lost the thread there. What were you asking?"
// every press, a toy that makes a single sound each time. Every turn the voice is handed ends on the open card
// first, so a nudge or a promise press is never the owner's word on it, and that close outranks a promise's "before
// anything else" too.
const NEXT_CLOSE =
  "Above everything in this message: while a card open on the owner's Queue or Alignment page holds them, because their words " +
  "since it opened have not ruled it, asked for the next one or said they are done with it, nothing you say or hand " +
  "over opens, names or moves them to another card or item, a promise of yours included: keep only what stays on " +
  "that card, then stop there. Otherwise hand the next thing to the thinking " +
  "model and say only what it hands back: never name, describe or ask about a card or item from your own memory.";

describe("PlanCall.nudge", () => {
  it("hands the voice the owner's unanswered words to answer FIRST, then stops the Codex turn still running", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({ interrupted: ["t-1"], kind: "sent", notInterrupted: [] });
    expect(h.written.slice(before)).toEqual([
      nudgeRequest({ id: 5, text: NUDGE_STOPPED_TEXT }),
      { id: 6, method: "turn/interrupt", params: { threadId: "thread-1", turnId: "t-1" } },
    ]);
    expect(NUDGE_STOPPED_TEXT).toBe(
      "The owner pressed the nudge: the thinking model went quiet on their last words, and its turn is being stopped. Take " +
        "your turn now: say in one sentence that it is being stopped, then answer what they last said, or hand it to the " +
        "thinking model afresh; it is already in this conversation, so never ask them to repeat it. Never hand the " +
        "floor back to the owner: no 'go ahead', 'keep going', 'I'm here' or 'I'm listening'. " +
        NEXT_CLOSE,
    );
  });

  it("has the voice answer the owner's last words, speaking no fixed line, when no Codex turn is running", async () => {
    const h = await opened({ script: NUDGES });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({ interrupted: [], kind: "sent", notInterrupted: [] });
    expect(h.written.slice(before)).toEqual([nudgeRequest({ id: 5, text: NUDGE_TEXT })]);
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(NUDGE_TEXT).toBe(
      "The owner pressed the nudge: their last words have gone unanswered. Take your turn now and answer what they last said; " +
        "it is already in this conversation, so never ask them to repeat it. If it was a steer, act on it. Never hand " +
        "the floor back to the owner: no 'go ahead', 'keep going', 'I'm here' or 'I'm listening'. " +
        NEXT_CLOSE,
    );
  });

  // A voice that said something and stopped leaves the owner waiting for what comes next, so the nudge names the turn
  // as the voice's own.
  it("tells the voice the turn is its own when it was transcribed after the owner's last words", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.clock.advance({ ms: 2_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 20_000 });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({ interrupted: [], kind: "sent", notInterrupted: [] });
    expect(h.written.slice(before)).toEqual([nudgeRequest({ id: 5, text: NUDGE_OWED_TEXT })]);
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(NUDGE_OWED_TEXT).toBe(
      "The owner pressed the nudge: you spoke after their last words and gave them nothing to answer, so the next turn is " +
        "yours. Take it now: carry on from what they last said; it is already in this conversation" +
        ", so never ask them to repeat it. If they have spoken since your last words, answer that first. " +
        "If you said you would do something for them and it has not come back, hand it to the thinking model afresh " +
        "before anything else. Never hand the floor back to the owner: no 'go ahead', 'keep " +
        "going', 'I'm here' or 'I'm listening'. " +
        NEXT_CLOSE,
    );
  });

  it("has the voice answer the owner's words, not carry on, when they were transcribed after the voice", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 2_000 });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.clock.advance({ ms: 20_000 });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({ interrupted: [], kind: "sent", notInterrupted: [] });
    expect(h.written.slice(before)).toEqual([nudgeRequest({ id: 5, text: NUDGE_TEXT })]);
  });

  // The voice may answer the nudge by handing the owner's words to a fresh Codex turn: that is the nudge working.
  it("stops only the turns running at the press, never one the voice starts in answer to it", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    const nudged = h.call.nudge({ promised: false });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    expect(await nudged).toEqual({ interrupted: ["t-1"], kind: "sent", notInterrupted: [] });
    expect(h.written.slice(before).filter((message) => message["method"] === "turn/interrupt")).toEqual([
      { id: 6, method: "turn/interrupt", params: { threadId: "thread-1", turnId: "t-1" } },
    ]);
  });

  it("stops nothing when the voice would not take the message, so an interrupt is never left unfollowed", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendText": failure("no session") } });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({
      kind: "failed",
      reason: "the voice was not asked to answer: no session",
    });
    expect(h.written.slice(before)).toEqual([nudgeRequest({ id: 5, text: NUDGE_STOPPED_TEXT })]);
  });

  it("names a turn the interrupt did not stop", async () => {
    const h = await opened({ script: { ...NUDGES, "turn/interrupt": failure("no such turn") } });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    expect(await h.call.nudge({ promised: false })).toEqual({ interrupted: [], kind: "sent", notInterrupted: ["t-1"] });
  });

  it("refuses, writing nothing, while a tool call waits on the page", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: TOOL_REQUEST });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({
      kind: "refused",
      reason: "a tool call is still running; stopping Codex now could hide what it did",
    });
    expect(h.written.length).toBe(before);
  });

  it("refuses just after a turn ended, and again just after a nudge, until each window passes", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    expect(await h.call.nudge({ promised: false })).toEqual({
      kind: "refused",
      reason: "Codex just finished, and the voice is about to answer",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeSettleMs });
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
    expect(await h.call.nudge({ promised: false })).toEqual({ kind: "refused", reason: "it was nudged a moment ago" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeGapMs });
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: NUDGES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.nudge({ promised: false })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});

// A voice that promises "one sec" and starts no tool and no Codex turn leaves the owner waiting 114s in silence.
describe("PlanCall.nudge pressed by the page over a promise", () => {
  it("hands the voice the promise sentence, never 'the owner pressed', and stops nothing", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.clock.advance({ ms: 2_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 10_000 });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: true })).toEqual({ interrupted: [], kind: "sent", notInterrupted: [] });
    expect(h.written.slice(before)).toEqual([nudgeRequest({ id: 5, text: PROMISE_OWED_TEXT })]);
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(PROMISE_OWED_TEXT).toBe(
      "You told the owner you would do something for them, and nothing has started. Hand it to the thinking model now, " +
        "before anything else; if it cannot be done, say so in one sentence and why. Never supply its result " +
        "yourself. Never hand the floor back to the owner: no 'go ahead', 'keep going', 'I'm here' or 'I'm listening'. " +
        NEXT_CLOSE,
    );
  });

  it("refuses over a running Codex turn, which is the promise being kept, writing and stopping nothing", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: true })).toEqual({
      kind: "refused",
      reason: "a Codex turn is already keeping the promise",
    });
    expect(h.written.length).toBe(before);
  });

  it("keeps every refusal the owner's press has: a waiting tool call, and an ended call", async () => {
    const waiting = await opened({ script: NUDGES });
    waiting.call.receive({ chunk: TOOL_REQUEST });
    const ended = await opened({ script: NUDGES });
    ended.call.stop({ reason: "the owner hung up" });
    expect([await waiting.call.nudge({ promised: true }), await ended.call.nudge({ promised: true })]).toEqual([
      { kind: "refused", reason: "a tool call is still running; stopping Codex now could hide what it did" },
      { kind: "refused", reason: "the call has ended: the owner hung up" },
    ]);
  });

  // Measured: the answer to "On it." was handed over, the page pressed over the kept promise nine seconds later, and
  // the fresh turn's answer was said a second time.
  it("refuses once the voice was handed an answer after the owner's newest words, while the owner's own press still goes", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.call.receive({ chunk: heardDoneLine({ text: "Can you check the staging pool" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: 6_000 });
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    await settle();
    expect(spokenAfter({ before: 0, h })).toEqual([NOTE_ANSWER]);
    h.clock.advance({ ms: 9_000 });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: true })).toEqual({
      kind: "refused",
      reason: "the voice was handed Codex's answer after the owner's newest words",
    });
    expect(h.written.length).toBe(before);
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
  });

  // The session may be saying an answer before it confirms the hand-over that stamps it voiced.
  it("refuses while Codex's answer is being handed over, before the session confirms it", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.call.receive({ chunk: heardDoneLine({ text: "Can you check the staging pool" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: 6_000 });
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeSettleMs });
    expect(await h.call.nudge({ promised: true })).toEqual({
      kind: "refused",
      reason: "Codex's answer is being handed to the voice",
    });
  });

  it("refuses while someone was transcribed a moment ago, and presses for the owner's newer words once quiet", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.call.receive({ chunk: heardDoneLine({ text: "Can you check the staging pool" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs - 1 });
    expect(await h.call.nudge({ promised: true })).toEqual({ kind: "refused", reason: "someone is talking" });
    h.clock.advance({ ms: 1 });
    expect((await h.call.nudge({ promised: true })).kind).toBe("sent");
  });

  it("holds the floor like the owner's press, so the owner's own is taken once the nudge gap has passed", async () => {
    const h = await opened({ script: NUDGES });
    expect((await h.call.nudge({ promised: true })).kind).toBe("sent");
    expect(await h.call.nudge({ promised: false })).toEqual({ kind: "refused", reason: "it was nudged a moment ago" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeGapMs });
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
  });
});

// A long silence reads as a dropped call, so the page gets a subtle sound cue at the same frequency instead of spoken
// filler.
describe("progress cues", () => {
  // After ten to twenty seconds with no update, the page gets one cue.
  it("sends the page one cue once a delegated turn has run its first window, and not before, writing nothing", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    expect(PLAN_CALL_LIMITS.progressFirstMs).toBe(15_000);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(eventsOf({ seen: h.seen }).at(-1)).toEqual({ kind: "progress" });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    expect(h.written.length).toBe(before);
  });

  it("gives a turn started mid-handshake its cue a first window after its own start, once the call can speak", async () => {
    // The start lands before realtime opens, when the call could arm no cue.
    const h = harness({
      script: {
        ...NUDGES,
        "thread/realtime/start": ({ id }) =>
          `${turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" })}${JSON.stringify({ id, result: {} })}\n`,
      },
    });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "v=0 offer" });
    await settle();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.clock.advance({ ms: 10_000 });
    h.call.receive({ chunk: SDP_LINE });
    expect(await outcome).toEqual({ kind: "open", sdp: "v=0 answer", threadId: "thread-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 10_000 - 1 });
    expect(cuesOf({ seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen })).toBe(1);
  });

  it("times a mid-handshake turn's first cue from words the voice said before the call could speak", async () => {
    // No cue is armed to hold back, so the words must still count as the window's start.
    const h = harness({
      script: {
        ...NUDGES,
        "thread/realtime/start": ({ id }) =>
          `${turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" })}${JSON.stringify({ id, result: {} })}\n`,
      },
    });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "v=0 offer" });
    await settle();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.clock.advance({ ms: 5_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 5_000 });
    h.call.receive({ chunk: SDP_LINE });
    expect(await outcome).toEqual({ kind: "open", sdp: "v=0 answer", threadId: "thread-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 5_000 - 1 });
    expect(cuesOf({ seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen })).toBe(1);
  });

  it("sends each later cue a whole cadence apart while the turn runs, and never a spoken line", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    expect(PLAN_CALL_LIMITS.progressCueMs).toBe(30_000);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(2);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs });
    expect(cuesOf({ seen: h.seen })).toBe(3);
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("keeps one cadence across overlapping turns, and stops only once the last of them completes", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs });
    expect(cuesOf({ seen: h.seen })).toBe(2);
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(cuesOf({ seen: h.seen })).toBe(2);
  });

  it("holds no cue open for a turn whose start already said it completed, and closes its row on the page", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "live" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "completed", turnId: "already-done" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "live" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs + PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "codex-turn")).toEqual([
      { kind: "codex-turn", phase: "started", turnId: "live" },
      { kind: "codex-turn", phase: "started", turnId: "already-done" },
      { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "already-done" },
      { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "live" },
    ]);
  });

  // A new hand-off while another turn's cue is armed must not keep that timer, or its cue comes early.
  it("gives a hand-off started while another turn runs a whole first window of its own", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs - 1_000 });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(2);
  });

  // A replayed start of a completed turn must not put it back among the running, or the cue goes on.
  it("holds no cue open for a replayed start of a turn that already completed", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs + PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "codex-turn")).toEqual([
      { kind: "codex-turn", phase: "started", turnId: "t-1" },
      { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t-1" },
      { kind: "codex-turn", phase: "started", turnId: "t-2" },
      { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t-2" },
    ]);
  });

  it("sends none once the delegated turn has completed, just before the first was due", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    expect(h.call.ended).toBe(false);
  });

  it("sends no later one once the turn completes just as a cue was due, and a next hand-off's is a first", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs - 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(2);
  });

  it("sends none after the call has stopped, though a turn was running", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.stop({ reason: "the owner hung up" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs * 3 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
  });

  it("holds the window back while the voice talks, a first window from its last words even after a cue", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    // The voice talking after a cue makes the next one due a first window after its words,
    // not a whole cadence.
    h.clock.advance({ ms: 3_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(2);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressCueMs });
    expect(cuesOf({ seen: h.seen })).toBe(3);
  });

  // Live probe: a walk's next question, voiced as commentary at 62.2s, was cut off by a line timed from the turn's
  // start at 64.2s. A commentary message handed to the voice restarts the window; a bare start does not.
  it("restarts the window when the voice is handed a commentary message, so a first cue is a whole window after it", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 2_000 });
    const before = h.written.length;
    h.call.receive({
      chunk: itemLine({
        item: { id: "c-1", phase: "commentary", text: "Digest, or as they come?", type: "agentMessage" },
        method: "item/completed",
        turnId: "t-1",
      }),
    });
    await settle();
    expect(spokenAfter({ before, h })).toEqual(["Digest, or as they come?"]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
  });

  it("holds no floor: a look line, or a nudge, is taken straight after a cue", async () => {
    const looked = await listening({ script: NUDGES });
    const nudged = await listening({ script: NUDGES });
    for (const h of [looked, nudged]) {
      h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
      h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs });
      await settle();
    }
    expect([cuesOf({ seen: looked.seen }), cuesOf({ seen: nudged.seen })]).toEqual([1, 1]);
    expect((await looked.call.sayLooking({ ask: "look" })).kind).toBe("said");
    expect((await nudged.call.nudge({ promised: false })).kind).toBe("sent");
  });

  // A voice that apologises each time a turn runs long reads as an apprentice grovelling.
  it("never has the voice apologise or thank the owner for waiting in any sentence the server scripts", () => {
    const apology =
      /\b(sorry|apolog\w*|my bad|my mistake|pardon me|forgive me|bear(ing)? with me|thanks for (waiting|your patience))\b/i;
    expect(SCRIPTED_SPEECH.length).toBe(14);
    expect(
      ["Sorry, this one's slow.", "Thanks for bearing with me.", "My mistake.", "Apologies."].map((line) =>
        apology.test(line),
      ),
    ).toEqual([true, true, true, true]);
    expect(SCRIPTED_SPEECH.filter((line) => apology.test(line))).toEqual([]);
  });
});
