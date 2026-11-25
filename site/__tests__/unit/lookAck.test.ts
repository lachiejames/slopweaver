import { describe, expect, it } from "vitest";

import {
  carriesFigure,
  foldLookAck,
  foldLookFrame,
  isFindAsk,
  isLookAsk,
  LOOK_ACK_START,
  LOOK_FRAME_START,
  type LookAckState,
  type LookFrameState,
  lookAskOf,
} from "../../lib/lookAck";
import type { PlanEffect } from "../../lib/talkPlanEvents";
import { type CallRecord, FOUR_PLAN_CALL } from "./lookAckCall";

/** A record as the page's effect, or `undefined` for a look, which the page never sees. */
function effectOf({ record }: { record: CallRecord }): PlanEffect | undefined {
  if ("handoff" in record) {
    return { id: `delegation-${record.at}`, kind: "delegated", target: "codex" };
  }
  if ("look" in record) {
    return undefined;
  }
  return { final: record.final, id: record.id, kind: "segment", text: record.text, who: record.who };
}

/** Replay the call through the fold: when the console would have said "having a look", against what really happened. */
function replay({ records }: { records: readonly CallRecord[] }): {
  readonly says: readonly string[];
  readonly looks: readonly string[];
  readonly firstVoiceAfterHandoff: readonly string[];
} {
  let state: LookAckState = LOOK_ACK_START;
  const says: string[] = [];
  const looks: string[] = [];
  const firstVoiceAfterHandoff: string[] = [];
  let awaitingVoice = false;
  for (const record of records) {
    if ("look" in record) {
      looks.push(record.at);
    }
    if ("handoff" in record) {
      awaitingVoice = true;
    }
    if ("who" in record && record.who === "voice" && awaitingVoice) {
      firstVoiceAfterHandoff.push(record.at);
      awaitingVoice = false;
    }
    const effect = effectOf({ record });
    if (effect !== undefined) {
      const folded = foldLookAck({ effect, state });
      state = folded.state;
      if (folded.say !== undefined) {
        says.push(record.at);
      }
    }
  }
  return { firstVoiceAfterHandoff, looks, says };
}

/** Seconds from one `HH:MM:SS.mmm` to another on the same day. */
function secondsBetween({ from, to }: { from: string; to: string }): number {
  const ms = (at: string): number => Date.parse(`2026-10-06T${at}Z`);
  return (ms(to) - ms(from)) / 1000;
}

describe("isLookAsk", () => {
  it.each([
    " Look at my screen",
    "we're gonna take some screenshots now",
    " Take a look at this",
    "Screenshot, please",
    "can you see my screen",
    "have a quick look at that",
    "LOOK  AT\nTHE SCREEN",
    "look here",
    "what am I looking at",
    "grab a screenshot",
    "screenshot this for me",
    "look at this image",
    "look at my screenshot",
    "If you want to look at my screen you can see the problem",
    "Right... I've posted one reply in the thread. Can you just have a quick look Yeah... Umm...",
    "[laugh ]Have another look Uh- it says paused now.",
    "Okay, so I'm... back at the... uh desk, if you could... uh have a look now",
    "Uhh. Okay, could you just bring up my screen",
    // A second screenshot, and a figure the owner corrected, each in the shape a call's final words took.
    " Uh, sorry, t-uh, take another screenshot. The page moved before you took that",
    " N- n- no, don't just agree with me. Just, uh, hang on, I want you to check it, not agree. Just take another screenshot. I've zoomed in a bit",
    " Oh. Actually, [laugh] . Okay, it actually says four hundred and twenty dollars a month",
    "take a new screenshot",
    "grab one more screenshot",
    "no, it says 1,240",
  ])("hears %j as a look ask", (text) => {
    expect(isLookAsk({ afterFigure: false, text })).toBe(true);
  });

  // "X, not Y" corrects a figure only when the voice has just said one; anywhere else it is an ordinary sentence.
  it.each([
    " No, four hundred and twenty dollars, not five hundred and twenty dollars. Four hundred and twenty dollars. Thanks",
    "it's 420, not 520",
  ])("hears %j as a look ask right after the voice said a figure, and not otherwise", (text) => {
    expect(isLookAsk({ afterFigure: true, text })).toBe(true);
    expect(isLookAsk({ afterFigure: false, text })).toBe(false);
  });

  it.each([
    "take a look at the logs",
    "look into why staging is down",
    "what did we decide about the screen reader",
    "We- haven't linked anything yet. Like, the card shows a dashboard screenshot but no dashboard link.",
    "a seven-day comparison screenshot of the dashboard is a really common request",
    "reuse it for later screenshots",
    "Okay, you took a screenshot now. Good",
    "have a quick look into the staging pool",
    "take another look through the PR",
    "I'll have a look later",
    "I have a look of disbelief on my face",
    "",
    // A figure, a negation or a reported reading alone is not a correction: each in a shape an earlier call measured.
    "Monday or so. that it opens, not ten new PRs, but five new PRs to cover it",
    "a-a single bump... in one place, not ten different places",
    "I'm not a hundred percent sure",
    "not one of those",
    "not now",
    "not sure",
    "Um, so... yeah, next it says three of the sources still have the old value",
    "that says two things to me, like, Like first",
    "it says we need two reviewers",
    "the document says three options",
    // "X, not Y" with no figure of the voice's before it.
    "We should invite two reviewers, not three",
  ])("does not hear %j as one", (text) => {
    expect(isLookAsk({ afterFigure: false, text })).toBe(false);
  });
});

