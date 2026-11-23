/**
 * `PlanCall.resume` and `PlanCall.typeIn`.
 */

import { describe, expect, it } from "vitest";
import { PLAN_CALL_LIMITS, type SequencedEvent } from "../../../lib/planCallContract";
import { RESUME_OVER_TURN_TEXT } from "../../../lib/talkPlanResumeOverTurn";
import { TYPED_IN_ATTACHMENT_KICK_TEXT, TYPED_IN_KICK_TEXT } from "../../../lib/talkPlanTypedIn";
import { RESUME_TEXT } from "../../../lib/talkPlanWords";
import {
  appendsAfter,
  eventsOf,
  failure,
  opened,
  PASTED,
  RESUMES,
  result,
  type Script,
  settle,
  TOOL_REQUEST,
  transcriptLine,
  triageRequest,
  turnLine,
} from "./harness";

// After a steer the owner expects the conversation to move onto the next thing, so the console resumes it.
describe("PlanCall.resume", () => {
  it("hands the voice the fixed sentence as a developer message, speaking nothing itself", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    expect(h.written.slice(before)).toEqual([
      {
        id: 5,
        method: "thread/realtime/appendText",
        params: { role: "developer", text: RESUME_TEXT, threadId: "thread-1" },
      },
    ]);
    expect(RESUME_TEXT).toBe(
      "The owner has stopped talking and nothing has answered them. The thinking model is answering them now. Say only a few " +
        "words to show you heard them, such as 'Mm-hm.' or 'On it.', and nothing else: no answer, no card, no item and " +
        "no next step, since what the thinking model hands back is the answer. Never hand the floor back to the owner: no " +
        "'go ahead', 'keep going', 'I'm here' or 'I'm listening'. Never hand anything to the thinking model " +
        "yourself: the console does.",
    );
  });

  // A sentence inviting the voice to take its own turn can draw an answer naming a card that never existed. The
  // sentence that invited a turn of the voice's own is gone, whatever else the text says.
  it("never invites the voice to answer or go on to the next thing itself", () => {
    expect([RESUME_TEXT.includes("Take your turn"), RESUME_TEXT.includes("answer what they last said")]).toEqual([
      false,
      false,
    ]);
  });

  /** One realtime transcript line of either side's, on this call's thread. */
  const said = ({ role }: { role: "user" | "assistant" }): string =>
    `${JSON.stringify({ method: "thread/realtime/transcript/done", params: { role, text: "Go on", threadId: "thread-1" } })}\n`;
  /** One fragment of the owner's speech as it is transcribed, carrying `delta`: blank for no words at all. */
  const talked = ({ delta = "Go on" }: { delta?: string } = {}): string =>
    `${JSON.stringify({ method: "thread/realtime/transcript/delta", params: { delta, role: "user", threadId: "thread-1" } })}\n`;
  /** The refusal while a running Codex turn holds the resume, worded exactly as the server words it. */
  const TURN_HOLDS = { kind: "refused", reason: "a Codex turn is still working on the owner's words" } as const;

  it("refuses a second resume inside the gap, writing nothing, and sends one again once it passes", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.resume();
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "it was asked to take its turn a moment ago" });
    expect(h.written.length).toBe(before);
    h.clock.advance({ ms: 1 });
    h.call.receive({ chunk: said({ role: "user" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeGapMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  // Past the gap, with nothing new from the owner, it is still the same silence.
  it("never resumes one silence twice: past the gap it needs the owner's words since, the voice's are not enough", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.resume();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeGapMs });
    const before = h.written.length;
    const reason = "the owner has said nothing since it was last asked to take its turn";
    expect(await h.call.resume()).toEqual({ kind: "refused", reason });
    h.call.receive({ chunk: said({ role: "assistant" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason });
    expect(h.written.length).toBe(before);
    h.call.receive({ chunk: said({ role: "user" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  it("refuses while a resume is still being sent, even past the gap", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    void h.call.resume();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeGapMs });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "it was asked to take its turn a moment ago" });
  });

  it("refuses while a Codex turn works on the owner's words, and just after one ended, until the settle passes", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    expect(await h.call.resume()).toEqual(TURN_HOLDS);
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    expect(await h.call.resume()).toEqual({
      kind: "refused",
      reason: "Codex just finished, and the voice is about to answer",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeSettleMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  // A turn that began on the owner's steer never heard their next words when those went quiet unclosed, so a resume
  // must not be refused as `TURN_HOLDS` on its account.
  it("goes over a turn that began before the owner's latest words, acknowledging only, and starts no second turn", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    // Past the "on it" acknowledgement the turn's start draws.
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    h.call.receive({ chunk: talked() });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs });
    await settle();
    expect(h.written.slice(before).map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: "thread/realtime/appendText",
        params: { role: "developer", text: RESUME_OVER_TURN_TEXT, threadId: "thread-1" },
      },
    ]);
  });

  it("still refuses over a turn that began after the owner's latest words", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: talked() });
    h.clock.advance({ ms: 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs + PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual(TURN_HOLDS);
  });

  // A newer turn that already completed is not running, so its later start never holds the resume.
  it("goes over the older turn still running once a newer one begun after the owner's words has completed", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-old" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    h.call.receive({ chunk: talked() });
    h.clock.advance({ ms: 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-new" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-new" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs + PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  // A blank fragment after the acknowledgement is no new words, so none is said again.
  it("refuses a second resume over the same turn when only a blank transcript of the owner's follows the first", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    h.call.receive({ chunk: talked() });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.owedTurnStartMs + PLAN_CALL_LIMITS.resumeGapMs });
    await settle();
    h.call.receive({ chunk: talked({ delta: " " }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual(TURN_HOLDS);
  });

  // A typed line is no speech, as the page's `lastTranscribedMs` reads it.
  it("still refuses over a turn that only a typed line of the owner's followed", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    await h.call.typeIn({ messageId: "m-1", text: "continue" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs + PLAN_CALL_LIMITS.resumeQuietMs });
    await settle();
    expect(await h.call.resume()).toEqual(TURN_HOLDS);
  });

  // A blank fragment is no words, and the `done` repeating words the turn started on is not new ones, so neither
  // makes that turn read as begun before them.
  it("still refuses when only a blank fragment or the owner's repeating final follows the turn's start", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: talked() });
    h.clock.advance({ ms: 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    h.call.receive({ chunk: talked({ delta: " " }) });
    h.call.receive({ chunk: said({ role: "user" }) });
    const unmet = {
      method: "thread/realtime/transcript/partial",
      params: { delta: "hi", role: "user", threadId: "thread-1" },
    };
    h.call.receive({ chunk: `${JSON.stringify(unmet)}\n` });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs });
    expect(await h.call.resume()).toEqual(TURN_HOLDS);
  });

  // The page judges the silence, then someone can speak before its post arrives.
  it("refuses while either side was just transcribed, and sends once the quiet passes", async () => {
    const h = await opened({ script: RESUMES });
    const transcript = ({ method, threadId }: { method: string; threadId: string }): string =>
      `${JSON.stringify({ method, params: { delta: "Go on", threadId } })}\n`;
    h.call.receive({ chunk: transcript({ method: "thread/realtime/transcript/delta", threadId: "thread-1" }) });
    const before = h.written.length;
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "someone is talking" });
    expect(h.written.length).toBe(before);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs - 1 });
    h.call.receive({ chunk: transcript({ method: "thread/realtime/transcript/done", threadId: "thread-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs - 1 });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "someone is talking" });
    h.clock.advance({ ms: 1 });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  it("is not held by another thread's transcript", async () => {
    const h = await opened({ script: RESUMES });
    const other = { method: "thread/realtime/transcript/delta", params: { delta: "hi", threadId: "thread-2" } };
    h.call.receive({ chunk: `${JSON.stringify(other)}\n` });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  it("refuses while a tool call waits on the page", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: TOOL_REQUEST });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "a tool call is still running" });
  });

  it("refuses just after a nudge, until its gap passes — the owner's press is the answer to that silence", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.nudge({ promised: false });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "a nudge is being said" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeGapMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  it("refuses just after a look line, which the voice has not said yet", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.sayLooking({ ask: "find" });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "a look line is being said" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
  });

  it("leaves the owner's nudge free to go ahead straight after a resume", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.resume();
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
  });

  it("says the session would not take it, rather than claiming it was sent", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": failure("no session") } });
    expect(await h.call.resume()).toEqual({
      kind: "failed",
      reason: "the voice was not asked to take its turn: no session",
    });
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: RESUMES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.resume()).toEqual({ kind: "refused", reason: "the call has ended: the owner hung up" });
  });
});

