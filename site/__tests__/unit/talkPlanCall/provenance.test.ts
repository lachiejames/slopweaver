/**
 * `PlanCall.recordGrounding`, the provenance the spoken record carries, and `PlanCall.notifyRunningListChanged`.
 */

import { describe, expect, it } from "vitest";
import { ANNOUNCE_LEAD_MS } from "../../../lib/announceCue";
import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import { RUNNING_LIST_CHANGED_TEXT } from "../../../lib/talkPlanListNotice";
import { steerSpokenRecord } from "../../../lib/talkPlanSteer";
import { RESUME_TEXT } from "../../../lib/talkPlanWords";
import {
  MAX_PROVENANCE_ENTRIES,
  NO_PROVENANCE,
  VOICE_PROVENANCE_AFTER,
  VOICE_PROVENANCE_BEFORE,
  type VoiceProvenanceEntry,
  VoiceProvenanceLedger,
  voiceProvenanceText,
} from "../../../lib/talkVoiceProvenance";
import { spokenRecordText } from "../../../lib/talkVoiceRecord";
import {
  failure,
  HELD_SEND,
  heardDoneLine,
  opened,
  RESUMES,
  result,
  SAID,
  settle,
  transcriptLine,
  turnLine,
} from "./harness";

/** A spoken count of fourteen, as the route keeps it once the page finds the app does not show it. */
const FOURTEEN = {
  key: "voice-seg-7",
  source: "count-grounding",
  text: "That covers fourteen cards.",
  why: "the app showed Everything 29",
} as const;

/** A spoken "posted", as the route keeps it once the page finds nothing on the call said it was posted. */
const POSTED = {
  key: "voice-seg-3:0",
  source: "claim-grounding",
  text: "the voice said something was posted",
  why: "nothing the thinking model wrote said it was posted",
} as const;

