/**
 * `PlanCall` acknowledging a hand-off, and `PlanCall.sayLooking`.
 */

import { describe, expect, it } from "vitest";
import { PLAN_CALL_LIMITS } from "../../../lib/planCallContract";
import { ACK_SPEECHES, FIND_SPEECHES, LOOK_SPEECHES } from "../../../lib/talkPlanWords";
import {
  COMPOSITION,
  cuesOf,
  eventsOf,
  failure,
  handOff,
  harness,
  itemLine,
  listening,
  NUDGES,
  opened,
  PLAN_LOGIN,
  SDP_LINE,
  settle,
  spokenAfter,
  transcriptLine,
  turnLine,
} from "./harness";

// Hearing nothing at all could also mean the call disconnected, so the voice says it is on it.
describe("acknowledgement", () => {
  it("has the voice say it is on it once the hold passes with nothing said, and not before", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    expect(PLAN_CALL_LIMITS.ackHoldMs).toBe(1_000);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs - 1 });
    expect(spokenAfter({ before, h })).toEqual([]);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual(["On it."]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "acknowledged")).toEqual([
      { kind: "acknowledged" },
    ]);
  });

  it("words each hand-off's line differently, never the same canned line twice running", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: 2_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 10_000 });
    handOff({ h, turnId: "t-2" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    expect(spokenAfter({ before, h })).toEqual(["On it.", "Sure, one sec."]);
    expect(new Set(ACK_SPEECHES).size).toBe(ACK_SPEECHES.length);
    expect(ACK_SPEECHES.length).toBe(8);
  });

  it("says nothing when the voice has spoken since the hand-off, since it answered or acknowledged itself", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: 500 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("says nothing for a turn started after the voice's words rather than the owner's, as a walk's read-ahead is", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.clock.advance({ ms: 100 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 100 });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("says nothing for a turn with none of the owner's words heard, nor one that completes inside the hold", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    handOff({ h, turnId: "t-2" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs - 1 });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-2" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("waits for the owner's words to go quiet when the hand-off ran ahead of them", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: 900 });
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.clock.advance({ ms: 100 });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackPollMs });
    expect(spokenAfter({ before, h })).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackPollMs });
    expect(spokenAfter({ before, h })).toEqual(["On it."]);
  });

  it("drops the line rather than say it late when the owner keeps talking past the give-up", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    for (let at = 0; at < PLAN_CALL_LIMITS.ackGiveUpMs + 1_000; at += PLAN_CALL_LIMITS.ackPollMs) {
      h.clock.advance({ ms: PLAN_CALL_LIMITS.ackPollMs });
      h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    }
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - PLAN_CALL_LIMITS.ackGiveUpMs - 1_001 });
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  // The give-up is checked even when the owner's words are no longer settling.
  it("drops the line when its hold fires late, past the give-up, though the owner has long gone quiet", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs + 1 });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
    expect(eventsOf({ seen: h.seen }).filter((event) => event.kind === "acknowledged")).toEqual([]);
  });

  // A repeated start must not reset the hand-off's clock, or one turn could be acknowledged twice.
  it("says it once per turn, though the turn's start arrives again after the owner's later words", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    h.clock.advance({ ms: 1_000 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 4_100 });
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual(["On it."]);
  });

  it("says nothing while the realtime start is still unanswered, though a hand-off arrives on the thread", async () => {
    const h = harness({ script: PLAN_LOGIN });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "o" });
    await settle();
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    expect(spokenAfter({ before: 0, h })).toEqual([]);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.realtimeStartMs });
    expect((await outcome).kind).toBe("ambiguous");
  });

  it("says nothing for a turn whose start already says it completed", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("says nothing for a turn whose start said it completed, though a running start for it follows", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    h.call.receive({ chunk: transcriptLine({ role: "user" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("says nothing for a turn first seen before the realtime start answered, though its start is replayed after", async () => {
    const h = harness({ script: PLAN_LOGIN });
    const outcome = h.call.open({ composition: COMPOSITION, offerSdp: "o" });
    await settle();
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs + 1_000 });
    const start = h.written.find((message) => message["method"] === "thread/realtime/start")!;
    h.call.receive({ chunk: `${JSON.stringify({ id: start["id"], result: {} })}\n${SDP_LINE}` });
    expect((await outcome).kind).toBe("open");
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    expect(spokenAfter({ before: 0, h })).toEqual([]);
  });

  it("says nothing for a turn that completed inside the hold, though its start is replayed before the hold ends", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual([]);
  });

  it("says it once per turn, though the turn's start is replayed after it completed", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    h.clock.advance({ ms: 100 });
    h.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    h.clock.advance({ ms: 900 });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    h.clock.advance({ ms: 5_000 });
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    expect(spokenAfter({ before, h })).toEqual(["On it."]);
  });

  it("is said by a look line for the same hand-off, so the voice never says both", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("said");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    expect(spokenAfter({ before, h })).toEqual([LOOK_SPEECHES[0]]);
  });

  it("restarts the progress window, so the first progress cue comes a whole window after it", async () => {
    const h = await listening({ script: NUDGES });
    const before = h.written.length;
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
    expect(spokenAfter({ before, h })).toEqual(["On it."]);
  });

  it("says an acknowledgement the voice would not take as an error, rather than losing it", async () => {
    const h = await listening({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    handOff({ h, turnId: "t-1" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackHoldMs });
    await settle();
    expect(eventsOf({ seen: h.seen }).at(-1)).toEqual({
      kind: "error",
      message: "the voice did not say it was on it: no session",
    });
  });

  it("says nothing after the call has stopped", async () => {
    const h = await listening({ script: NUDGES });
    handOff({ h, turnId: "t-1" });
    h.call.stop({ reason: "the owner hung up" });
    const before = h.written.length;
    h.clock.advance({ ms: PLAN_CALL_LIMITS.ackGiveUpMs });
    expect(spokenAfter({ before, h })).toEqual([]);
  });
});

// Asked to look at the screen, the voice says it is having a look.
describe("PlanCall.sayLooking", () => {
  it("has the voice say a look line, worded differently each time", async () => {
    const h = await opened({ script: NUDGES });
    const before = h.written.length;
    const said = [];
    for (const _ of LOOK_SPEECHES) {
      said.push(await h.call.sayLooking({ ask: "look" }));
      h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    }
    expect(said).toEqual([
      { kind: "said", text: "Okay, having a look." },
      { kind: "said", text: "One sec, pulling it up." },
      { kind: "said", text: "Sure, having a look now." },
    ]);
    expect(spokenAfter({ before, h })).toEqual([...LOOK_SPEECHES]);
  });

  it("stops nothing, though a Codex turn is running", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    const before = h.written.length;
    await h.call.sayLooking({ ask: "look" });
    expect(h.written.slice(before).map((message) => message["method"])).toEqual(["thread/realtime/appendSpeech"]);
  });

  it("refuses a second line inside the gap, writing nothing, and says one again once it passes", async () => {
    const h = await opened({ script: NUDGES });
    await h.call.sayLooking({ ask: "look" });
    const before = h.written.length;
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "refused",
      reason: "it said it was looking a moment ago",
    });
    expect(h.written.length).toBe(before);
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("said");
  });

  it("refuses while a nudge is still being sent", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    void h.call.nudge({ promised: false });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({ kind: "refused", reason: "a nudge is being said" });
  });

  it("refuses just after a nudge was taken, since the voice has not said it yet, until the gap passes", async () => {
    const h = await opened({ script: NUDGES });
    await h.call.nudge({ promised: false });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({ kind: "refused", reason: "a nudge is being said" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("said");
  });

  it("refuses just after a running turn's commentary was handed to the voice, which is about to say it", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({
      chunk: itemLine({
        item: { id: "c-1", phase: "commentary", text: "Digest, or as they come?", type: "agentMessage" },
        method: "item/completed",
        turnId: "t-1",
      }),
    });
    await settle();
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "refused",
      reason: "the voice is saying what Codex just wrote",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("said");
  });

  it("refuses just after a Codex turn ended, while the voice is about to answer it", async () => {
    const h = await opened({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "refused",
      reason: "Codex just finished, and the voice is about to answer",
    });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.nudgeSettleMs });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("said");
  });

  it("refuses while another look line is still being sent, even past the gap", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": () => undefined } });
    void h.call.sayLooking({ ask: "look" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "refused",
      reason: "a look line is already being sent",
    });
  });

  it("says the voice would not take the line, rather than claiming it was said", async () => {
    const h = await opened({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "failed",
      reason: "the voice did not say it was looking: no session",
    });
  });

  it("restarts the progress window, since the voice has just spoken", async () => {
    const h = await listening({ script: NUDGES });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    await h.call.sayLooking({ ask: "look" });
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
  });

  // A look line the voice never took said nothing, so the cue stays timed from the hand-off.
  it("leaves the progress window where it was when the voice would not take the line", async () => {
    const h = await listening({ script: { ...NUDGES, "thread/realtime/appendSpeech": failure("no session") } });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: 5_000 });
    expect((await h.call.sayLooking({ ask: "look" })).kind).toBe("failed");
    h.clock.advance({ ms: PLAN_CALL_LIMITS.progressFirstMs - 5_000 - 1 });
    expect(cuesOf({ seen: h.seen })).toBe(0);
    h.clock.advance({ ms: 1 });
    expect(cuesOf({ seen: h.seen })).toBe(1);
  });

  it("refuses once the call has ended", async () => {
    const h = await opened({ script: NUDGES });
    h.call.stop({ reason: "the owner hung up" });
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({
      kind: "refused",
      reason: "the call has ended: the owner hung up",
    });
  });

  // A lookup must not leave the voice silent, which reads like a blocked thread.
  it("says a finding-it line for a lookup, worded differently each time, sharing the look's rotation and gap", async () => {
    const h = await opened({ script: NUDGES });
    const before = h.written.length;
    const said = [];
    for (const _ of FIND_SPEECHES) {
      said.push(await h.call.sayLooking({ ask: "find" }));
      h.clock.advance({ ms: PLAN_CALL_LIMITS.lookGapMs });
    }
    expect(said).toEqual([
      { kind: "said", text: "Finding it." },
      { kind: "said", text: "One sec, finding that." },
      { kind: "said", text: "On it, pulling that up." },
    ]);
    expect(spokenAfter({ before, h })).toEqual([...FIND_SPEECHES]);
    expect(await h.call.sayLooking({ ask: "look" })).toEqual({ kind: "said", text: "Okay, having a look." });
    expect(await h.call.sayLooking({ ask: "find" })).toEqual({
      kind: "refused",
      reason: "it said it was looking a moment ago",
    });
  });
});
