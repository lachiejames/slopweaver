/**
 * `PlanCall` reading Codex turns: token usage, what the thread wrote, the running-list line, rollover and turn outcomes.
 */

import { describe, expect, it } from "vitest";
import { LIFETIME_REASON, PLAN_CALL_LIMITS, ROLLOVER_REASON, type SequencedEvent } from "../../../lib/planCallContract";
import { RUNNING_LIST_LANDED_LINE } from "../../../lib/talkPlanHeldRelease";
import { ACK_SPEECHES, EMPTY_TURN_OUTCOME_SPEECH, FAILED_TURN_OUTCOME_SPEECH } from "../../../lib/talkPlanWords";
import {
  CLAIMED,
  eventsOf,
  handOff,
  heardDoneLine,
  heardLine,
  itemLine,
  listening,
  NUDGES,
  opened,
  result,
  settle,
  spokenAfter,
  TOOL_REQUEST,
  transcriptLine,
  turnLine,
} from "./harness";
import { TURN_USAGE, usageLine } from "./usage";

describe("token usage", () => {
  it("relays the call's own thread's usage after a turn, both the turn's and the running total", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: TURN_USAGE, turnId: "u1" }) });
    expect(seen).toEqual([
      {
        event: { contextWindow: 272_000, kind: "usage", last: TURN_USAGE.last, total: TURN_USAGE.total, turnId: "u1" },
        seq: 1,
      },
    ]);
  });

  it("ignores another thread's usage, and says so when its own is unreadable rather than losing it silently", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: usageLine({ threadId: "thread-9", tokenUsage: TURN_USAGE, turnId: "u1" }) });
    const torn = { ...TURN_USAGE, last: { ...TURN_USAGE.last, inputTokens: -4 } };
    h.call.receive({ chunk: usageLine({ threadId: "thread-1", tokenUsage: torn, turnId: "u2" }) });
    expect(seen).toEqual([
      {
        event: { kind: "error", message: "the plan thread reported token usage the console cannot read" },
        seq: 1,
      },
    ]);
  });

  it("never lets a flood of usage evict a tool call a reconnecting page still has to replay", async () => {
    const h = await opened();
    h.call.receive({ chunk: TOOL_REQUEST });
    for (let turn = 0; turn < PLAN_CALL_LIMITS.replayRing + 10; turn += 1) {
      h.call.receive({
        chunk: usageLine({ threadId: "thread-1", tokenUsage: TURN_USAGE, turnId: `u${String(turn)}` }),
      });
    }
    const { replay } = h.call.subscribe({ after: 0, listener: () => undefined });
    expect(replay[0]).toEqual({
      event: { arguments: '{"query":"q"}', kind: "tool", token: "token-1.1", tool: "search_corpus", turnId: "u1" },
      seq: 1,
    });
    expect(replay.length).toBe(1 + PLAN_CALL_LIMITS.replayRing);
    expect(replay.at(-1)!.seq).toBe(PLAN_CALL_LIMITS.replayRing + 11);
  });
});

// A hand-off becomes a Codex turn the page must hear of, or a lost one reads "listening".
describe("Codex turns", () => {
  it("forwards its own thread's turn starting, its steps, throttled progress and its end", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: itemLine({ item: { type: "reasoning" }, method: "item/started", turnId: "t-1" }) });
    h.call.receive({ chunk: itemLine({ method: "item/reasoning/textDelta", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressEveryMs });
    h.call.receive({ chunk: itemLine({ method: "item/reasoning/textDelta", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: itemLine({ method: "item/completed", turnId: "t-1" }) });
    expect(eventsOf({ seen })).toEqual([
      { kind: "codex-turn", phase: "started", turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "reasoning" }, turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: null, turnId: "t-1" },
      { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t-1" },
    ]);
  });

  it("ignores another thread's turns, and an item of a turn it never saw start", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({
      chunk: turnLine({ method: "turn/started", status: "inProgress", threadId: "thread-9", turnId: "t-9" }),
    });
    h.call.receive({ chunk: itemLine({ item: { type: "reasoning" }, method: "item/started", turnId: "t-2" }) });
    expect(seen).toEqual([]);
  });

  it("says its own thread's unreadable turn is unreadable, and keeps a turn ended 'in progress' running", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "stalled", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "inProgress", turnId: "t-2" }) });
    h.call.receive({ chunk: itemLine({ item: { type: "agentMessage" }, method: "item/started", turnId: "t-2" }) });
    const unreadable = { kind: "error", message: "the plan thread reported a Codex turn the console cannot read" };
    expect(eventsOf({ seen })).toEqual([
      unreadable,
      { kind: "codex-turn", phase: "started", turnId: "t-2" },
      unreadable,
      { kind: "codex-turn", phase: "progress", step: { kind: "writing" }, turnId: "t-2" },
    ]);
  });

  it("forwards a failed turn's own failure", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const error = { additionalDetails: null, codexErrorInfo: null, message: "usage limit reached" };
    h.call.receive({ chunk: turnLine({ error, method: "turn/completed", status: "failed", turnId: "t-1" }) });
    expect(eventsOf({ seen }).at(-1)).toEqual({
      failure: "usage limit reached",
      kind: "codex-turn",
      phase: "completed",
      status: "failed",
      turnId: "t-1",
    });
  });
});

