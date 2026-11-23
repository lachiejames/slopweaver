/**
 * `PlanCall`'s owed turn and the lines it announces unasked: a send outcome, triage due and a meeting.
 */

import { describe, expect, it } from "vitest";
import { ANNOUNCE_LEAD_MS } from "../../../lib/announceCue";
import { MeetingLedger } from "../../../lib/meetingLedger";
import { PLAN_CALL_LIMITS, type SequencedEvent } from "../../../lib/planCallContract";
import { sendOutcomeText } from "../../../lib/slackSendWatch";
import { meetingSpeech, RESUME_TURN_TEXT } from "../../../lib/talkPlanWords";
import { TRIAGE_DUE_TEXT, TRIAGE_SUGGESTION_TURN_TEXT } from "../../../lib/triageDueWords";
import {
  afterLead,
  failure,
  HELD_SEND,
  heardDoneLine,
  heardLine,
  listening,
  NUDGES,
  opened,
  RESUMES,
  result,
  type Script,
  settle,
  TOOL_REQUEST,
  triageRequest,
  turnLine,
  VISIT,
} from "./harness";
import { AFTER_RETRO_MS, BEFORE_RETRO_MS, RETRO } from "./notices";

/** A child that also takes the console's own `turn/start`, naming the turn it started. */
const OWES: Script = { ...RESUMES, "turn/start": result({ turn: { id: "t-9" } }) };

/** The console's own `turn/start` writes, as the child saw them. */
const owedStartsOf = ({ h }: { h: Awaited<ReturnType<typeof opened>> }) =>
  h.written.filter((message) => message["method"] === "turn/start");

/** The owed-start and error events the page's stream saw. */
const owedEventsOf = ({ seen }: { seen: readonly SequencedEvent[] }) =>
  seen.map(({ event }) => event).filter((event) => event.kind === "owed-start" || event.kind === "error");

