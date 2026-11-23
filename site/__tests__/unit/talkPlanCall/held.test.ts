/**
 * `PlanCall`'s held answers, and the herald it speaks before an unasked line.
 */

import { describe, expect, it } from "vitest";
import { ANNOUNCE_LEAD_MS } from "../../../lib/announceCue";
import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import {
  afterLead,
  eventsOf,
  failure,
  HELD_SEND,
  type harness,
  heardDoneLine,
  heardLine,
  itemLine,
  listening,
  NOTE_ANSWER,
  NOTE_ANSWER_LINE,
  NUDGES,
  opened,
  RESUMES,
  settle,
  spokenAfter,
  turnLine,
  VISIT,
} from "./harness";
import { AFTER_RETRO_MS, BEFORE_RETRO_MS, DRIFT, driftSpeechRequest, ISO_NUDGE, RETRO } from "./notices";

/**
 * Every event a call emits from now on, by kind.
 *
 * @returns the kinds heard, in order, and the cues of the heralds among them
 */
function heard({ h }: { h: ReturnType<typeof harness> }): { kinds: string[]; cues: string[] } {
  const kinds: string[] = [];
  const cues: string[] = [];
  h.call.subscribe({
    after: Number.MAX_SAFE_INTEGER,
    listener: ({ event }) => {
      kinds.push(event.kind);
      if (event.kind === "announce") {
        cues.push(event.cue);
      }
    },
  });
  return { cues, kinds };
}

// A focus nudge stays spoken with a chime just before it: one chime per kind of unasked line, four in all.
describe("PlanCall heralds an unasked line", () => {
  it("emits the chime first and writes nothing until the lead is up, then says the line", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const events = heard({ h });
    const before = h.written.length;
    const line = h.call.windowNotices.announceDrift({ notice: DRIFT });
    await settle();
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS - 1 });
    await settle();
    expect([events.cues, h.written.length - before]).toEqual([["focus"], 0]);
    h.clock.advance({ ms: 1 });
    expect(await line).toEqual({ kind: "said" });
    expect(h.written.slice(before)).toEqual([driftSpeechRequest({ id: 5 })]);
  });

  it("never replays a chime to a page that reconnects after it", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    await afterLead({ clock: h.clock, line: h.call.windowNotices.announceDrift({ notice: DRIFT }) });
    const replay = h.call.subscribe({ after: 0, listener: () => undefined }).replay;
    expect(replay.filter(({ event }) => event.kind === "announce")).toEqual([]);
  });

  // No unasked line rings `done`: a Slack send that went is never said unasked.
  it("rings each kind of line its own chime: focus, reminder and attention", async () => {
    const h = await opened({ script: { ...NUDGES, ...RESUMES } });
    const events = heard({ h });
    const failed = { noticeId: "failed-1", outcome: { error: "channel_not_found", state: "failed" } } as const;
    const lines = [
      () => h.call.windowNotices.announceDrift({ notice: DRIFT }),
      () => h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }),
      () => h.call.announceMeeting({ notice: RETRO, nowMs: BEFORE_RETRO_MS }),
      () => h.call.announceSendOutcome(HELD_SEND),
      () => h.call.announceSendOutcome(failed),
      () => h.call.announceTriageDue({ visitId: VISIT }),
    ];
    const outcomes: unknown[] = [];
    for (const say of lines) {
      h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs + PLAN_CALL_LIMITS.resumeQuietMs });
      outcomes.push(await afterLead({ clock: h.clock, line: say() }));
    }
    expect(outcomes).toEqual(lines.map(() => ({ kind: "said" })));
    expect(events.cues).toEqual(["focus", "focus", "reminder", "attention", "attention", "attention"]);
  });

  it("rings nothing for a line refused by the floor or said already", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    await afterLead({ clock: h.clock, line: h.call.windowNotices.announceDrift({ notice: DRIFT }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    const events = heard({ h });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    expect([
      await h.call.windowNotices.announceDrift({ notice: DRIFT }),
      await h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }),
      events.cues,
    ]).toEqual([{ kind: "already" }, { kind: "refused", reason: "someone is talking" }, []]);
  });

  it("holds every other own line through the lead, as it does while the write is in flight", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const line = h.call.windowNotices.announceDrift({ notice: DRIFT });
    await settle();
    expect([
      await h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }),
      await h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS }),
    ]).toEqual([
      { kind: "refused", reason: "a drift line, an ISO nudge or a steer-risk line is being said" },
      { kind: "refused", reason: "a drift line, an ISO nudge or a steer-risk line is being sent" },
    ]);
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    expect(await line).toEqual({ kind: "said" });
  });

  it("holds a look line and the page's promise nudge through the lead, so the chime introduces only its own line", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    const line = h.call.windowNotices.announceDrift({ notice: DRIFT });
    await settle();
    const held = { kind: "refused", reason: "a drift line, an ISO nudge or a steer-risk line is being said" };
    expect([await h.call.sayLooking({ ask: "look" }), await h.call.nudge({ promised: true })]).toEqual([held, held]);
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    expect(await line).toEqual({ kind: "said" });
    expect(h.written.slice(before)).toEqual([driftSpeechRequest({ id: 5 })]);
  });

  it("holds a resume and a meeting line through a send outcome's lead, so neither lands inside its chime", async () => {
    const h = await opened({ script: { ...NUDGES, ...RESUMES } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    const line = h.call.announceSendOutcome(HELD_SEND);
    await settle();
    const held = { kind: "refused", reason: "a send outcome is being handed over" };
    expect([
      await h.call.resume(),
      await h.call.announceMeeting({ notice: RETRO, nowMs: BEFORE_RETRO_MS }),
      h.written.length - before,
    ]).toEqual([held, held, 0]);
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    expect(await line).toEqual({ kind: "said" });
  });

  it("says the line though the owner starts talking during the lead: it was due when it was claimed", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    const line = h.call.windowNotices.announceDrift({ notice: DRIFT });
    await settle();
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    expect(await line).toEqual({ kind: "said" });
    expect(h.written.slice(before)).toEqual([driftSpeechRequest({ id: 5 })]);
  });

  it("fails a line whose call ends during the lead, writes nothing, and keeps it claimed", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const line = h.call.windowNotices.announceDrift({ notice: DRIFT });
    await settle();
    h.call.stop({ reason: "the owner hung up" });
    const before = h.written.length;
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    expect(await line).toEqual({ kind: "failed", reason: "the voice did not say the drift line: the owner hung up" });
    expect(h.written.length).toBe(before);
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({ kind: "already" });
  });
});

