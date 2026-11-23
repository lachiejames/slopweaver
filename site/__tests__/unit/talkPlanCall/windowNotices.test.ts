/**
 * `WindowNoticeLines`: the drift, ISO nudge and steer-risk notices a call speaks.
 */

import { describe, expect, it } from "vitest";
import type { IsoNudgeNotice } from "../../../lib/isoNudgeNotice";
import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import type { SteerRiskNotice } from "../../../lib/steerRiskNotice";
import { TalkNoticeLedger } from "../../../lib/talkNoticeLedger";
import { driftSpeech, isoNudgeSpeech, STEER_RISK_PLAIN_SPEECH, steerRiskSpeech } from "../../../lib/talkPlanWords";
import { afterLead, failure, HELD_SEND, NUDGES, opened, result, type Script, settle, turnLine } from "./harness";
import { AFTER_RETRO_MS, DRIFT, driftSpeechRequest, ISO_NUDGE, RETRO } from "./notices";

// The owner wants to be told when what they are doing drifts from what they said they would do.
describe("WindowNoticeLines.announceDrift", () => {
  it("has the voice say the fixed line once on a clear floor, and answers a second post as already said", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    expect([
      await afterLead({ clock: h.clock, line: h.call.windowNotices.announceDrift({ notice: DRIFT }) }),
      await h.call.windowNotices.announceDrift({ notice: DRIFT }),
    ]).toEqual([{ kind: "said" }, { kind: "already" }]);
    expect(h.written.slice(before)).toEqual([driftSpeechRequest({ id: 5 })]);
    expect(driftSpeech({ app: DRIFT.app, minutes: DRIFT.minutes, plan: DRIFT.plan })).toBe(
      "By the way, you said you'd do the ISO access review, but you've been in Slack for 4 minutes.",
    );
  });

  it("never cuts in: while the owner talks it is refused and writes nothing, so the page retries it", async () => {
    const h = await opened({ script: NUDGES });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({
      kind: "refused",
      reason: "someone is talking",
    });
    expect(h.written.length).toBe(before);
  });

  it("waits while a Codex turn works on the owner's words", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({
      kind: "refused",
      reason: "a Codex turn is still working on the owner's words",
    });
  });

  it("holds a started meeting's cut-in while a drift line is being sent, so the two never overlap", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    void h.call.windowNotices.announceDrift({ notice: DRIFT });
    expect(await h.call.announceMeeting({ notice: RETRO, nowMs: AFTER_RETRO_MS })).toEqual({
      kind: "refused",
      reason: "a drift line, an ISO nudge or a steer-risk line is being sent",
    });
  });

  it("waits out the gap after its own line is taken, since the voice says it seconds later", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await afterLead({ clock: h.clock, line: h.call.windowNotices.announceDrift({ notice: DRIFT }) })).toEqual({
      kind: "said",
    });
    const next = { ...DRIFT, noticeId: "drift-2" };
    expect(await h.call.windowNotices.announceDrift({ notice: next })).toEqual({
      kind: "refused",
      reason: "one of its own lines was just handed over",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect(await afterLead({ clock: h.clock, line: h.call.windowNotices.announceDrift({ notice: next }) })).toEqual({
      kind: "said",
    });
  });

  it("starts that gap when the session takes a slow look line, not when it was written", async () => {
    const slow = { answer: (): void => undefined };
    const take = result({});
    const script: Script = {
      ...NUDGES,
      "thread/realtime/appendSpeech": (input) => {
        slow.answer();
        return take(input);
      },
    };
    const h = await opened({ script });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    slow.answer = () => h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("said");
    slow.answer = () => undefined;
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({
      kind: "refused",
      reason: "one of its own lines was just handed over",
    });
  });

  it("starts that gap when a look line times out, since its late answer may still be the session taking it", async () => {
    const speech = { answers: false };
    const take = result({});
    const script: Script = {
      ...NUDGES,
      "thread/realtime/appendSpeech": (input) => (speech.answers ? take(input) : undefined),
    };
    const h = await opened({ script });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const looking = h.call.sayLooking({ ask: "look" });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    expect((await looking).kind).toBe("failed");
    speech.answers = true;
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({
      kind: "refused",
      reason: "one of its own lines was just handed over",
    });
  });

  it("waits out the same gap after a send outcome is taken, since the voice has not said it yet", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await afterLead({ clock: h.clock, line: h.call.announceSendOutcome(HELD_SEND) })).toEqual({ kind: "said" });
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({
      kind: "refused",
      reason: "one of its own lines was just handed over",
    });
  });

  it("waits while a send outcome is still being handed over, writing nothing over it", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendText": () => undefined } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    void h.call.announceSendOutcome(HELD_SEND);
    const before = h.written.length;
    expect(await h.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({
      kind: "refused",
      reason: "a send outcome or another own line is being handed over",
    });
    expect(h.written.length).toBe(before);
  });

  it("says the session would not take it, and never says it again, since a write that failed may have landed", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect([
      await afterLead({ clock: h.clock, line: h.call.windowNotices.announceDrift({ notice: DRIFT }) }),
      await h.call.windowNotices.announceDrift({ notice: DRIFT }),
    ]).toEqual([{ kind: "failed", reason: "the voice did not say the drift line: no session" }, { kind: "already" }]);
  });

  it("answers a fresh call after a rollover as already said, writing nothing, when the old call said it", async () => {
    const notices = new TalkNoticeLedger();
    const old = await opened({ notices, script: NUDGES });
    old.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(
      await afterLead({ clock: old.clock, line: old.call.windowNotices.announceDrift({ notice: DRIFT }) }),
    ).toEqual({
      kind: "said",
    });
    const fresh = await opened({ notices, script: NUDGES });
    const before = fresh.written.length;
    expect(await fresh.call.windowNotices.announceDrift({ notice: DRIFT })).toEqual({ kind: "already" });
    expect(fresh.written.length).toBe(before);
  });
});