/** A completed agentMessage item of the given thread, as the app-server writes it. */
const completedMessageLine = ({
  itemId,
  text,
  threadId = "thread-1",
}: {
  itemId: string;
  text: string;
  threadId?: string;
}) =>
  `${JSON.stringify({ method: "item/completed", params: { item: { id: itemId, text, type: "agentMessage" }, threadId, turnId: "t-1" } })}\n`;

// When the voice says "That covers fourteen cards" and only the spoken line is kept, nothing can say whether the
// thread wrote fourteen.
describe("what the thread wrote", () => {
  it("forwards each completed message of its own thread once, whole, and never a delta or another thread's", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    const delta = { delta: "That covers", itemId: "m-1", threadId: "thread-1", turnId: "t-1" };
    h.call.receive({ chunk: `${JSON.stringify({ method: "item/agentMessage/delta", params: delta })}\n` });
    h.call.receive({ chunk: completedMessageLine({ itemId: "m-1", text: "That covers fourteen cards." }) });
    h.call.receive({ chunk: completedMessageLine({ itemId: "m-1", text: "That covers fourteen cards." }) });
    h.call.receive({ chunk: completedMessageLine({ itemId: "m-9", text: "elsewhere", threadId: "thread-9" }) });
    expect(eventsOf({ seen })).toEqual([
      { final: true, itemId: "m-1", kind: "written", text: "That covers fourteen cards.", turnId: "t-1" },
      // Handed over once, the floor free: owed until the voice's write lands.
      {
        detail: "the floor was free",
        itemId: "m-1",
        kind: "held-answer",
        pending: true,
        phase: "handing",
        turnId: "t-1",
      },
    ]);
  });
});

/** An `offer_copy` call the thread made in turn `t-1`, which the page answers under `token-1.1`. */
const OFFER_REQUEST = `${JSON.stringify({
  id: 78,
  method: "item/tool/call",
  params: {
    arguments: { destination: "slack", text: "keen, thanks" },
    callId: "c-offer",
    namespace: null,
    threadId: "thread-1",
    tool: "offer_copy",
    turnId: "t-1",
  },
})}\n`;

// The voice can say a line about the running list ~10 times on a call that made no offer_copy call.
describe("the running-list line", () => {
  const spoken = async ({ success }: { success: boolean | undefined }) => {
    const h = await opened({ script: NUDGES });
    const before = h.written.length;
    if (success !== undefined) {
      h.call.receive({ chunk: OFFER_REQUEST });
      h.call.claim({ claimant: "page-a", token: "token-1.1" });
      h.call.answer({ claimant: "page-a", contentItems: [], success, token: "token-1.1" });
    }
    h.call.receive({ chunk: completedMessageLine({ itemId: "m-1", text: "A short reply to Seth." }) });
    await settle();
    return spokenAfter({ before, h });
  };

  it("is never handed to the voice for a turn that made no offer, nor one whose offer was refused", async () => {
    expect(await spoken({ success: undefined })).toEqual(["A short reply to Seth."]);
    expect(await spoken({ success: false })).toEqual(["A short reply to Seth."]);
  });

  it("ends the answer of a turn whose offer the page answered unrefused", async () => {
    expect(await spoken({ success: true })).toEqual([`A short reply to Seth. ${RUNNING_LIST_LANDED_LINE}`]);
  });

  it("lands no line for an offer from a server too old to name its turn", async () => {
    const h = await opened({ script: NUDGES });
    const before = h.written.length;
    const unturned = OFFER_REQUEST.replace(',"turnId":"t-1"', "");
    expect(unturned).not.toContain("turnId");
    h.call.receive({ chunk: unturned });
    h.call.claim({ claimant: "page-a", token: "token-1.1" });
    const answered = h.call.answer({ claimant: "page-a", contentItems: [], success: true, token: "token-1.1" });
    expect(answered.kind).toBe("answered");
    h.call.receive({ chunk: completedMessageLine({ itemId: "m-1", text: "A short reply to Seth." }) });
    await settle();
    expect(spokenAfter({ before, h })).toEqual(["A short reply to Seth."]);
  });
});