describe("carriesFigure", () => {
  it("sees a figure in digits, money or words, and nothing in words without one", () => {
    expect(carriesFigure({ text: ' Right, US$420 a month, and "Priority' })).toBe(true);
    expect(carriesFigure({ text: "four hundred and twenty US dollars" })).toBe(true);
    expect(carriesFigure({ text: "It's on the pricing page." })).toBe(false);
    expect(carriesFigure({ text: "" })).toBe(false);
  });
});

describe("foldLookAck over the recorded four-plan call", () => {
  const { says, looks, firstVoiceAfterHandoff } = replay({ records: FOUR_PLAN_CALL });

  it("owes the line once per turn, the moment the owner's look ask and its hand-off have both arrived", () => {
    // The second turn's hand-off came before the fragment carrying "Look at my screen".
    expect(says).toEqual(["02:10:24.998", "02:11:25.523", "02:12:26.486", "02:13:44.893"]);
  });

  it("says it before every look, where the voice was silent until after each one", () => {
    expect(looks).toEqual(["02:10:31.853", "02:11:31.858", "02:12:33.460", "02:13:50.426"]);
    expect(says.map((at, turn) => at < looks[turn])).toEqual([true, true, true, true]);
    expect(firstVoiceAfterHandoff.map((at, turn) => at > looks[turn])).toEqual([true, true, true, true]);
  });

  it("cuts the silence before the voice's first words from 11–17s to under a second", () => {
    const handoffs = FOUR_PLAN_CALL.filter((record) => "handoff" in record).map((record) => record.at);
    expect(handoffs.map((from, turn) => secondsBetween({ from, to: firstVoiceAfterHandoff[turn] }))).toEqual([
      12.628, 10.957, 11.174, 16.56,
    ]);
    expect(handoffs.map((from, turn) => secondsBetween({ from, to: says[turn] }))).toEqual([0, 0.26, 0, 0]);
  });
});