// A correction the voice is told to make and not discuss is itself a line out of nowhere, so a count or a pull request
// number is kept for the thread and never handed to the voice. A done claim is the one exception: its correction is a
// fixed line said once, never words of its own.
describe("PlanCall.recordGrounding", () => {
  it("has the voice say a done claim's fixed correction once, a poll after it is owed, and a repeat nothing", async () => {
    const h = await opened({ script: RESUMES });
    const before = h.written.length;
    expect([
      h.call.recordGrounding({ post: POSTED }),
      h.call.corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: POSTED.key }),
      h.call.corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: POSTED.key }),
    ]).toEqual([{ kind: "recorded" }, undefined, "that claim is already owed a correction"]);
    const owedOnly = h.written.length - before;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs * 8 });
    await settle();
    expect(owedOnly).toBe(0);
    expect(h.written.slice(before).map((message) => [message["method"], message["params"]])).toEqual([
      [
        "thread/realtime/appendSpeech",
        { text: "Correction: nothing on record shows anything was posted.", threadId: "thread-1" },
      ],
    ]);
  });

  it("holds the correction while the owner's utterance is open, and says it once they have finished", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    const before = h.written.length;
    h.call.corrections.owe({ claim: { act: "posted", kind: "outcome" }, key: POSTED.key });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs * 4 });
    await settle();
    const whileOpen = h.written.length - before;
    h.call.receive({ chunk: heardDoneLine({ text: "so" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.resumeQuietMs + PLAN_CALL_LIMITS.rolloverPollMs * 2 });
    await settle();
    expect([whileOpen, h.written.slice(before).map((message) => message["method"])]).toEqual([
      0,
      ["thread/realtime/appendSpeech"],
    ]);
  });

  it("keeps a grounding once per key and source, writing nothing to the child with no turn running", async () => {
    const h = await opened({ script: RESUMES });
    const delta = { method: "thread/realtime/transcript/delta", params: { delta: "and", threadId: "thread-1" } };
    h.call.receive({ chunk: `${JSON.stringify(delta)}\n` });
    const before = h.written.length;
    expect([
      h.call.recordGrounding({ post: FOURTEEN }),
      h.call.recordGrounding({ post: FOURTEEN }),
      h.call.recordGrounding({ post: { ...FOURTEEN, source: "claim-grounding" } }),
    ]).toEqual([{ kind: "recorded" }, { kind: "already" }, { kind: "recorded" }]);
    await settle();
    expect(h.written.slice(before)).toEqual([]);
  });

  // The page cannot know when a post whose answer it lost was kept, so the call steers what it keeps.
  it("steers each grounding it keeps into the running turn itself, one kept mid-steer once that steer is answered", async () => {
    const h = await opened({ script: { ...RESUMES, "turn/steer": result({ turnId: "t-1" }) } });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    h.call.recordGrounding({ post: FOURTEEN });
    h.call.recordGrounding({ post: FOURTEEN });
    h.call.recordGrounding({ post: { ...FOURTEEN, source: "claim-grounding" } });
    await settle();
    expect(h.written.slice(before).map((message) => message["method"])).toEqual(["turn/steer", "turn/steer"]);
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text })!.map(({ source }) => source))).toEqual([
      ["count-grounding"],
      ["claim-grounding"],
    ]);
  });

  it("offers a grounding kept while the page's record is out once that record is answered", async () => {
    const h = await opened({ script: { ...RESUMES, "turn/steer": result({ turnId: "t-1" }) } });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const steering = h.call.steerSpokenRecord({ record: { lines: SAID, openCard: undefined, turnId: "t-1" } });
    h.call.recordGrounding({ post: FOURTEEN });
    expect(await steering).toEqual({ kind: "steered", turnId: "t-1" });
    await settle();
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text })?.length)).toEqual([undefined, 1]);
  });

  // A grounding whose turn completed before taking it must not wait for a page post the next turn never makes.
  it("steers a grounding still owed into the next turn as it starts, with no post from the page", async () => {
    const h = await opened({ script: { ...RESUMES, "turn/steer": result({ turnId: "t-2" }) } });
    h.call.recordGrounding({ post: FOURTEEN });
    expect(steerTextsOf({ h })).toEqual([]);
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    await settle();
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text })?.length)).toEqual([1]);
  });

  // A turn starting while the call's offer is out sees nothing owed, and the offer may then fail.
  it("offers a grounding to a turn that started while its offer to an older one was out, once that offer fails", async () => {
    let steers = 0;
    const h = await opened({
      script: {
        ...RESUMES,
        "turn/steer": ({ id }) => {
          steers += 1;
          return steers === 1 ? failure("turn t-1 is not active")({ id }) : result({ turnId: "t-2" })({ id });
        },
      },
    });
    h.call.recordGrounding({ post: FOURTEEN });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    await settle();
    const targets = h.written
      .filter((message) => message["method"] === "turn/steer")
      .map((message) => (message["params"] as { expectedTurnId: string }).expectedTurnId);
    expect(targets).toEqual(["t-1", "t-2"]);
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text })?.length)).toEqual([1, 1]);
  });

  it("refuses once the call has ended, writing nothing past the stop", async () => {
    const h = await opened({ script: RESUMES });
    h.call.stop({ reason: "the owner hung up" });
    const before = h.written.length;
    expect(h.call.recordGrounding({ post: FOURTEEN })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
    expect(h.written.slice(before)).toEqual([]);
  });
});

