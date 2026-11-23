/*
 * A turn that already answered the owner is never handed to the voice again with nothing new of theirs to answer.
 * A turn steered the owner's question a second time after it began answers again, and saying both answers repeats the
 * same thing twice in two different ways.
 * The pure split first, then the same sequence through `HeldAnswers`; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import type { RpcOutcome } from "../../lib/talkPlanProtocol";
import { REPEAT_DETAIL, type StampedAnswer, splitRepeats } from "../../lib/talkPlanRepeatAnswer";
import { harness, settle } from "./heldAnswersHarness";

/** One answer of turn `t-1`, written at `completedSeq` having read the owner's utterance begun at `heardBeganSeq`. */
const stamped = ({
  itemId,
  heardBeganSeq,
  commentary = false,
  text = `${itemId} text`,
}: {
  itemId: string;
  heardBeganSeq: number | undefined;
  commentary?: boolean;
  text?: string;
}): StampedAnswer => ({ commentary, completedSeq: 0, heardBeganSeq, itemId, text, turnId: "t-1" });

/** Turn `t-1` started at arrival 5. */
const STARTED_AT_5 = new Map([["t-1", 5]]);

const never = (): boolean => false;

describe("splitRepeats", () => {
  it("keeps both of a turn's messages held in one release, which says them joined, and bars the turn at its start", () => {
    const first = stamped({ heardBeganSeq: 2, itemId: "a-1", text: "It's on your running list," });
    const again = stamped({ heardBeganSeq: 2, itemId: "a-2", text: "what do you think?" });
    const split = splitRepeats({
      answered: new Map(),
      superseded: never,
      taken: [first, again],
      turnStarts: STARTED_AT_5,
    });
    expect(split.kept.map((a) => a.itemId)).toEqual(["a-1", "a-2"]);
    expect(split.repeats).toEqual([]);
    expect([...split.answeredAfter]).toEqual([["t-1", 5]]);
  });

  it("drops an answer of a turn an earlier release already answered, with nothing of the owner's begun since", () => {
    const again = stamped({ heardBeganSeq: 2, itemId: "a-2" });
    const split = splitRepeats({ answered: STARTED_AT_5, superseded: never, taken: [again], turnStarts: STARTED_AT_5 });
    expect(split.kept).toEqual([]);
    expect(split.repeats.map((a) => a.itemId)).toEqual(["a-2"]);
    expect(split.answeredAfter.size).toBe(0);
  });

  it("keeps a second answer once an utterance of the owner's begun after the turn started has finished, bar unmoved", () => {
    const answersMore = stamped({ heardBeganSeq: 7, itemId: "a-2" });
    const split = splitRepeats({
      answered: STARTED_AT_5,
      superseded: never,
      taken: [answersMore],
      turnStarts: STARTED_AT_5,
    });
    expect(split.kept.map((a) => a.itemId)).toEqual(["a-2"]);
    expect(split.repeats).toEqual([]);
    expect(split.answeredAfter.size).toBe(0);
  });

  it("never judges commentary, a blank, a nod or a superseded message, and none of them answers the turn", () => {
    const taken = [
      stamped({ commentary: true, heardBeganSeq: 2, itemId: "c-1" }),
      stamped({ heardBeganSeq: 2, itemId: "n-1", text: "Mm-hmm." }),
      stamped({ heardBeganSeq: 2, itemId: "b-1", text: " " }),
      stamped({ heardBeganSeq: 2, itemId: "s-1" }),
      stamped({ heardBeganSeq: 2, itemId: "a-1" }),
    ];
    const superseded = (answer: StampedAnswer): boolean => answer.itemId === "s-1";
    const split = splitRepeats({ answered: new Map(), superseded, taken, turnStarts: STARTED_AT_5 });
    expect(split.kept.map((a) => a.itemId)).toEqual(["c-1", "n-1", "b-1", "s-1", "a-1"]);
    expect(split.repeats).toEqual([]);
  });

  it("bars a turn at its start even when a message could have read newer words", () => {
    const couldHaveRead = stamped({ heardBeganSeq: 7, itemId: "a-1" });
    const split = splitRepeats({
      answered: new Map(),
      superseded: never,
      taken: [couldHaveRead],
      turnStarts: STARTED_AT_5,
    });
    expect([...split.answeredAfter]).toEqual([["t-1", 5]]);
    const answersThem = stamped({ heardBeganSeq: 7, itemId: "a-2" });
    const next = splitRepeats({
      answered: split.answeredAfter,
      superseded: never,
      taken: [answersThem],
      turnStarts: STARTED_AT_5,
    });
    expect(next.kept.map((a) => a.itemId)).toEqual(["a-2"]);
  });

  it("bars nothing for a turn whose start was never seen, or seen only after it wrote", () => {
    const first = stamped({ heardBeganSeq: undefined, itemId: "a-1" });
    const unseen = splitRepeats({ answered: new Map(), superseded: never, taken: [first], turnStarts: new Map() });
    const late = splitRepeats({
      answered: new Map(),
      superseded: never,
      taken: [first],
      turnStarts: new Map([["t-1", 0]]),
    });
    expect(unseen.kept.map((a) => a.itemId)).toEqual(["a-1"]);
    expect(unseen.answeredAfter.size).toBe(0);
    expect(late.answeredAfter.size).toBe(0);
  });
});