describe("foldLookAck", () => {
  const ownerSaid = ({ id, text }: { id: string; text: string }): PlanEffect => ({
    final: false,
    id,
    kind: "segment",
    text,
    who: "owner",
  });
  const delegated: PlanEffect = { id: "d1", kind: "delegated", target: "codex" };

  it("owes nothing for a hand-off before the owner has spoken on the call", () => {
    const folded = foldLookAck({ effect: delegated, state: LOOK_ACK_START });
    expect(folded).toEqual({ say: undefined, state: LOOK_ACK_START });
  });

  it("owes nothing when the voice has already spoken since the hand-off", () => {
    let state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "so here it is" }), state: LOOK_ACK_START }).state;
    state = foldLookAck({ effect: delegated, state }).state;
    state = foldLookAck({ effect: { kind: "spoke" }, state }).state;
    const folded = foldLookAck({ effect: ownerSaid({ id: "t1", text: "so here it is, look at my screen" }), state });
    expect(folded.say).toBe(undefined);
  });

  it("never owes a turn's line twice, and owes the next turn's afresh", () => {
    let state = foldLookAck({
      effect: ownerSaid({ id: "t1", text: "look at my screen" }),
      state: LOOK_ACK_START,
    }).state;
    const first = foldLookAck({ effect: delegated, state });
    const again = foldLookAck({ effect: delegated, state: first.state });
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "and screenshot this" }), state: again.state }).state;
    const next = foldLookAck({ effect: delegated, state });
    expect([first.say, again.say, next.say]).toEqual(["look", undefined, "look"]);
  });

  it("never reopens a turn that had its line when a late segment of an earlier turn arrives between", () => {
    let state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "so here it is" }), state: LOOK_ACK_START }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "look at my screen" }), state }).state;
    const first = foldLookAck({ effect: delegated, state });
    state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "so here it is." }), state: first.state }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "look at my screen" }), state }).state;
    const again = foldLookAck({ effect: delegated, state });
    expect([first.say, again.say, again.state.saidTurns]).toEqual(["look", undefined, ["t2"]]);
  });

  // The hand-off of the owner's NEXT turn can arrive before that turn's first words.
  it("owes nothing for a turn the voice answered itself when the next turn's hand-off lands before its words", () => {
    let state = foldLookAck({
      effect: ownerSaid({ id: "t1", text: "look at my screen" }),
      state: LOOK_ACK_START,
    }).state;
    state = foldLookAck({ effect: { kind: "spoke" }, state }).state;
    const early = foldLookAck({ effect: delegated, state });
    const words = foldLookAck({ effect: ownerSaid({ id: "t2", text: "thanks" }), state: early.state });
    expect([early.say, words.say, words.state.saidTurns]).toEqual([undefined, undefined, []]);
  });

  it("keeps an answered turn answered when its late segment arrives after the next turn opened", () => {
    let state = foldLookAck({
      effect: ownerSaid({ id: "t1", text: "look at my screen" }),
      state: LOOK_ACK_START,
    }).state;
    state = foldLookAck({ effect: { kind: "spoke" }, state }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "thanks" }), state }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "look at my screen" }), state }).state;
    const folded = foldLookAck({ effect: delegated, state });
    expect([folded.say, folded.state.answeredTurns]).toEqual([undefined, ["t1"]]);
  });

  it("counts the open turn as answered when the voice speaks while a late segment of an older turn arrives", () => {
    let state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "so here it is" }), state: LOOK_ACK_START }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "look at my screen" }), state }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "so here it is." }), state }).state;
    state = foldLookAck({ effect: { kind: "spoke" }, state }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "look at my screen." }), state }).state;
    const folded = foldLookAck({ effect: delegated, state });
    expect([folded.say, folded.state.turnId, folded.state.answeredTurns]).toEqual([undefined, "t2", ["t1", "t2"]]);
  });

  /** A hand-off naming one turn of the owner's, as `delegation.created` does with `user_bidi_turn_id`. */
  const handing = ({ turnId }: { turnId: string }): PlanEffect => ({
    id: "d1",
    kind: "delegated",
    target: "codex",
    turnId,
  });

  // An answered turn's hand-off arriving after the owner's next turn opened is that turn's, not this one's.
  it("owes nothing when a late hand-off names an earlier turn the voice answered", () => {
    let state = foldLookAck({
      effect: ownerSaid({ id: "t1", text: "look at my screen" }),
      state: LOOK_ACK_START,
    }).state;
    state = foldLookAck({ effect: { kind: "spoke" }, state }).state;
    state = foldLookAck({ effect: ownerSaid({ id: "t2", text: "look at my screen" }), state }).state;
    const late = foldLookAck({ effect: handing({ turnId: "t1" }), state });
    const own = foldLookAck({ effect: handing({ turnId: "t2" }), state: late.state });
    expect([late.say, own.say]).toEqual([undefined, "look"]);
  });

  it("owes the line when a hand-off naming the owner's next turn arrives before that turn's words", () => {
    let state = foldLookAck({ effect: ownerSaid({ id: "t1", text: "thanks" }), state: LOOK_ACK_START }).state;
    state = foldLookAck({ effect: { kind: "spoke" }, state }).state;
    const early = foldLookAck({ effect: handing({ turnId: "t2" }), state });
    const words = foldLookAck({ effect: ownerSaid({ id: "t2", text: "look at my screen" }), state: early.state });
    expect([early.say, words.say]).toEqual([undefined, "look"]);
  });

  it("owes nothing for a hand-off of an ask that is neither a look nor a lookup", () => {
    const state = foldLookAck({
      effect: ownerSaid({ id: "t1", text: "take a look at the logs" }),
      state: LOOK_ACK_START,
    });
    expect(foldLookAck({ effect: delegated, state: state.state }).say).toBe(undefined);
  });

  // This hand-off came 12s before the voice's first words.
  it("owes a finding-it line for the owner's lookup ask once it is handed off, once", () => {
    const words =
      "It- it's the ABC-1 card... you can look it up, right? It's the one where it's asking... like... to merge the PR";
    const state = foldLookAck({ effect: ownerSaid({ id: "t1", text: words }), state: LOOK_ACK_START });
    const first = foldLookAck({ effect: delegated, state: state.state });
    const again = foldLookAck({ effect: delegated, state: first.state });
    expect([first.say, again.say]).toEqual(["find", undefined]);
  });

  it("owes the look line, not the lookup's, when one turn asks for both", () => {
    const words = "look at this queue card, bring it up, can you find it";
    const state = foldLookAck({ effect: ownerSaid({ id: "t1", text: words }), state: LOOK_ACK_START });
    expect(foldLookAck({ effect: delegated, state: state.state }).say).toBe("look");
  });
});