/** The age rollover event while the lifetime's cut is far, as the page's stream carries it: no time named. */
const ROLLOVER_FAR = { contextUrgent: false, kind: "rollover", lifetimeRemainingMs: null, reason: ROLLOVER_REASON };
/** The same ask again as the urgent window opens, naming the time left, measured on the server's elapsed clock. */
const ROLLOVER_URGENT = { ...ROLLOVER_FAR, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs };
/** Once more as the last window opens. */
const ROLLOVER_LAST = { ...ROLLOVER_FAR, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverLastMs };

// The call's ninety minute lifetime cap cut the owner off mid-sentence three times, so the page is told before it hits.
describe("rollover", () => {
  it("tells the page nothing before its window, then once in a free floor, and stops nothing", async () => {
    const h = await listening({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs - 1 });
    expect(eventsOf({ seen: h.seen })).toEqual([]);
    h.clock.advance({ ms: 1 });
    expect(eventsOf({ seen: h.seen })).toEqual([ROLLOVER_FAR]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs * 40 });
    expect(eventsOf({ seen: h.seen })).toEqual([ROLLOVER_FAR]);
    expect(h.kills.count).toBe(0);
    expect(h.call.ended).toBe(false);
    expect(ROLLOVER_REASON).toBe(
      "the console rolled this call over onto a fresh one in a pause, ahead of its own 90-minute limit",
    );
  });

  it("waits out the owner's words and the voice's alike, until neither has been heard for the whole quiet", async () => {
    const h = await listening({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs - 1_000 });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: heardDoneLine({ text: "so" }) });
    h.clock.advance({ ms: 1_000 });
    expect(eventsOf({ seen: h.seen })).toEqual([]);
    h.clock.advance({ ms: 2_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverQuietMs - PLAN_CALL_LIMITS.rolloverPollMs });
    expect(eventsOf({ seen: h.seen })).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    expect(eventsOf({ seen: h.seen })).toEqual([ROLLOVER_FAR]);
  });

  it("never rolls over a Codex turn still working, nor in the settle after it ends", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs + 60_000 });
    // The progress cues sent meanwhile are page events, so they hold no floor; only the running turn does.
    await settle();
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([]);
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverQuietMs - PLAN_CALL_LIMITS.rolloverPollMs });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([ROLLOVER_FAR]);
  });

  it("never rolls over a tool call the page still owes an answer", async () => {
    const h = await listening({ script: NUDGES });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs - 1 });
    h.call.receive({ chunk: TOOL_REQUEST });
    expect(h.call.claim({ claimant: "page-a", token: "token-1.1" })).toEqual(CLAIMED);
    h.clock.advance({ ms: 60_000 });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([]);
    h.call.answer({
      claimant: "page-a",
      contentItems: [{ text: "x", type: "inputText" }],
      success: true,
      token: "token-1.1",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover")).toEqual([ROLLOVER_FAR]);
  });

  it("never rolls over a nudge the voice has just been handed", async () => {
    // The voice hands nothing over, so the console starts the owed turn inside the quiet; the child answers it.
    const h = await listening({ script: { ...NUDGES, "turn/start": result({ turn: { id: "t-9" } }) } });
    const rollovers = () => eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs - 1 });
    expect((await h.call.nudge({ promised: false })).kind).toBe("sent");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverQuietMs - PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
    expect(rollovers()).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    expect(rollovers()).toEqual([ROLLOVER_FAR]);
  });

  it("never rolls over while the console's own start of an owed turn is unanswered", async () => {
    const h = await listening({ script: NUDGES });
    const rollovers = () => eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs - 1 });
    await h.call.nudge({ promised: false });
    // Walked one poll at a time, as real time passes: one jump would run the poll registered first ahead of the start.
    for (
      let ms = 0;
      ms < PLAN_CALL_LIMITS.nudgeStepMs - PLAN_CALL_LIMITS.rolloverPollMs;
      ms += PLAN_CALL_LIMITS.rolloverPollMs
    ) {
      h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    }
    expect([h.written.filter((message) => message["method"] === "turn/start").length, rollovers()]).toEqual([1, []]);
  });

  it("is replayed to a stream that was reconnecting, past a flood of usage", async () => {
    const h = await opened();
    const { unsubscribe } = h.call.subscribe({ after: 0, listener: () => undefined });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverFromMs });
    unsubscribe();
    for (let turn = 0; turn < PLAN_CALL_LIMITS.replayRing + 10; turn += 1) {
      h.call.receive({
        chunk: usageLine({ threadId: "thread-1", tokenUsage: TURN_USAGE, turnId: `u${String(turn)}` }),
      });
    }
    const { replay } = h.call.subscribe({ after: 0, listener: () => undefined });
    expect(replay[0]).toEqual({ event: ROLLOVER_FAR, seq: 1 });
  });

  // Measured: a call was cut mid-word at its lifetime after every pause in its last eight minutes was held.
  it("asks anyway once the lifetime's cut is inside the urgent window, however busy the floor, naming the time left", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const rollovers = () => eventsOf({ seen: h.seen }).filter((event) => event.kind === "rollover");
    // One poll short, so the walk's step ends on the urgent instant: this clock fires a due timer at its step's end.
    h.clock.advance({
      ms: PLAN_CALL_LIMITS.lifetimeMs - PLAN_CALL_LIMITS.rolloverUrgentMs - PLAN_CALL_LIMITS.rolloverPollMs,
    });
    const beforeUrgent = rollovers();
    await walk({ h, ms: PLAN_CALL_LIMITS.rolloverPollMs * 2 });
    const atUrgent = rollovers();
    await walk({ h, ms: 60_000 });
    expect([beforeUrgent, atUrgent, rollovers(), h.call.ended]).toEqual([
      [],
      [ROLLOVER_URGENT],
      [ROLLOVER_URGENT],
      false,
    ]);
  });

  it("still ends at the hard lifetime when the floor never frees, or the page never acts on it", async () => {
    const busy = await listening({ script: NUDGES });
    busy.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const ignored = await listening({ script: NUDGES });
    // Steps of the last window, so each stage's timer fires on its own instant rather than at a step's end.
    for (let ms = 0; ms < PLAN_CALL_LIMITS.lifetimeMs; ms += PLAN_CALL_LIMITS.rolloverLastMs) {
      busy.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverLastMs });
      ignored.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverLastMs });
    }
    const closed = { kind: "closed", reason: LIFETIME_REASON };
    // The busy call is asked too, once its cut is urgent, and the ignored one asked again, with the time left at each.
    expect(
      eventsOf({ seen: busy.seen }).filter((event) => event.kind === "rollover" || event.kind === "closed"),
    ).toEqual([ROLLOVER_URGENT, ROLLOVER_LAST, closed]);
    expect(eventsOf({ seen: ignored.seen })).toEqual([ROLLOVER_FAR, ROLLOVER_URGENT, ROLLOVER_LAST, closed]);
    expect(busy.kills.count).toBe(1);
    expect(ignored.kills.count).toBe(1);
  });

  it("says nothing after the call has stopped", async () => {
    const h = await listening({ script: NUDGES });
    h.call.stop({ reason: "the owner hung up" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lifetimeMs });
    expect(eventsOf({ seen: h.seen })).toEqual([{ kind: "closed", reason: "the owner hung up" }]);
  });
});

