/**
 * The owner's next-card ask, read off the owner's own transcript by the real notification path (a spoken ask the voice
 * acknowledged aloud with no turn for 25s). With no turn started during the owner's words, the console starts the walk turn itself once the owed window passes; a hand-off the voice
 * made inside the owner's words, even one already ended, or a turn still running, owes nothing.
 */

import { describe, expect, it } from "vitest";
import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import { WALK_TURN_TEXT } from "../../../lib/talkPlanWords";
import { eventsOf, heardDoneLine, listening, OPENS, result, settle, transcriptLine, turnLine } from "./harness";

/** A child that takes a console-written `turn/start`, naming the turn it started. */
const STARTS = { ...OPENS, "turn/start": result({ turn: { id: "t-walk" } }) };

/** The owner's spoken next-card ask. */
const ASK = "All right, next card please";

/** Every `turn/start` the call wrote, by the text it asked. */
const startsOf = ({ h }: { h: Awaited<ReturnType<typeof listening>> }): unknown[] =>
  h.written.filter((line) => line["method"] === "turn/start").map((line) => line["params"]);

describe("PlanCall — the owner's next-card ask with no hand-off", () => {
  it("starts the walk turn itself once the window passes, and streams the owed start", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(startsOf({ h })).toEqual([{ input: [{ text: WALK_TURN_TEXT, type: "text" }], threadId: "thread-1" }]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "owed-start")).toEqual([
      { kind: "owed-start", why: "walk" },
    ]);
  });

  it("owes nothing when the voice handed off during the owner's words, even a turn that ended before the owner's done", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-voice" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-voice" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  // A start that arrives already terminal still answered the owner's words.
  it("owes nothing when a start inside the owner's words arrives already completed", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "completed", turnId: "t-done" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  // A late hand-off whose completion arrives before its start, which is then dropped.
  it("owes nothing when a late hand-off inside the window completes before its own start arrives", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: 1000 });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-voice" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-voice" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  // The completion-first hand-off lands inside the owner's words, between the owner's delta and the owner's done.
  it("owes nothing when a completion-first hand-off lands wholly inside the owner's words", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-voice" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-voice" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  // An unreadable completion of a turn never seen starting is still a turn that ran.
  it("owes nothing when a completion still reading in progress names a new turn inside the owner's words", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "inProgress", turnId: "t-x" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  // Read after the owner's done in the same millisecond, the completion still answered them.
  it("owes nothing when that completion-first hand-off lands in the same millisecond as the owner's done", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-voice" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-voice" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  // A replayed final before the console's own walk start has come to a turn,
  // whether the write is unanswered or answered ahead of its turn's own notification.
  it.each([
    { script: OPENS, shape: "still unanswered" },
    { script: STARTS, shape: "answered, its turn not yet heard of" },
  ])("writes one walk start when the owner's final is replayed while that start is $shape", async ({ script }) => {
    const h = await listening({ script });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(startsOf({ h })).toEqual([{ input: [{ text: WALK_TURN_TEXT, type: "text" }], threadId: "thread-1" }]);
  });

  // A turn that began before the owner's words and ends inside them.
  it("still starts it when the only turn began before the owner's words and ended inside them", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-held" }) });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-held" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(startsOf({ h })).toEqual([{ input: [{ text: WALK_TURN_TEXT, type: "text" }], threadId: "thread-1" }]);
  });

  // An old turn's completion replayed inside the window is no hand-off answering them.
  it("still starts it when a turn that ended before the owner's words has its completion replayed inside the window", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-old" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-old" }) });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.clock.advance({ ms: 1000 });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-old" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(startsOf({ h })).toEqual([{ input: [{ text: WALK_TURN_TEXT, type: "text" }], threadId: "thread-1" }]);
  });

  it("owes nothing while a turn runs at the owner's done, or for words that only mention the next card", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-run" }) });
    h.call.receive({ chunk: heardDoneLine({ text: ASK }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-run" }) });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: "the next card asks about backups" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  it("reads only the owner's own words on this call's thread: the voice saying it, or another thread's, owes nothing", async () => {
    const h = await listening({ script: STARTS });
    const voiceDone = {
      method: "thread/realtime/transcript/done",
      params: { role: "assistant", text: ASK, threadId: "thread-1" },
    };
    const otherDone = {
      method: "thread/realtime/transcript/done",
      params: { role: "user", text: ASK, threadId: "thread-2" },
    };
    h.call.receive({ chunk: `${JSON.stringify(voiceDone)}\n${JSON.stringify(otherDone)}\n` });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 2 });
    await settle();
    expect(startsOf({ h })).toEqual([]);
  });

  it("starts it for a lone done with no delta before it, the provider's final-only shape", async () => {
    const h = await listening({ script: STARTS });
    h.call.receive({ chunk: heardDoneLine({ text: "Next card, please" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(startsOf({ h })).toEqual([{ input: [{ text: WALK_TURN_TEXT, type: "text" }], threadId: "thread-1" }]);
  });
});