describe("HeldAnswers, a turn steered the owner's question again after it answered", () => {
  it("hands the voice the turn's first answer and drops its second, saying why", async () => {
    const { clock, events, finishes, held, opens, spoken } = harness();
    // The owner's question opens; the voice hands it off and the turn starts before its transcript closes.
    opens({ words: "So, which questions on this card are still mine" });
    held.turnStarted({ turnId: "01a1b0b9" });
    finishes({ words: "So, which questions on this card are still mine?" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "msg-a", text: "One choice remains.", turnId: "01a1b0b9" } });
    await settle();
    held.hold({
      answer: { commentary: false, itemId: "msg-b", text: "What remains is one choice.", turnId: "01a1b0b9" },
    });
    await settle();
    expect(spoken).toEqual(["One choice remains."]);
    expect(events.at(-1)).toEqual({
      detail: REPEAT_DETAIL,
      itemId: "msg-b",
      kind: "held-answer",
      pending: false,
      phase: "dropped",
      turnId: "01a1b0b9",
    });
  });

  it("still says the turn's second answer when the owner asked something more after it started", async () => {
    const { clock, held, hears, saysMore, spoken } = harness();
    hears({ words: "What do I need to answer?" });
    held.turnStarted({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    await settle();
    saysMore();
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "And the other thing is done.", turnId: "t-1" } });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "And the other thing is done."]);
  });

  it("still says the turn's next answer after new words that followed a taken resume", async () => {
    const { clock, finishes, held, opens, spoken } = harness();
    opens({ words: "What's left" });
    held.resumeAccepted();
    held.turnStarted({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    await settle();
    // A done with no delta before it, begun after the turn answered.
    finishes({ words: "And what about the deploy?" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "Deploy is next."]);
  });

  it("says the answer to words that finished while the turn's first answer was being written", async () => {
    const { clock, hears, held, spoken } = harness();
    held.turnStarted({ turnId: "t-1" });
    hears({ words: "And what about the deploy?" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    await settle();
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "Deploy is next."]);
  });

  it("still says a turn's answer when its only words before were half a sign-off split with another turn", async () => {
    const { clock, held, spoken, state } = harness();
    held.turnStarted({ turnId: "t-1" });
    held.turnStarted({ turnId: "t-2" });
    held.turnStarted({ turnId: "t-3" });
    state.blocked = "a test holds the floor";
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "It's on your running list,", turnId: "t-1" } });
    held.hold({ answer: { commentary: false, itemId: "b-1", text: "what do you think?", turnId: "t-2" } });
    held.hold({ answer: { commentary: false, itemId: "c-1", text: "Build passed.", turnId: "t-3" } });
    state.blocked = undefined;
    held.releaseNow({ why: "a test frees the floor" });
    await settle();
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["Build passed.", "Deploy is next."]);
  });

  it("says the answer to new words that continued an utterance whose done was lost, after a nudge", async () => {
    const { clock, finishes, held, opens, spoken } = harness();
    opens({ words: "So the old question" });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    held.releaseNow({ why: "the owner's nudge" });
    await settle();
    opens({ words: "And what about the deploy" });
    finishes({ words: "And what about the deploy?" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "Deploy is next."]);
  });

  it("says the answer to words whose done came in the same chunk as the write's result", async () => {
    const results: ((outcome: RpcOutcome) => void)[] = [];
    const { clock, finishes, held, opens, spoken } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          results.push(resolve);
        }),
    });
    opens({ words: "What's left" });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    held.releaseNow({ why: "the owner's nudge" });
    await settle();
    // The result and the done in one input chunk: the done is read before the awaited result is.
    results.shift()!({ kind: "result", result: {} });
    finishes({ words: "What's left, and the deploy?" });
    await settle();
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    results.shift()!({ kind: "result", result: {} });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "Deploy is next."]);
  });

  it("still says a turn's answer when another turn's text held the same words as its cut half", async () => {
    const { clock, held, spoken, state } = harness();
    held.turnStarted({ turnId: "t-1" });
    held.turnStarted({ turnId: "t-2" });
    held.turnStarted({ turnId: "t-3" });
    state.blocked = "a test holds the floor";
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "It's on your running list,", turnId: "t-1" } });
    held.hold({ answer: { commentary: false, itemId: "b-1", text: "what do you think?", turnId: "t-2" } });
    held.hold({
      answer: { commentary: false, itemId: "c-1", text: "The build passed; what do you think?", turnId: "t-3" },
    });
    state.blocked = undefined;
    held.releaseNow({ why: "a test frees the floor" });
    await settle();
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "b-2", text: "Deploy is next.", turnId: "t-2" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["The build passed; what do you think?", "Deploy is next."]);
  });

  it("still says a turn's answer when removing it would have completed another sign-off", async () => {
    const { clock, held, spoken, state } = harness();
    held.turnStarted({ turnId: "t-1" });
    held.turnStarted({ turnId: "t-2" });
    held.turnStarted({ turnId: "t-3" });
    state.blocked = "a test holds the floor";
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "It's on your running list,", turnId: "t-1" } });
    held.hold({ answer: { commentary: false, itemId: "b-1", text: "what do you think!!!", turnId: "t-2" } });
    held.hold({ answer: { commentary: false, itemId: "c-1", text: "what do you think?", turnId: "t-3" } });
    state.blocked = undefined;
    held.releaseNow({ why: "a test frees the floor" });
    await settle();
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "b-2", text: "Deploy is next.", turnId: "t-2" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["what do you think?", "Deploy is next."]);
  });

  it("says a repeat's turn again only after a release that may have spoken its first answer", async () => {
    const replies = [{ kind: "error", message: "busy" } as const, { kind: "result", result: {} } as const];
    const { clock, held, hears, spoken } = harness({ speak: () => Promise.resolve(replies.shift()!) });
    hears({ words: "What do I need to answer?" });
    held.turnStarted({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    await settle();
    clock.advance({ ms: 250 });
    await settle();
    // The refused write said nothing, so its retry is the turn's first answer, never a repeat of it.
    expect(spoken).toEqual(["One choice remains.", "One choice remains."]);
  });

  it("still says the turn's next answer after a write that timed out, since the owner may never have heard the first", async () => {
    const replies = [{ kind: "timeout" } as const, { kind: "result", result: {} } as const];
    const { clock, held, spoken } = harness({ speak: () => Promise.resolve(replies.shift()!) });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    await settle();
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "What remains is one choice.", turnId: "t-1" } });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "What remains is one choice."]);
  });

  it("still says a turn's answer when all it gave a taken release was a sign-off the release cut", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: "What's next?" });
    held.turnStarted({ turnId: "t-1" });
    held.turnStarted({ turnId: "t-2" });
    held.hold({ answer: { commentary: false, itemId: "a-1a", text: "It's on your running list,", turnId: "t-1" } });
    held.hold({ answer: { commentary: false, itemId: "a-1b", text: "what do you think?", turnId: "t-1" } });
    held.hold({ answer: { commentary: false, itemId: "b-1", text: "The build passed.", turnId: "t-2" } });
    clock.advance({ ms: 5_000 });
    await settle();
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["The build passed.", "Deploy is next."]);
  });

  it("says each answer once when a listener of a repeat's dropped line holds another", async () => {
    const late = { commentary: false, itemId: "c-1", text: "Also, CI is green.", turnId: "t-3" };
    const { held, spoken, state } = harness({
      onEmit: (event) => {
        if (event.kind === "held-answer" && event.phase === "dropped") {
          held.hold({ answer: late });
        }
      },
    });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    await settle();
    state.blocked = "a test holds the floor";
    held.turnStarted({ turnId: "t-2" });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "What remains is one choice.", turnId: "t-1" } });
    held.hold({ answer: { commentary: false, itemId: "b-1", text: "The build passed.", turnId: "t-2" } });
    state.blocked = undefined;
    held.releaseNow({ why: "a test frees the floor" });
    await settle();
    // The batch leaves `held` before the line is written, so the release the listener's hold starts cannot say b-1 too.
    expect(spoken).toEqual(["One choice remains.", "Also, CI is green.", "The build passed."]);
  });

  it("says every answer of a turn whose start arrived only after it wrote, as before", async () => {
    const { clock, held, spoken } = harness();
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "One choice remains.", turnId: "t-1" } });
    held.turnStarted({ turnId: "t-1" });
    await settle();
    clock.advance({ ms: 5_000 });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "Deploy is next.", turnId: "t-1" } });
    await settle();
    expect(spoken).toEqual(["One choice remains.", "Deploy is next."]);
  });
});