/** A message of turn `turnId` completing with these words. */
const wroteLine = ({ itemId, text, turnId }: { itemId: string; text: string; turnId: string }) =>
  itemLine({
    item: { id: itemId, phase: "final_answer", text, type: "agentMessage" },
    method: "item/completed",
    turnId,
  });

/** The stream's `turn-outcome` events. */
const outcomesOf = ({ seen }: { seen: readonly SequencedEvent[] }) =>
  eventsOf({ seen }).filter((event) => event.kind === "turn-outcome");

/**
 * Step the call's clock a poll at a time, letting each write land.
 *
 * @param h the harness
 * @param ms how far to move it
 */
async function walk({ h, ms }: { h: Awaited<ReturnType<typeof listening>>; ms: number }): Promise<void> {
  for (let gone = 0; gone < ms; gone += PLAN_CALL_LIMITS.rolloverPollMs) {
    h.clock.advance({ ms: PLAN_CALL_LIMITS.rolloverPollMs });
    await settle();
  }
}

// A turn the voice says it is checking must not leave the owner waiting forever for anything to come back.
describe("turn outcomes", () => {
  // A turn acknowledged, then writing "Mm-hmm." and two blanks, then completing: handed the nod, the voice would say
  // it was checking, and nothing would ever come back.
  it("never hands the voice a lone nod, and says the acknowledged turn came back with no answer", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "01a19738" });
    await walk({ h, ms: PLAN_CALL_LIMITS.ackHoldMs });
    h.call.receive({ chunk: heardDoneLine({ text: "so the citations" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "m-1", text: "Mm-hmm.", turnId: "01a19738" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "m-2", text: "", turnId: "01a19738" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "m-3", text: " ", turnId: "01a19738" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "01a19738" }) });
    await walk({ h, ms: 15_000 });
    const spoken = spokenAfter({ before, h });
    expect(spoken.slice(1)).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
    expect(ACK_SPEECHES).toContain(spoken[0]);
    expect(outcomesOf({ seen: h.seen })).toEqual([
      { detail: "said it came back with no answer", kind: "turn-outcome", phase: "said", turnId: "01a19738" },
    ]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "error")).toEqual([]);
  });

  // Acknowledged, two blanks, completed, and the voice said nothing more.
  it("says an acknowledged turn that wrote only blanks came back with no answer", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "01a1973d" });
    await walk({ h, ms: PLAN_CALL_LIMITS.ackHoldMs });
    h.call.receive({ chunk: heardDoneLine({ text: "what about the other one" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "m-1", text: "", turnId: "01a1973d" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "m-2", text: "", turnId: "01a1973d" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "01a1973d" }) });
    await walk({ h, ms: 15_000 });
    expect(spokenAfter({ before, h }).slice(1)).toEqual([EMPTY_TURN_OUTCOME_SPEECH]);
  });

  // The trailing blank a turn writes once it has answered, after nearly every answer.
  it("says an answer followed by a trailing blank, with no correction and no error", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    await walk({ h, ms: PLAN_CALL_LIMITS.ackHoldMs });
    h.call.receive({ chunk: heardDoneLine({ text: "is the build green" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "a-1", text: "The build passed.", turnId: "t-1" }) });
    h.call.receive({ chunk: wroteLine({ itemId: "a-2", text: "", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    await walk({ h, ms: 15_000 });
    expect(spokenAfter({ before, h }).slice(1)).toEqual(["The build passed."]);
    expect(outcomesOf({ seen: h.seen })).toEqual([]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "error")).toEqual([]);
  });

  // A start whose own payload says it is over is still the newest turn.
  it("drops an older turn's owed line when a newer turn's start arrives already ended", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    h.call.receive({ chunk: heardLine({ delta: "and the citations" }) });
    handOff({ h, turnId: "t-1" });
    await walk({ h, ms: PLAN_CALL_LIMITS.ackHoldMs });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "interrupted", turnId: "t-2" }) });
    h.call.receive({ chunk: heardDoneLine({ text: "and the citations" }) });
    await walk({ h, ms: 15_000 });
    expect(spokenAfter({ before, h }).slice(1)).toEqual([]);
    expect(outcomesOf({ seen: h.seen })).toEqual([
      {
        detail: "turn t-2 started after it, and its answer is the one owed",
        kind: "turn-outcome",
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
  });

  it("says a failed turn failed in the fixed words, never the provider's error text", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    await walk({ h, ms: PLAN_CALL_LIMITS.ackHoldMs });
    h.call.receive({ chunk: heardDoneLine({ text: "check the logs" }) });
    const error = { message: "stream disconnected before completion" };
    h.call.receive({ chunk: turnLine({ error, method: "turn/completed", status: "failed", turnId: "t-1" }) });
    await walk({ h, ms: 15_000 });
    const spoken = spokenAfter({ before, h });
    expect(spoken.slice(1)).toEqual([FAILED_TURN_OUTCOME_SPEECH]);
    expect(spoken.join(" ")).not.toContain(error.message);
  });
});