// Measured: a resume and then the page's promise press each drew "On it." / "One sec." and no Codex turn — 143s of
// silence, and the owner had even tried pressing nudge. The console starts the owed turn itself.
describe("PlanCall's owed turn, when the voice takes a resume or nudge and hands nothing over", () => {
  // A resume's answer is the thinking model's, asked with words of its own.
  it("starts the turn itself once the window passes after a resume, and says so on the stream", async () => {
    const h = await listening({ script: OWES });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs - 1 });
    expect(owedStartsOf({ h })).toEqual([]);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(owedStartsOf({ h })).toEqual([
      {
        id: 6,
        method: "turn/start",
        params: { input: [{ text: RESUME_TURN_TEXT, type: "text" }], threadId: "thread-1" },
      },
    ]);
    expect(owedEventsOf({ seen: h.seen })).toEqual([{ kind: "owed-start", why: "resume" }]);
  });

  it("starts nothing when the voice hands off inside the window", async () => {
    const h = await listening({ script: OWES });
    await h.call.resume();
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect([owedStartsOf({ h }), owedEventsOf({ seen: h.seen })]).toEqual([[], []]);
  });

  it("owes nothing when the session would not take the resume", async () => {
    const h = await listening({ script: { ...OWES, "thread/realtime/appendText": failure("no session") } });
    await h.call.resume();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect([owedStartsOf({ h }), owedEventsOf({ seen: h.seen })]).toEqual([[], []]);
  });

  it("names the owner's nudge and the page's promise press apart", async () => {
    const pressed = await listening({ script: OWES });
    await pressed.call.nudge({ promised: false });
    pressed.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    const promised = await listening({ script: OWES });
    await promised.call.nudge({ promised: true });
    promised.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect([owedEventsOf({ seen: pressed.seen }), owedEventsOf({ seen: promised.seen })]).toEqual([
      [{ kind: "owed-start", why: "nudge" }],
      [{ kind: "owed-start", why: "promise" }],
    ]);
  });

  it("never counts the turn the owner's nudge is stopping as the one it owes", async () => {
    const h = await listening({ script: OWES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    await h.call.nudge({ promised: false });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "interrupted", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(owedStartsOf({ h }).length).toBe(1);
  });

  // The console's start is unanswered, its turn already running, then the owner's nudge stops that turn.
  it("owes the owner's nudge a fresh turn when it stops the one the console started", async () => {
    const h = await listening({ script: { ...OWES, "turn/start": () => undefined } });
    await h.call.resume();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-9" }) });
    expect(await h.call.nudge({ promised: false })).toEqual({
      interrupted: ["t-9"],
      kind: "sent",
      notInterrupted: [],
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect([owedStartsOf({ h }).length, owedEventsOf({ seen: h.seen })]).toEqual([
      2,
      [
        { kind: "owed-start", why: "resume" },
        { kind: "owed-start", why: "nudge" },
      ],
    ]);
  });

  // A replayed start of the turn running at the press must not settle the turn the nudge is owed.
  it("never takes a replayed start of the turn running at the owner's press as the turn their nudge is owed", async () => {
    const h = await listening({ script: OWES });
    const started = turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" });
    h.call.receive({ chunk: started });
    const nudged = h.call.nudge({ promised: false });
    h.call.receive({ chunk: started });
    expect(await nudged).toEqual({ interrupted: ["t-1"], kind: "sent", notInterrupted: [] });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(owedEventsOf({ seen: h.seen })).toEqual([{ kind: "owed-start", why: "nudge" }]);
  });

  it("says why on the stream when its own start fails, so the silence carries a reason", async () => {
    const h = await listening({ script: { ...OWES, "turn/start": failure("thread busy") } });
    await h.call.resume();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(owedEventsOf({ seen: h.seen })).toEqual([
      { kind: "owed-start", why: "resume" },
      {
        kind: "error",
        message: "the resume made the answer the thinking model's, and the console's own start failed: thread busy",
      },
    ]);
  });

  it("writes nothing once the call has ended inside the window", async () => {
    const h = await listening({ script: OWES });
    await h.call.resume();
    h.call.stop({ reason: "the owner hung up" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(owedStartsOf({ h })).toEqual([]);
  });
});

// A reply the owner approved by voice can sit held with nobody told; the outcome is announced.
describe("PlanCall.announceSendOutcome", () => {
  it("hands the voice the outcome as a developer message, and answers a second post of it as already said", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    expect(await afterLead({ clock: h.clock, line: h.call.announceSendOutcome(HELD_SEND) })).toEqual({ kind: "said" });
    expect(await h.call.announceSendOutcome(HELD_SEND)).toEqual({ kind: "already" });
    expect(h.written.slice(before)).toEqual([
      {
        id: 5,
        method: "thread/realtime/appendText",
        params: { role: "developer", text: sendOutcomeText({ outcome: HELD_SEND.outcome }), threadId: "thread-1" },
      },
    ]);
  });

  it("refuses while the owner is talking or a tool call runs, writing nothing, and hands it over once the floor is clear", async () => {
    const h = await opened({ script: RESUMES });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect(await h.call.announceSendOutcome(HELD_SEND)).toEqual({ kind: "refused", reason: "someone is talking" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    h.call.receive({ chunk: TOOL_REQUEST });
    expect(await h.call.announceSendOutcome(HELD_SEND)).toEqual({
      kind: "refused",
      reason: "a tool call is still running",
    });
    expect(h.written.length).toBe(before);
    const clear = await opened({ script: RESUMES });
    clear.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await afterLead({ clock: clear.clock, line: clear.call.announceSendOutcome(HELD_SEND) })).toEqual({
      kind: "said",
    });
  });

  it("refuses a second outcome while one is being handed over", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    void h.call.announceSendOutcome(HELD_SEND);
    const sent = { noticeId: "2026-10-07T06:00:00.000Z x", outcome: HELD_SEND.outcome };
    expect(await h.call.announceSendOutcome(sent)).toEqual({
      kind: "refused",
      reason: "another send outcome is being handed over",
    });
  });

  it("says the session would not take it, and never writes it again, since a write that failed may have landed", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": failure("no session") } });
    expect([
      await afterLead({ clock: h.clock, line: h.call.announceSendOutcome(HELD_SEND) }),
      await h.call.announceSendOutcome(HELD_SEND),
    ]).toEqual([
      { kind: "failed", reason: "the voice was not handed the send outcome: no session" },
      { kind: "already" },
    ]);
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: RESUMES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.announceSendOutcome(HELD_SEND)).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});

// The owner wants a timer built in, so the voice can say when a triage card's clock is up.
describe("PlanCall.announceTriageDue", () => {
  // The clock's pause or resume is read from the model's own arguments, which only this server holds.
  it("reports the tool and the arguments a claimed answer settled, so a route can read which tool it was and how it was called", async () => {
    const h = await opened({ script: RESUMES });
    const tokens: string[] = [];
    h.call.subscribe({ after: 0, listener: ({ event }) => event.kind === "tool" && tokens.push(event.token) });
    h.call.receive({ chunk: triageRequest({ args: { state: "paused" }, id: 81, tool: "triage_clock" }) });
    h.call.claim({ claimant: "page-a", token: tokens[0] });
    const items = [{ text: "the card", type: "inputText" as const }];
    expect(h.call.answer({ claimant: "page-a", contentItems: items, success: true, token: tokens[0] })).toEqual({
      arguments: JSON.stringify({ state: "paused" }),
      kind: "answered",
      tool: "triage_clock",
    });
  });

  // Asked to hand off for one suggested call, the voice can hand nothing over and rule on a draft the owner never
  // approved itself; the console starts the suggestion's turn at once instead.
  it("hands the voice the time-up line once per visit and starts the suggestion's turn itself at once", async () => {
    const h = await listening({ script: OWES });
    const before = h.written.length;
    expect([
      await afterLead({ clock: h.clock, line: h.call.announceTriageDue({ visitId: VISIT }) }),
      await h.call.announceTriageDue({ visitId: VISIT }),
    ]).toEqual([{ kind: "said" }, { kind: "already" }]);
    await settle();
    expect(h.written.slice(before)).toEqual([
      {
        id: 5,
        method: "thread/realtime/appendText",
        params: { role: "developer", text: TRIAGE_DUE_TEXT, threadId: "thread-1" },
      },
      {
        id: 6,
        method: "turn/start",
        params: { input: [{ text: TRIAGE_SUGGESTION_TURN_TEXT, type: "text" }], threadId: "thread-1" },
      },
    ]);
    expect(owedEventsOf({ seen: h.seen })).toEqual([{ kind: "owed-start", why: "triage" }]);
  });

  it("starts no second turn when the voice hands the suggestion off while its line is written", async () => {
    const h = await listening({
      script: {
        ...OWES,
        "thread/realtime/appendText": ({ id }) =>
          `${turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" })}${JSON.stringify({ id, result: {} })}\n`,
      },
    });
    expect(await afterLead({ clock: h.clock, line: h.call.announceTriageDue({ visitId: VISIT }) })).toEqual({
      kind: "said",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs * 4 });
    await settle();
    expect(owedStartsOf({ h })).toEqual([]);
    expect(owedEventsOf({ seen: h.seen })).toEqual([]);
  });

  it("only ever suggests: the voice names no verdict, and the turn suggests one without ruling the card", () => {
    expect(TRIAGE_DUE_TEXT).toBe(
      "The clock is up on the triage card the owner has open. If they have already given their call on that card, or the " +
        "clock on it has been paused, or the pass has ended or moved to another card, say nothing about this at " +
        "all. Otherwise say only, in a few words, that time is up and their ways out are coming. They are the " +
        "thinking model's, already being worked out: never name, imply, endorse, repeat or affirm a call on the " +
        "card yourself, no send, revise, park, skip or any other verdict, and never ask them to approve one that " +
        "has not arrived. Never hand the floor back to the owner: no 'go ahead', 'keep going', 'I'm here' or " +
        "'I'm listening'. ",
    );
    // At zero the owner hears three ways out, the voice's one suggestion among them, and nothing moves until they say.
    expect(TRIAGE_SUGGESTION_TURN_TEXT).toBe(
      "The clock is up on the triage card the owner has open, so this turn is the console's. If they have already given " +
        "their call on that card, or the pass has ended or moved to another card, say nothing about the card. " +
        "Otherwise name their three ways out in one short sentence: decide it (send it, rewrite or drop), name " +
        "what's missing (needs more info), or park it (for a working session or the slow triage hour). Then give " +
        "ONE of them as your suggested call and label on that card with its reason in a sentence, and ask which is " +
        "their call. It is only a suggestion: do not send, park, advance or otherwise rule the card. It stays " +
        "exactly where it is until they give their call or agree to yours.",
    );
  });

  // A bug report the owner dictates stalls its transcript, then the time-up line is taken, then the report's done
  // arrives. Replayed from the stall's last delta (the clock's zero); the instants are page instants, not proven
  // server arrivals.
  it("holds triage-due and send-outcome across an open bug report, while resume remains a backstop", async () => {
    const h = await listening({ script: OWES });
    const stallFrom = Date.parse("2026-10-22T10:41:19.849Z");
    const at = ({ iso }: { iso: string }) => Date.parse(iso) - stallFrom;
    h.call.receive({ chunk: heardLine({ delta: "and then it dropped out" }) });
    h.clock.advance({ ms: at({ iso: "2026-10-22T10:42:43.500Z" }) });
    const before = h.written.length;
    const open = { kind: "refused", reason: "the owner's utterance is still open" };
    expect(await h.call.announceTriageDue({ visitId: VISIT })).toEqual(open);
    const outcome = { state: "held", why: "the as-me gates held it" } as const;
    expect(await h.call.announceSendOutcome({ noticeId: "sd-bbd10e68", outcome })).toEqual(open);
    expect(h.written.length).toBe(before);
    h.clock.advance({ ms: at({ iso: "2026-10-22T10:43:04.700Z" }) - h.clock.nowMs() });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.clock.advance({ ms: at({ iso: "2026-10-22T10:43:07.970Z" }) - h.clock.nowMs() });
    h.call.receive({ chunk: heardDoneLine({ text: "and then it dropped out, and the live transcript lagged" }) });
    expect(await h.call.announceTriageDue({ visitId: VISIT })).toEqual({
      kind: "refused",
      reason: "someone is talking",
    });
  });

  // Only the exact done method closes the owner's utterance; any other transcript method ending in `/done` does not.
  it("keeps the owner's utterance open across a transcript notification that is not the exact done", async () => {
    const h = await listening({ script: OWES });
    h.call.receive({ chunk: heardLine({ delta: "and then it dropped out" }) });
    const bogus = {
      method: "thread/realtime/transcript/not-a-real-event/done",
      params: { role: "user", text: "x", threadId: "thread-1" },
    };
    h.call.receive({ chunk: `${JSON.stringify(bogus)}\n` });
    h.clock.advance({ ms: 60_000 });
    expect(await h.call.announceTriageDue({ visitId: VISIT })).toEqual({
      kind: "refused",
      reason: "the owner's utterance is still open",
    });
  });

  it("waits for a clear floor while the owner talks, writing nothing, so the page retries it", async () => {
    const h = await opened({ script: RESUMES });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect(await h.call.announceTriageDue({ visitId: VISIT })).toEqual({
      kind: "refused",
      reason: "someone is talking",
    });
    expect(h.written.length).toBe(before);
  });

  // The floor is read again after the herald, so words the owner opens with inside its lead are not talked over.
  it("hands the claim back unwritten when the owner starts talking during the herald's lead, and says it once they are done", async () => {
    const h = await listening({ script: OWES });
    const before = h.written.length;
    const line = h.call.announceTriageDue({ visitId: VISIT });
    await settle();
    h.call.receive({ chunk: heardLine({ delta: "wait, one thing" }) });
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    expect(await line).toEqual({ kind: "refused", reason: "the owner's utterance is still open" });
    expect(h.written.length).toBe(before);
    h.call.receive({ chunk: heardDoneLine({ text: "wait, one thing" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs * 2 });
    expect(await afterLead({ clock: h.clock, line: h.call.announceTriageDue({ visitId: VISIT }) })).toEqual({
      kind: "said",
    });
  });

  it("says the session would not take it, and never writes it again, since a write that failed may have landed", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": failure("no session") } });
    expect([
      await afterLead({ clock: h.clock, line: h.call.announceTriageDue({ visitId: VISIT }) }),
      await h.call.announceTriageDue({ visitId: VISIT }),
    ]).toEqual([
      { kind: "failed", reason: "the voice was not handed the time-up line: no session" },
      { kind: "already" },
    ]);
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: RESUMES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.announceTriageDue({ visitId: VISIT })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});

/** The speech request a meeting line writes, under its RPC id. */
const meetingSpeechRequest = ({ id, started }: { id: number; started: boolean }) => ({
  id,
  method: "thread/realtime/appendSpeech",
  params: { text: meetingSpeech({ started, title: RETRO.title }), threadId: "thread-1" },
});

// The voice is the one that can get the owner's attention and point them at the button that joins the meeting.
describe("PlanCall.announceMeeting", () => {
  it("has the voice say the line once the floor is clear before the start, and answers a second post as already said", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    const line = h.call.announceMeeting({ notice: RETRO, nowMs: BEFORE_RETRO_MS });
    expect(await afterLead({ clock: h.clock, line })).toEqual({ kind: "said" });
    expect(await h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS })).toEqual({ kind: "already" });
    expect(h.written.slice(before)).toEqual([meetingSpeechRequest({ id: 5, started: false })]);
    expect(meetingSpeech({ started: false, title: RETRO.title })).toBe(
      "Heads up: Fixture team retro starts in a minute or two. The join button is by the orb.",
    );
  });

  it("waits for a clear floor before the start, writing nothing", async () => {
    const h = await opened({ script: NUDGES });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect(await h.call.announceMeeting({ notice: RETRO, nowMs: BEFORE_RETRO_MS })).toEqual({
      kind: "refused",
      reason: "someone is talking",
    });
    expect(h.written.length).toBe(before);
  });

  it("cuts in once the meeting has started, while the owner talks and a Codex turn runs, and never stops that turn", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    const line = h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS });
    expect(await afterLead({ clock: h.clock, line })).toEqual({ kind: "said" });
    expect(h.written.slice(before)).toEqual([meetingSpeechRequest({ id: 5, started: true })]);
    expect(meetingSpeech({ started: true, title: RETRO.title })).toBe(
      "Hey, cutting in: Fixture team retro has started. The join button is by the orb.",
    );
  });

  it("refuses a second meeting line while one is being said", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    void h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS });
    const next = { ...RETRO, noticeId: "standup@google.com@2026-10-09T04:31:00.000Z" };
    expect(await h.call.announceMeeting({ notice: next, nowMs: AFTER_RETRO_MS })).toEqual({
      kind: "refused",
      reason: "another meeting line is being sent",
    });
  });

  it("says the session would not take it, and never says it again, since a write that failed may have landed", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    expect([
      await afterLead({ clock: h.clock, line: h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS }) }),
      await h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS }),
    ]).toEqual([{ kind: "failed", reason: "the voice did not say the meeting line: no session" }, { kind: "already" }]);
  });

  // The page can lose the response to a line the voice said, then roll over onto a fresh call.
  it("answers a fresh call after a rollover as already said, writing nothing, when the old call said it", async () => {
    const meetings = new MeetingLedger();
    const old = await opened({ meetings, script: NUDGES });
    const line = old.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS });
    expect(await afterLead({ clock: old.clock, line })).toEqual({ kind: "said" });
    const fresh = await opened({ meetings, script: NUDGES });
    const before = fresh.written.length;
    expect(await fresh.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS })).toEqual({ kind: "already" });
    expect(fresh.written.length).toBe(before);
  });

  it("holds a resume and a send outcome while a meeting line is being said, so neither talks over it", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendSpeech": () => undefined } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    void h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS });
    expect([await h.call.resume(), await h.call.announceSendOutcome(HELD_SEND)]).toEqual([
      { kind: "refused", reason: "a meeting line is being said" },
      { kind: "refused", reason: "a meeting line is being said" },
    ]);
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: NUDGES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});