describe("isFindAsk", () => {
  it.each([
    " Um... It- it's the ABC-1 card... you can look that up, right?",
    "Surely you can find that",
    "can you find the Jasper card",
    "could you just go find that thread",
    "pull it up for me",
    "pull up the review bump",
    "bring up that card",
    "bring the queue card up",
    "look up the PR",
    "go and find it",
  ])("hears %j as a lookup ask", (text) => {
    expect(isFindAsk({ text })).toBe(true);
  });

  it.each([
    "I'll bring it up with Jasper tomorrow",
    "I find that pretty annoying",
    "we found the bug",
    "look into why staging is down",
    "Send it in drip feed style",
    "Great, that works. You can go ahead and send that one, tagging the Acme launch channel.",
    "",
  ])("does not hear %j as one", (text) => {
    expect(isFindAsk({ text })).toBe(false);
  });
});

describe("lookAskOf", () => {
  it("takes each ask of the closed set, and nothing else", () => {
    expect(lookAskOf({ body: { ask: "look" } })).toBe("look");
    expect(lookAskOf({ body: { ask: "find" } })).toBe("find");
    expect(lookAskOf({ body: { ask: "say this" } })).toBe(undefined);
    expect(lookAskOf({ body: {} })).toBe(undefined);
  });
});

describe("foldLookFrame", () => {
  const ownerSaid = ({ id, text }: { id: string; text: string }): PlanEffect => ({
    final: false,
    id,
    kind: "segment",
    text,
    who: "owner",
  });
  const delegated: PlanEffect = { id: "d1", kind: "delegated", target: "codex" };

  /** Fold effects in order, and whether each one owed a frame. */
  const framesOf = ({ effects }: { effects: readonly PlanEffect[] }) => {
    let state: LookFrameState = LOOK_FRAME_START;
    const frames: boolean[] = [];
    for (const effect of effects) {
      const folded = foldLookFrame({ effect, state });
      state = folded.state;
      frames.push(folded.frame);
    }
    return frames;
  };

  it("owes a frame for the owner's look ask once it is handed off, in either order, and only once", () => {
    expect(framesOf({ effects: [ownerSaid({ id: "t1", text: "look at my screen" }), delegated, delegated] })).toEqual([
      false,
      true,
      false,
    ]);
    expect(
      framesOf({
        effects: [ownerSaid({ id: "t1", text: "so" }), delegated, ownerSaid({ id: "t1", text: "so look at this" })],
      }),
    ).toEqual([false, false, true]);
  });

  it("still owes it after the voice has spoken, unlike the line, since the frame is for the answer", () => {
    const frames = framesOf({
      effects: [
        ownerSaid({ id: "t1", text: "so" }),
        delegated,
        { kind: "spoke" },
        ownerSaid({ id: "t1", text: "so look at my screen" }),
      ],
    });
    expect(frames).toEqual([false, false, false, true]);
  });

  it("owes nothing for a handed-off turn that never asked for a look", () => {
    const effects = [
      ownerSaid({ id: "t1", text: "archive it" }),
      delegated,
      ownerSaid({ id: "t2", text: "next one" }),
      delegated,
    ];
    expect(framesOf({ effects })).toEqual([false, false, false, false]);
  });

  it("owes nothing for a hand-off before the owner has spoken on the call", () => {
    expect(foldLookFrame({ effect: delegated, state: LOOK_FRAME_START })).toEqual({
      frame: false,
      state: LOOK_FRAME_START,
    });
  });

  // The owner's words are final, the voice said "Having a look now." and handed nothing off.
  const finished = ({ id, text }: { id: string; text: string }): PlanEffect => ({
    final: true,
    id,
    kind: "segment",
    text,
    who: "owner",
  });
  const ASK = "Could you look at my screen for a second";

  it("owes a frame the moment the owner's look ask is final, handed off or not, and never two", () => {
    const frames = framesOf({
      effects: [
        ownerSaid({ id: "t1", text: "Can you take a look" }),
        finished({ id: "t1", text: ASK }),
        { final: true, id: "v1", kind: "segment", text: "Having a look now.", who: "voice" },
        { kind: "spoke" },
        delegated,
      ],
    });
    expect(frames).toEqual([false, true, false, false, false]);
  });

  it("owes nothing for the owner's words before they are final, until a hand-off", () => {
    expect(framesOf({ effects: [ownerSaid({ id: "t1", text: ASK })] })).toEqual([false]);
    expect(
      framesOf({ effects: [ownerSaid({ id: "t1", text: ASK }), delegated, finished({ id: "t1", text: ASK })] }),
    ).toEqual([false, true, false]);
  });

  it("owes nothing for a final ask that is a lookup, not a look at the owner's screen", () => {
    expect(framesOf({ effects: [finished({ id: "t1", text: "can you find that card" })] })).toEqual([false]);
  });

  // The owner's and the voice's segments in the order the call recorded them. The console took no frame for any of
  // the owner's three turns; the voice said "You're right" 1 ms after the correction.
  it("owes one frame for each turn correcting a figure off the owner's screen, as the recorded call arrived", () => {
    const voice = ({ id, text }: { id: string; text: string }): PlanEffect => ({
      final: true,
      id,
      kind: "segment",
      text,
      who: "voice",
    });
    const frames = framesOf({
      effects: [
        ownerSaid({
          id: "EWXyYPUH1SYgiSoa68AJM",
          text: " Oh. Actually, hm, [laugh] . Okay, it actually says four hundred and",
        }),
        finished({
          id: "EWXyYPUH1SYgiSoa68AJM",
          text: " Oh. Actually, hm, [laugh] . Okay, it actually says four hundred and twenty dollars a month",
        }),
        voice({ id: "EWXydgFn4u3iE4b8Ue8u2", text: ' Right, US$420 a month, and "Priority' }),
        ownerSaid({ id: "EWXyhe5McQ0aikBQpg5Bz", text: " No" }),
        ownerSaid({
          id: "EWXyhe5McQ0aikBQpg5Bz",
          text: " No, four hundred and twenty dollars, not five hundred and twenty dollars",
        }),
        finished({
          id: "EWXyhe5McQ0aikBQpg5Bz",
          text: " No, four hundred and twenty dollars, not five hundred and twenty dollars. Four hundred and twenty dollars. Thanks",
        }),
        voice({ id: "EWXyl86gy2VIqSyhTVvN3", text: " You're right, 420 dollars a month, \"Priority" }),
        { kind: "spoke" },
        ownerSaid({
          id: "EWXyomaIuh1dzAYT9YLkS",
          text: " D- j- d- don't just agree with me. Just, just like, just, uh, hang on",
        }),
        delegated,
        finished({
          id: "EWXyomaIuh1dzAYT9YLkS",
          text: " D- j- d- don't just agree with me. Just, just like, just, uh, hang on I wa- I want you to check it, not agree. Just take another screenshot. I've zoomed in a bit",
        }),
      ],
    });
    expect(frames).toEqual([false, true, false, false, false, true, false, false, false, false, true]);
  });

  it("owes a frame for 'X, not Y' only when the voice's words just before it carried a figure", () => {
    const voice = ({ text }: { text: string }): PlanEffect => ({
      final: true,
      id: "v1",
      kind: "segment",
      text,
      who: "voice",
    });
    const correction = finished({ id: "t1", text: "it's 420, not 520" });
    expect(framesOf({ effects: [voice({ text: "It's US$520 a month." }), correction] })).toEqual([false, true]);
    expect(framesOf({ effects: [voice({ text: "Who should review it?" }), correction] })).toEqual([false, false]);
    expect(framesOf({ effects: [correction] })).toEqual([false]);
  });

  // A turn of the owner's in between means the next one is not "right after" the voice's figure.
  it("owes no frame for 'X, not Y' once another turn of the owner's has come between it and the voice's figure", () => {
    const effects: PlanEffect[] = [
      { final: true, id: "v1", kind: "segment", text: "It costs 520 dollars", who: "voice" },
      finished({ id: "t1", text: "Okay" }),
      finished({ id: "t2", text: "We should invite two reviewers, not three" }),
    ];
    expect(framesOf({ effects })).toEqual([false, false, false]);
  });

  it("keeps a hand-off naming a turn not yet heard for that turn, and takes the frame when its ask arrives", () => {
    const early: PlanEffect = { id: "d1", kind: "delegated", target: "codex", turnId: "t2" };
    const frames = framesOf({
      effects: [finished({ id: "t1", text: "so" }), early, ownerSaid({ id: "t2", text: "look at my screen" })],
    });
    expect(frames).toEqual([false, false, true]);
  });

  it("never hands the open turn a hand-off naming an earlier one", () => {
    const late: PlanEffect = { id: "d1", kind: "delegated", target: "codex", turnId: "t1" };
    const frames = framesOf({
      effects: [finished({ id: "t1", text: "so" }), ownerSaid({ id: "t2", text: "look at my screen" }), late],
    });
    expect(frames).toEqual([false, false, false]);
  });

  it("never takes a frame for a late final segment of an earlier turn, nor lets it take the open turn's place", () => {
    const frames = framesOf({
      effects: [
        ownerSaid({ id: "t1", text: "look at my" }),
        ownerSaid({ id: "t2", text: "and then" }),
        finished({ id: "t1", text: "look at my screen" }),
        finished({ id: "t2", text: "and then look at this" }),
      ],
    });
    expect(frames).toEqual([false, false, false, true]);
  });

  it("never reopens a framed turn when a late segment of an earlier turn arrives between", () => {
    const frames = framesOf({
      effects: [
        ownerSaid({ id: "t1", text: "so" }),
        ownerSaid({ id: "t2", text: "look at my screen" }),
        delegated,
        ownerSaid({ id: "t1", text: "so." }),
        ownerSaid({ id: "t2", text: "look at my screen" }),
        delegated,
      ],
    });
    expect(frames).toEqual([false, false, true, false, false, false]);
  });
});