describe("PlanCall.notifyRunningListChanged", () => {
  it("hands the voice exactly one developer message, the fixed sentence and nothing the owner added", async () => {
    const h = await opened({ script: RESUMES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    expect(await h.call.notifyRunningListChanged()).toBe(undefined);
    expect(h.written.slice(before)).toEqual([
      {
        id: 5,
        method: "thread/realtime/appendText",
        params: {
          role: "developer",
          text: "the owner put something in the running list; read it with running_list",
          threadId: "thread-1",
        },
      },
    ]);
    expect(RUNNING_LIST_CHANGED_TEXT).toBe("the owner put something in the running list; read it with running_list");
  });

  it("owes a second notice while the first is out, and sends exactly one more once the first is answered", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    const before = h.written.length;
    void h.call.notifyRunningListChanged();
    expect([await h.call.notifyRunningListChanged(), await h.call.notifyRunningListChanged()]).toEqual([
      "a running-list notice is already being handed over; one more follows it for this add",
      "a running-list notice is already being handed over; one more follows it for this add",
    ]);
    expect(h.written.length - before).toBe(1);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
    expect(h.written.slice(before).map((line) => line.method)).toEqual([
      "thread/realtime/appendText",
      "thread/realtime/appendText",
    ]);
  });

  // An add while another of the call's own writes is out is stored, and the call must still be told.
  it("owes a notice another of its own writes holds, and hands it over once that write is answered", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    // The outcome's line written and left unanswered, so the write holds the floor until it times out.
    void h.call.announceSendOutcome(HELD_SEND);
    await settle();
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    await settle();
    const before = h.written.length;
    expect(await h.call.notifyRunningListChanged()).toBe(
      "a send outcome is being handed over; the notice is owed and goes once that clears",
    );
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
    expect(h.written.length).toBe(before);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
    expect(h.written.slice(before)).toEqual([
      {
        id: 6,
        method: "thread/realtime/appendText",
        params: { role: "developer", text: RUNNING_LIST_CHANGED_TEXT, threadId: "thread-1" },
      },
    ]);
  });

  it("drops an owed notice when the call ends before the floor clears", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": () => undefined } });
    void h.call.announceSendOutcome(HELD_SEND);
    await settle();
    h.clock.advance({ ms: ANNOUNCE_LEAD_MS });
    await settle();
    await h.call.notifyRunningListChanged();
    h.call.stop({ reason: "the owner hung up" });
    const before = h.written.length;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
    expect(h.written.slice(before).filter((line) => line.method === "thread/realtime/appendText")).toEqual([]);
  });

  // A handoff the session failed is retried, not dropped, while the call stays up.
  it("tries a failed handoff again, three tries in all, then gives it up", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": failure("no session") } });
    const before = h.written.length;
    expect(await h.call.notifyRunningListChanged()).toBe(
      "the voice was not told the running list changed: no session; it is tried again",
    );
    for (let tick = 0; tick < 4; tick += 1) {
      h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
      await settle();
    }
    expect(h.written.slice(before).filter((line) => line.method === "thread/realtime/appendText").length).toBe(3);
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: { ...RESUMES, "thread/realtime/appendText": failure("no session") } });
    h.call.stop({ reason: "the owner hung up" });
    const before = h.written.length;
    expect(await h.call.notifyRunningListChanged()).toBe("the call has ended: the owner hung up");
    expect(h.written.length).toBe(before);
  });
});

/** Why a look line was spoken, as the call's provenance keeps it. */
const LOOK_WHY = "the owner asked it to look at their screen and that was handed off";

/** Why a resume was handed over, as the call's provenance keeps it. */
const RESUME_WHY =
  "the owner's words had gone unanswered and the page judged the silence not theirs, so the voice was asked only to " +
  "acknowledge them while the console started the thinking model's turn";

/** The look line the call says first, as its provenance entry reads once taken at the call's first instant. */
const LOOK_ENTRY = {
  at: "1970-01-01T00:00:00.000Z",
  source: "spoken-line",
  text: "Okay, having a look.",
  why: LOOK_WHY,
} as const;

/** The text of every `turn/steer` the child was written, in order. */
const steerTextsOf = ({ h }: { h: Awaited<ReturnType<typeof opened>> }): string[] =>
  h.written
    .filter((message) => message["method"] === "turn/steer")
    .map((message) => (message["params"] as { input: { text: string }[] }).input[0].text);

/**
 * The provenance block's entries in a steered text, parsed back.
 *
 * @param text one steer's text
 * @returns the entries, or `undefined` when the text carries no provenance block
 */
function provenanceIn({ text }: { text: string }): readonly VoiceProvenanceEntry[] | undefined {
  const lines = text.split("\n");
  const at = lines.indexOf(VOICE_PROVENANCE_BEFORE);
  if (at === -1) {
    return undefined;
  }
  return JSON.parse(lines[at + 1]) as readonly VoiceProvenanceEntry[];
}