/** The line the page types in for a file the owner attached in the Messenger, its path made synthetic. */
const ATTACHED_LINE =
  '[Attached: "brief.md", a text file of 2.8 KB, saved at "/home/acme/brief.md". Read it with file_read.]';

/** The typed-in events a subscriber saw. */
const typedInsOf = ({ seen }: { seen: readonly SequencedEvent[] }) =>
  eventsOf({ seen }).filter((event) => event.kind === "typed-in");

// A Slack thread link pasted into the box mid-call needs a way to be sent.
describe("PlanCall.typeIn", () => {
  it("hands the voice the owner's words verbatim as a user item, and streams them back as their typed turn", async () => {
    const h = await opened({ script: RESUMES });
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    const before = h.written.length;
    expect(await h.call.typeIn({ messageId: "m-1", text: PASTED })).toEqual({ kind: "sent" });
    expect(h.written.slice(before)).toEqual([
      { id: 5, method: "thread/realtime/appendText", params: { role: "user", text: PASTED, threadId: "thread-1" } },
    ]);
    expect(typedInsOf({ seen })).toEqual([{ kind: "typed-in", messageId: "m-1", text: PASTED }]);
  });

  it("answers a retry of one message as already handed over, writing it once", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    expect(await h.call.typeIn({ messageId: "m-1", text: PASTED })).toEqual({ kind: "already" });
    expect(appendsAfter({ before, h })).toEqual([{ role: "user", text: PASTED, threadId: "thread-1" }]);
  });

  it("hands the voice the fixed answer-it line once the window passes with only silence, and not before", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs - 1 });
    expect(appendsAfter({ before, h })).toHaveLength(1);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([
      { role: "user", text: PASTED, threadId: "thread-1" },
      { role: "developer", text: TYPED_IN_KICK_TEXT, threadId: "thread-1" },
    ]);
    expect(TYPED_IN_KICK_TEXT).toContain("hand it to the thinking model to read the whole thread with slack_open");
    expect(TYPED_IN_KICK_TEXT).toContain("If it carries an [Attached: …] line, hand it to the thinking model to read");
  });

  it("hands nothing more when the voice answers inside the window, or a Codex turn starts on it", async () => {
    const spoke = await opened({ script: RESUMES });
    const spokeBefore = spoke.written.length;
    await spoke.call.typeIn({ messageId: "m-1", text: PASTED });
    spoke.clock.advance({ ms: 1 });
    spoke.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    spoke.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    const worked = await opened({ script: RESUMES });
    const workedBefore = worked.written.length;
    await worked.call.typeIn({ messageId: "m-1", text: PASTED });
    worked.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    worked.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect([
      appendsAfter({ before: spokeBefore, h: spoke }).length,
      appendsAfter({ before: workedBefore, h: worked }).length,
    ]).toEqual([1, 1]);
  });

  // An attachment that meets a wordless "." from the voice must not leave the file unread.
  it("hands the attachment line when the voice's only answer to the owner's attachment was a wordless '.'", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    await h.call.typeIn({ messageId: "m-1", text: ATTACHED_LINE });
    h.clock.advance({ ms: 1 });
    for (const [method, params] of [
      ["thread/realtime/transcript/delta", { delta: ".", role: "assistant", threadId: "thread-1" }],
      ["thread/realtime/transcript/done", { role: "assistant", text: ".", threadId: "thread-1" }],
    ] as const) {
      h.call.receive({ chunk: `${JSON.stringify({ method, params })}\n` });
    }
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([
      { role: "user", text: ATTACHED_LINE, threadId: "thread-1" },
      { role: "developer", text: TYPED_IN_ATTACHMENT_KICK_TEXT, threadId: "thread-1" },
    ]);
  });

  it("kicks a plain typed turn met by a wordless voice line, and not one met by a worded `done` alone", async () => {
    const run = async ({ text }: { text: string }) => {
      const h = await opened({ script: RESUMES });
      const before = h.written.length;
      await h.call.typeIn({ messageId: "m-1", text: PASTED });
      h.clock.advance({ ms: 1 });
      const params = { role: "assistant", text, threadId: "thread-1" };
      h.call.receive({ chunk: `${JSON.stringify({ method: "thread/realtime/transcript/done", params })}\n` });
      h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
      await settle();
      return appendsAfter({ before, h }).length;
    };
    expect([await run({ text: "." }), await run({ text: "Sure." })]).toEqual([2, 1]);
  });

  it("hands nothing more once a file_read call arrived for the owner's attachment and the voice answered in words", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    await h.call.typeIn({ messageId: "m-1", text: ATTACHED_LINE });
    h.clock.advance({ ms: 1 });
    h.call.receive({ chunk: triageRequest({ args: { path: "/home/acme/brief.md" }, id: 900, tool: "file_read" }) });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([{ role: "user", text: ATTACHED_LINE, threadId: "thread-1" }]);
  });

  it("takes a second message inside the first's window, and kicks once, at the end of the second's", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    h.clock.advance({ ms: 1_000 });
    expect(await h.call.typeIn({ messageId: "m-2", text: "what does it say?" })).toEqual({ kind: "sent" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs - 1_000 });
    await settle();
    expect(appendsAfter({ before, h })).toHaveLength(2);
    h.clock.advance({ ms: 1_000 });
    await settle();
    expect(appendsAfter({ before, h }).map((params) => (params as { role: string }).role)).toEqual([
      "user",
      "user",
      "developer",
    ]);
  });

  it("kicks nothing as the first window ends while a second message is still being written", async () => {
    let appends = 0;
    const holdsTheSecond: Script["x"] = (input) => {
      appends += 1;
      return appends === 1 ? result({})(input) : undefined;
    };
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": holdsTheSecond } });
    const before = h.written.length;
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs - 1 });
    const second = h.call.typeIn({ messageId: "m-2", text: "what does it say?" });
    h.clock.advance({ ms: 1 });
    await settle();
    expect(appendsAfter({ before, h })).toHaveLength(2);
    h.call.receive({ chunk: `${JSON.stringify({ id: h.written.at(-1)!["id"], result: {} })}\n` });
    expect(await second).toEqual({ kind: "sent" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect(appendsAfter({ before, h }).map((params) => (params as { role: string }).role)).toEqual([
      "user",
      "user",
      "developer",
    ]);
  });

  it("refuses the owner's next message, writing nothing, while the last one's kick is still being written", async () => {
    let appends = 0;
    const holdsTheKick: Script["x"] = (input) => {
      appends += 1;
      return appends === 1 ? result({})(input) : undefined;
    };
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": holdsTheKick } });
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    const before = h.written.length;
    expect(await h.call.typeIn({ messageId: "m-2", text: "what does it say?" })).toEqual({
      kind: "refused",
      reason: "the owner's typed turn is being handed to the voice",
    });
    expect(h.written.length).toBe(before);
  });

  it("holds every other line of the server's own off until the window ends, so none lands between", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    const held = "the owner's typed turn is being handed to the voice";
    expect([await h.call.nudge({ promised: false }), await h.call.sayLooking({ ask: "look" })]).toEqual([
      { kind: "refused", reason: held },
      { kind: "refused", reason: held },
    ]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
  });

  it("refuses, writing nothing, while another of the server's own writes is out", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    void h.call.resume();
    const before = h.written.length;
    expect(await h.call.typeIn({ messageId: "m-1", text: PASTED })).toEqual({
      kind: "refused",
      reason: "it is being asked to take its turn",
    });
    expect(h.written.length).toBe(before);
  });

  it("says the session would not take it, and answers a retry the same without writing it again", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": failure("no session") } });
    const before = h.written.length;
    const failed = { kind: "failed", reason: "the voice was not handed the owner's message: no session" };
    expect([
      await h.call.typeIn({ messageId: "m-1", text: PASTED }),
      await h.call.typeIn({ messageId: "m-1", text: PASTED }),
    ]).toEqual([failed, failed]);
    expect(appendsAfter({ before, h })).toHaveLength(1);
  });

  it("calls a write with no answer in time unsure, streams it back once as the owner's turn, and kicks nothing", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    const before = h.written.length;
    const typed = h.call.typeIn({ messageId: "m-1", text: PASTED });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    expect((await typed).kind).toBe("unsure");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect(typedInsOf({ seen })).toEqual([{ kind: "typed-in", messageId: "m-1", text: PASTED }]);
    expect(appendsAfter({ before, h })).toEqual([{ role: "user", text: PASTED, threadId: "thread-1" }]);
  });

  it("streams a message still being written as the owner's turn before the close when the call ends, and calls it unsure", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    const typed = h.call.typeIn({ messageId: "m-1", text: PASTED });
    h.call.stop({ reason: "the owner hung up" });
    expect((await typed).kind).toBe("unsure");
    expect(
      eventsOf({ seen })
        .filter((event) => event.kind === "typed-in" || event.kind === "closed")
        .map((event) => event.kind),
    ).toEqual(["typed-in", "closed"]);
  });

  it("refuses once the call has ended, and kicks nothing for a turn taken before it ended", async () => {
    const h = await opened({ script: RESUMES });
    await h.call.typeIn({ messageId: "m-1", text: PASTED });
    const before = h.written.length;
    h.call.stop({ reason: "the owner hung up" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.typedInKickMs });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([]);
    expect(await h.call.typeIn({ messageId: "m-2", text: PASTED })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });
});