/** The speech request an ISO nudge writes, under its RPC id. */
const isoNudgeSpeechRequest = ({ id, notice }: { id: number; notice: IsoNudgeNotice }) => ({
  id,
  method: "thread/realtime/appendSpeech",
  params: {
    text: isoNudgeSpeech({ again: notice.again, item: notice.item.subject, minutes: notice.minutes }),
    threadId: "thread-1",
  },
});

// The owner wants a reminder that the ISO work still has items waiting on them, naming one concrete item, as an
// observation and never an instruction.
describe("WindowNoticeLines.announceIsoNudge", () => {
  it("says the observation naming the one card once on a clear floor, and answers a second post as already said", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    expect([
      await afterLead({ clock: h.clock, line: h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }) }),
      await h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }),
    ]).toEqual([{ kind: "said" }, { kind: "already" }]);
    expect(h.written.slice(before)).toEqual([isoNudgeSpeechRequest({ id: 5, notice: ISO_NUDGE })]);
  });

  it("holds the hour between nudges itself: a fresh id a page mints after losing its watch is already said", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    const first = await afterLead({
      clock: h.clock,
      line: h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }),
    });
    h.clock.advance({ ms: 10_000 });
    const reloaded = await h.call.windowNotices.announceIsoNudge({
      notice: { ...ISO_NUDGE, noticeId: "after-a-reload" },
    });
    expect([first, reloaded]).toEqual([{ kind: "said" }, { kind: "already" }]);
    expect(h.written.slice(before)).toEqual([isoNudgeSpeechRequest({ id: 5, notice: ISO_NUDGE })]);
  });

  it("words the first and the second nudge as observations naming the card, never an instruction", () => {
    expect(isoNudgeSpeech({ again: false, item: ISO_NUDGE.item.subject, minutes: 12 })).toBe(
      `Just so you know, you've been on other things for 12 minutes, and the ISO card "Six Vanta evidence documents need an update" is still waiting on you.`,
    );
    expect(isoNudgeSpeech({ again: true, item: ISO_NUDGE.item.subject, minutes: 75 })).toBe(
      `Just so you know, you're still on other things, 75 minutes now, and the ISO card "Six Vanta evidence documents need an update" is still waiting on you.`,
    );
  });

  it("never cuts in: while the owner talks it is refused and writes nothing, so the page retries it", async () => {
    const h = await opened({ script: NUDGES });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect(await h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE })).toEqual({
      kind: "refused",
      reason: "someone is talking",
    });
    expect(h.written.length).toBe(before);
  });

  it("waits while a drift line is being said, so the two window notices never overlap", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    void h.call.windowNotices.announceDrift({ notice: DRIFT });
    expect(await h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE })).toEqual({
      kind: "refused",
      reason: "a drift line, an ISO nudge or a steer-risk line is being said",
    });
  });

  it("keeps a drift and a nudge sharing one notice id apart: each is said once", async () => {
    const h = await opened({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const drift = h.call.windowNotices.announceDrift({ notice: { ...DRIFT, noticeId: "shared-1" } });
    expect(await afterLead({ clock: h.clock, line: drift })).toEqual({ kind: "said" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    const nudge = h.call.windowNotices.announceIsoNudge({ notice: { ...ISO_NUDGE, noticeId: "shared-1" } });
    expect(await afterLead({ clock: h.clock, line: nudge })).toEqual({ kind: "said" });
  });

  it("says the session would not take it, and never says it again, since a write that failed may have landed", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect([
      await afterLead({ clock: h.clock, line: h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }) }),
      await h.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE }),
    ]).toEqual([{ kind: "failed", reason: "the voice did not say the ISO nudge: no session" }, { kind: "already" }]);
  });

  it("answers a fresh call after a rollover as already said, writing nothing, when the old call said it", async () => {
    const notices = new TalkNoticeLedger();
    const old = await opened({ notices, script: NUDGES });
    old.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const line = old.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE });
    expect(await afterLead({ clock: old.clock, line })).toEqual({ kind: "said" });
    const fresh = await opened({ notices, script: NUDGES });
    const before = fresh.written.length;
    expect(await fresh.call.windowNotices.announceIsoNudge({ notice: ISO_NUDGE })).toEqual({ kind: "already" });
    expect(fresh.written.length).toBe(before);
  });
});