// Asked "what's eighty-six?", a voice with no record of a line it was not told about says it never said it, so the
// spoken record carries what it said and was handed.
describe("PlanCall provenance, carried by the spoken record", () => {
  it("carries a spoken line and a developer message, with their text and why, into the next record, and only once", async () => {
    const h = await opened({ script: { ...RESUMES, "turn/steer": result({ turnId: "t-1" }) } });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({ kind: "said", text: "Okay, having a look." });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect(await h.call.resume()).toEqual({ kind: "sent" });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const record = { lines: SAID, openCard: undefined, turnId: "t-1" };
    expect([await h.call.steerSpokenRecord({ record }), await h.call.steerSpokenRecord({ record })]).toEqual([
      { kind: "steered", turnId: "t-1" },
      { kind: "steered", turnId: "t-1" },
    ]);
    const texts = steerTextsOf({ h });
    const bare = spokenRecordText({ lines: SAID, openCard: undefined, provenance: NO_PROVENANCE });
    expect(texts.length).toBe(2);
    expect(provenanceIn({ text: texts[0] })).toEqual([
      LOOK_ENTRY,
      {
        at: new Date(PLAN_CALL_LIMITS.lookGapMs).toISOString(),
        source: "developer-message",
        text: RESUME_TEXT,
        why: RESUME_WHY,
      },
    ]);
    expect([texts[0].startsWith(`${bare}\n`), texts[0].split("\n").at(-1)]).toEqual([true, VOICE_PROVENANCE_AFTER]);
    expect(texts[1]).toBe(bare);
  });

  it("keeps what a steer the turn did not take, so the next record carries it", async () => {
    let steers = 0;
    const h = await opened({
      script: {
        ...RESUMES,
        "turn/steer": ({ id }) => {
          steers += 1;
          return steers === 1 ? failure("turn t-1 is not active")({ id }) : result({ turnId: "t-1" })({ id });
        },
      },
    });
    await h.call.sayLooking({ ask: "look" });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const record = { lines: SAID, openCard: undefined, turnId: "t-1" };
    expect([await h.call.steerSpokenRecord({ record }), await h.call.steerSpokenRecord({ record })]).toEqual([
      { kind: "failed", reason: "the record did not reach turn t-1: turn t-1 is not active" },
      { kind: "steered", turnId: "t-1" },
    ]);
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text }))).toEqual([[LOOK_ENTRY], [LOOK_ENTRY]]);
  });

  it("carries an entry into both turns steered at once, so the one that fails strands nothing", async () => {
    let steers = 0;
    const h = await opened({
      script: {
        ...RESUMES,
        "turn/steer": ({ id }) => {
          steers += 1;
          return steers === 1 ? failure("turn t-1 is not active")({ id }) : result({ turnId: "t-2" })({ id });
        },
      },
    });
    await h.call.sayLooking({ ask: "look" });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    const first = h.call.steerSpokenRecord({ record: { lines: SAID, openCard: undefined, turnId: "t-1" } });
    const second = h.call.steerSpokenRecord({ record: { lines: SAID, openCard: undefined, turnId: "t-2" } });
    expect([await first, await second]).toEqual([
      { kind: "failed", reason: "the record did not reach turn t-1: turn t-1 is not active" },
      { kind: "steered", turnId: "t-2" },
    ]);
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text }))).toEqual([[LOOK_ENTRY], [LOOK_ENTRY]]);
  });

  // The newer writes behind a dropped entry, each withdrawn as said nothing, leave only its count.
  it("steers a record whose only provenance is how many entries fell off, and says that count", async () => {
    const provenance = new VoiceProvenanceLedger();
    const write = { atMs: 0, source: "spoken-line", text: "t", why: "w" } as const;
    provenance.record({ ...write, key: "kept" });
    const failed = Array.from({ length: MAX_PROVENANCE_ENTRIES }, (_, n) => `failed-${String(n)}`);
    for (const key of failed) {
      provenance.record({ ...write, key });
    }
    for (const key of failed) {
      provenance.retract({ key });
    }
    const texts: string[] = [];
    const outcome = await steerSpokenRecord({
      endedReason: () => undefined,
      provenance,
      record: { lines: [], openCard: undefined, turnId: "t-1" },
      offer: { owed: false },
      recording: new Map(),
      request: ({ params }) => {
        texts.push((params as { input: { text: string }[] }).input[0].text);
        return Promise.resolve({ kind: "result", result: { turnId: "t-1" } });
      },
      running: new Set(["t-1"]),
      threadId: "th-1",
    });
    expect([outcome, texts]).toEqual([
      { kind: "steered", turnId: "t-1" },
      [voiceProvenanceText({ carried: { dropped: 1, entries: [] } })],
    ]);
  });

  it("records nothing for a write the session answered with an error, so an empty record is still refused", async () => {
    const h = await opened({
      script: {
        ...RESUMES,
        "thread/realtime/appendSpeech": failure("no session"),
        "thread/realtime/appendText": failure("no session"),
        "turn/steer": result({ turnId: "t-1" }),
      },
    });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "failed",
      reason: "the voice did not say it was looking: no session",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect(await h.call.resume()).toEqual({
      kind: "failed",
      reason: "the voice was not asked to take its turn: no session",
    });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    expect(await h.call.steerSpokenRecord({ record: { lines: [], openCard: undefined, turnId: "t-1" } })).toEqual({
      kind: "refused",
      reason: "the record has no lines, no card draft and no provenance",
    });
    expect(steerTextsOf({ h })).toEqual([]);
  });

  it("records a line whose write got no answer in time, since the session may still have taken it", async () => {
    const h = await opened({
      script: { ...RESUMES, "thread/realtime/appendSpeech": () => undefined, "turn/steer": result({ turnId: "t-1" }) },
    });
    const looking = h.call.sayLooking({ ask: "look" });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    expect(await looking).toEqual({
      kind: "failed",
      reason: "the voice did not say it was looking: no answer in time",
    });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    expect(await h.call.steerSpokenRecord({ record: { lines: [], openCard: undefined, turnId: "t-1" } })).toEqual({
      kind: "steered",
      turnId: "t-1",
    });
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text }))).toEqual([[LOOK_ENTRY]]);
  });

  it("carries a line into a record steered while its own write is still unanswered", async () => {
    const h = await opened({
      script: { ...RESUMES, "thread/realtime/appendSpeech": () => undefined, "turn/steer": result({ turnId: "t-1" }) },
    });
    const looking = h.call.sayLooking({ ask: "look" });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    expect(await h.call.steerSpokenRecord({ record: { lines: SAID, openCard: undefined, turnId: "t-1" } })).toEqual({
      kind: "steered",
      turnId: "t-1",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeStepMs });
    await looking;
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text }))).toEqual([[LOOK_ENTRY]]);
  });

  it("withdraws the entry of a write that threw before it went out", async () => {
    const h = await opened({
      script: {
        ...RESUMES,
        "thread/realtime/appendSpeech": () => {
          throw new Error("write EPIPE");
        },
        "turn/steer": result({ turnId: "t-1" }),
      },
    });
    await expect(h.call.sayLooking({ ask: "look" })).rejects.toThrow("write EPIPE");
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    expect(await h.call.steerSpokenRecord({ record: { lines: SAID, openCard: undefined, turnId: "t-1" } })).toEqual({
      kind: "steered",
      turnId: "t-1",
    });
    expect(steerTextsOf({ h }).map((text) => provenanceIn({ text }))).toEqual([undefined]);
  });

  it("steers a record carrying only a grounding, which the voice itself was never handed, once", async () => {
    const h = await opened({ script: { ...RESUMES, "turn/steer": result({ turnId: "t-1" }) } });
    const before = h.written.length;
    expect(h.call.recordGrounding({ post: FOURTEEN })).toEqual({ kind: "recorded" });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    // The call steered it in as the turn started, so a lineless record from the page has nothing left to carry.
    expect(await h.call.steerSpokenRecord({ record: { lines: [], openCard: undefined, turnId: "t-1" } })).toEqual({
      kind: "refused",
      reason: "the record has no lines, no card draft and no provenance",
    });
    expect(h.written.slice(before).map((message) => message["method"])).toEqual(["turn/steer"]);
    const [text] = steerTextsOf({ h });
    const lines = text.split("\n");
    expect([lines.length, lines[0], lines[2]]).toEqual([3, VOICE_PROVENANCE_BEFORE, VOICE_PROVENANCE_AFTER]);
    expect(provenanceIn({ text })).toEqual([
      {
        at: "1970-01-01T00:00:00.000Z",
        source: "count-grounding",
        text: "That covers fourteen cards.",
        why: "the app showed Everything 29",
      },
    ]);
  });
});