/** A final answer of turn `t-1` completing. */
const ANSWER_LINE = itemLine({
  item: { id: "a-1", phase: "final_answer", text: "Rosa's note says groups are manual now.", type: "agentMessage" },
  method: "item/completed",
  turnId: "t-1",
});

/** The trace of `NOTE_ANSWER_LINE`'s answer held, still pending, because the owner's utterance has no `done`. */
const HELD_FOR_OPEN_UTTERANCE = {
  detail: "the owner's utterance is still open",
  itemId: "a-1",
  kind: "held-answer",
  pending: true,
  phase: "held",
  turnId: "t-1",
};

// The owner's transcript can close mid-clause and the voice begin 1 ms later, saying an answer Codex completed
// 3.4 s before; an answer is held until the owner has been quiet.
describe("held answers", () => {
  it("holds Codex's answer while the owner is mid-clause and hands it to the voice once they have been quiet five seconds", async () => {
    const h = await listening({ script: NUDGES });
    const midClause = "I believe that the answer here is probably going to be some";
    h.call.receive({ chunk: heardLine({ delta: midClause }) });
    h.call.receive({ chunk: heardDoneLine({ text: midClause }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: 1_600 });
    await settle();
    const before = h.written.length;
    h.call.receive({ chunk: ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: 3_399 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    h.clock.advance({ ms: 250 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual(["Rosa's note says groups are manual now."]);
    const base = { itemId: "a-1", kind: "held-answer", turnId: "t-1" } as const;
    expect(eventsOf({ seen: h.seen }).filter((e) => e.kind === "held-answer")).toEqual([
      { ...base, detail: "the owner is still talking", pending: true, phase: "held" },
      { ...base, detail: "the owner's words went quiet", pending: true, phase: "handing" },
      { ...base, detail: "the owner's words went quiet", pending: false, phase: "released" },
    ]);
  });

  // The provider can leave the owner's words unclosed; the turn's answer held meanwhile must meet the page's resume
  // and be handed over, not refused and then dropped unsaid when the owner speaks again.
  it("hands a held answer over at the page's resume when the owner's utterance never closed, never the take-your-turn line", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "Um, this hurts my trust though" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    await settle();
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    await settle();
    expect(h.written.slice(before).map((m) => m["method"])).toEqual(["thread/realtime/appendSpeech"]);
    expect(spokenAfter({ before, h })).toEqual(["Rosa's note says groups are manual now."]);
    const base = { itemId: "a-1", kind: "held-answer", turnId: "t-1" } as const;
    const why = "the owner's words had gone unanswered and the page judged the silence not theirs";
    expect(eventsOf({ seen: h.seen }).filter((e) => e.kind === "held-answer")).toEqual([
      { ...base, detail: "the owner's utterance is still open", pending: true, phase: "held" },
      { ...base, detail: why, pending: true, phase: "handing" },
      { ...base, detail: why, pending: false, phase: "released" },
    ]);
  });

  // A held answer beside an older turn still running, begun before the owner's words.
  // The resume over that turn releases the held answer, which is the answer owed, rather than an "Mm-hm." over it.
  it("releases a held answer at a resume over an older running turn, never the acknowledgement line", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-old" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    h.call.receive({ chunk: heardLine({ delta: "Um, this hurts my trust though" }) });
    h.clock.advance({ ms: 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    await settle();
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    await settle();
    expect(h.written.slice(before).map((m) => m["method"])).toEqual(["thread/realtime/appendSpeech"]);
    expect(spokenAfter({ before, h })).toEqual(["Rosa's note says groups are manual now."]);
  });

  it("still refuses a resume over a held answer while the owner was transcribed moments ago", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "and by update prompt, we mean" }) });
    h.call.receive({ chunk: ANSWER_LINE });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs - 1 });
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "someone is talking" });
    expect(h.written.length).toBe(before);
  });

  // Measured: the owner's words stopped with no done, the resume was taken 7s later, and the answer Codex wrote 8s
  // after that was held "the owner's utterance is still open" until the owner asked whether it was stuck.
  it("hands over an answer arriving after a resume it took when the owner's utterance never closed", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.clock.advance({ ms: 5_000 });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: 8_000 });
    await settle();
    const before = h.written.length;
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.heldPollMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([NOTE_ANSWER]);
  });

  it("holds an answer once the owner's next words reopen their utterance after the resume", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.clock.advance({ ms: 5_000 });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.clock.advance({ ms: 8_000 });
    h.call.receive({ chunk: heardLine({ delta: "and the other one" }) });
    h.clock.advance({ ms: 30_000 });
    await settle();
    const before = h.written.length;
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.heldPollMs * 4 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(eventsOf({ seen: h.seen }).filter((e) => e.kind === "held-answer")).toEqual([HELD_FOR_OPEN_UTTERANCE]);
  });

  it("leaves the owner's utterance open when it refuses the resume", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs - 1 });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "someone is talking" });
    h.clock.advance({ ms: 30_000 });
    await settle();
    const before = h.written.length;
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.heldPollMs * 4 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(eventsOf({ seen: h.seen }).filter((e) => e.kind === "held-answer")).toEqual([HELD_FOR_OPEN_UTTERANCE]);
  });

  // A resume must not close the owner's utterance before the hand-over has succeeded.
  it("leaves the owner's utterance open when the session would not take the resume", async () => {
    const h = await listening({ script: { ...NUDGES, "thread/realtime/appendText": failure("no session") } });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.clock.advance({ ms: 5_000 });
    expect(await h.call.resume()).toEqual({
      kind: "failed",
      reason: "the voice was not asked to take its turn: no session",
    });
    h.clock.advance({ ms: 30_000 });
    await settle();
    const before = h.written.length;
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.heldPollMs * 4 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(eventsOf({ seen: h.seen }).filter((e) => e.kind === "held-answer")).toEqual([HELD_FOR_OPEN_UTTERANCE]);
  });

  // When the session refuses the held answer a resume released, the owner's utterance must not stay closed, or the
  // answer is tried again over their open words.
  it("leaves the owner's utterance open when the session refuses the held answer a resume released", async () => {
    const h = await listening({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    h.call.receive({ chunk: heardLine({ delta: "Can you check the staging pool" }) });
    h.call.receive({ chunk: NOTE_ANSWER_LINE });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    await settle();
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    await settle();
    for (let poll = 0; poll < 40; poll += 1) {
      h.clock.advance({ ms: PLAN_CALL_LIMITS.heldPollMs });
      await settle();
    }
    expect(spokenAfter({ before, h })).toEqual([NOTE_ANSWER]);
    const refused = "the voice did not take the thinking model's answer, trying again: no session";
    const answer = { itemId: "a-1", kind: "held-answer", pending: true, turnId: "t-1" } as const;
    expect(eventsOf({ seen: h.seen }).filter((e) => e.kind === "held-answer")).toEqual([
      HELD_FOR_OPEN_UTTERANCE,
      {
        ...answer,
        detail: "the owner's words had gone unanswered and the page judged the silence not theirs",
        phase: "handing",
      },
      { ...answer, detail: refused, phase: "failed" },
    ]);
  });

  it("hands a held answer over at the owner's nudge, stopping no turn and writing no nudge", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "hundreds of other people who don't have" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: ANSWER_LINE });
    const before = h.written.length;
    expect(await h.call.nudge({ promised: false })).toEqual({ interrupted: [], kind: "sent", notInterrupted: [] });
    await settle();
    expect(h.written.slice(before).map((m) => m["method"])).toEqual(["thread/realtime/appendSpeech"]);
    expect(spokenAfter({ before, h })).toEqual(["Rosa's note says groups are manual now."]);
  });

  // Measured: a finished turn's answer, held over the owner's words, was handed to the voice after those words had
  // started the next turn, and the voice re-read the card the owner had just ruled on.
  it("drops a finished turn's held answer once the owner's words start a newer turn, and a terminal start draws no line", async () => {
    const heldThenStarted = async ({ status }: { status: string }) => {
      const h = await listening({ script: NUDGES });
      h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
      h.call.receive({ chunk: heardLine({ delta: "I'm going to send this card back" }) });
      const before = h.written.length;
      h.call.receive({ chunk: ANSWER_LINE });
      h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
      h.call.receive({ chunk: turnLine({ method: "turn/started", status, turnId: "t-2" }) });
      h.call.receive({ chunk: heardDoneLine({ text: "I'm going to send this card back for a recut" }) });
      h.clock.advance({ ms: 5_250 });
      await settle();
      return { before, h };
    };
    const started = await heldThenStarted({ status: "inProgress" });
    expect(spokenAfter(started)).toEqual([]);
    expect(eventsOf({ seen: started.h.seen }).filter((e) => e.kind === "held-answer")).toEqual([
      {
        detail: "the owner's utterance is still open",
        itemId: "a-1",
        kind: "held-answer",
        pending: true,
        phase: "held",
        turnId: "t-1",
      },
      {
        detail: "turn t-2 started after it was written, and its answer is the one owed",
        itemId: "a-1",
        kind: "held-answer",
        pending: false,
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
    const terminal = await heldThenStarted({ status: "completed" });
    expect(spokenAfter(terminal)).toEqual(["Rosa's note says groups are manual now."]);
  });

  // The stream's listeners run synchronously, so the start is recorded before them.
  it("never hands the voice an overtaken answer from a nudge the newer turn's own start event sets off", async () => {
    const h = await listening({ script: NUDGES });
    h.call.subscribe({
      after: 0,
      listener: ({ event }) => {
        if (event.kind === "codex-turn" && event.phase === "started" && event.turnId === "t-2") {
          void h.call.nudge({ promised: false });
        }
      },
    });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: heardLine({ delta: "I'm going to send this card back" }) });
    const before = h.written.length;
    h.call.receive({ chunk: ANSWER_LINE });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.clock.advance({ ms: 5_250 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("says nothing held once the call has ended", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: heardLine({ delta: "so now, um" }) });
    h.call.receive({ chunk: ANSWER_LINE });
    const before = h.written.length;
    h.call.stop({ reason: "the owner hung up" });
    h.clock.advance({ ms: 60_000 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
  });
});