/** A steered deliverable at risk, as `talk steer-risk` reads the open steer note. */
const STEER_RISK: SteerRiskNotice = {
  stepId: "mon-steer-sup-4293-1a2b3c",
  what: "Your steered sup-4293 is at risk",
  why: "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
};

/** The speech request a steer-risk line writes, under its RPC id. */
const steerRiskSpeechRequest = ({ id }: { id: number }) => ({
  id,
  method: "thread/realtime/appendSpeech",
  params: { text: steerRiskSpeech({ what: STEER_RISK.what, why: STEER_RISK.why }), threadId: "thread-1" },
});

// A steered deliverable at risk gets a floating note and a voice cut-in the minute it is known.
describe("WindowNoticeLines.announceSteerRisk", () => {
  it("cuts in while the owner talks and a Codex turn runs, and answers a second post as already said", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect([
      await afterLead({ clock: h.clock, line: h.call.windowNotices.announceSteerRisk({ notice: STEER_RISK }) }),
      await h.call.windowNotices.announceSteerRisk({ notice: STEER_RISK }),
    ]).toEqual([{ kind: "said" }, { kind: "already" }]);
    expect(h.written.slice(before)).toEqual([steerRiskSpeechRequest({ id: 5 })]);
    expect(steerRiskSpeech({ what: STEER_RISK.what, why: STEER_RISK.why })).toBe(
      "Sorry to cut in. Your steered sup-4293 is at risk: its seat closed until 2026-10-22T04:50:00Z, so nobody is " +
        "working it. The note is on your screen if you want to steer it.",
    );
  });

  // Measured: a cut-in said "The fleet's still on it" over a row stopped on a question to the owner.
  it("says a row stopped on the owner's question waits on them, and never that the fleet is on it", () => {
    expect(
      steerRiskSpeech({
        what: "Your steered vulnfix-top-up is at risk",
        why: "waiting on you: storybook needs one named approver — A, B or C? — answer it on your Queue",
      }),
    ).toBe(
      "Sorry to cut in. Your steered vulnfix-top-up is at risk: waiting on you: storybook needs one named approver " +
        "— A, B or C? — answer it on your Queue. The note is on your screen if you want to steer it.",
    );
  });

  // The voice can read a row's slug as a claim that something was posted, when nothing was.
  it("cuts in with the plain line, naming no row, when the note's words could be heard as the thing done", async () => {
    const h = await opened({ script: NUDGES });
    const notice: SteerRiskNotice = {
      stepId: "mon-steer-vulnfix-top-up-4d5e6f",
      what: "Your steered vulnfix-top-up-for-acme-admin-posted-in is at risk",
      why: "it was due by 2026-10-26T22:00:00Z and nothing is on record yet",
    };
    const before = h.written.length;
    expect(await afterLead({ clock: h.clock, line: h.call.windowNotices.announceSteerRisk({ notice }) })).toEqual({
      kind: "said",
    });
    expect(h.written.slice(before).map((message) => message["params"])).toEqual([
      { text: STEER_RISK_PLAIN_SPEECH, threadId: "thread-1" },
    ]);
  });

  it("waits while a drift line is being sent, so it never talks over another of this server's lines", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    void h.call.windowNotices.announceDrift({ notice: DRIFT });
    expect(await h.call.windowNotices.announceSteerRisk({ notice: STEER_RISK })).toEqual({
      kind: "refused",
      reason: "a drift line, an ISO nudge or a steer-risk line is being sent",
    });
  });

  it("answers a fresh call after a rollover as already said, writing nothing, when the old call said it", async () => {
    const notices = new TalkNoticeLedger();
    const old = await opened({ notices, script: NUDGES });
    const line = old.call.windowNotices.announceSteerRisk({ notice: STEER_RISK });
    expect(await afterLead({ clock: old.clock, line })).toEqual({ kind: "said" });
    const fresh = await opened({ notices, script: NUDGES });
    const before = fresh.written.length;
    expect(await fresh.call.windowNotices.announceSteerRisk({ notice: STEER_RISK })).toEqual({ kind: "already" });
    expect(fresh.written.length).toBe(before);
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: NUDGES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.windowNotices.announceSteerRisk({ notice: STEER_RISK })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});
