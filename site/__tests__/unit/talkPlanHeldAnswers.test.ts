/*
 * The thinking model's answers held off the voice until the owner's words go quiet (four answers were spoken over
 * the owner's unfinished clauses, the voice starting 1 ms after a transcript closed). The release rule over the
 * owner's real words, then the hold itself over a fake clock and plain injected functions; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import {
  type HeldAnswer,
  heldMessageKind,
  OWN_LIST_SIGN_OFF,
  RUNNING_LIST_LANDED_LINE,
  releaseTextOf,
  withoutSignOff,
} from "../../lib/talkPlanHeldRelease";
import type { RpcOutcome } from "../../lib/talkPlanProtocol";
import { answer, harness, MID_CLAUSE, settle } from "./heldAnswersHarness";

/** No turn landed an offer. */
const NONE_LISTED: ReadonlySet<string> = new Set();

/** No turn still running, none started and nothing of the owner's finished: no held message is superseded, no line owed. */
const NOT_RUNNING = {
  latestHeardDoneSeq: undefined,
  owedLine: false,
  runningTurns: new Set<string>(),
  turnStarts: new Map<string, number>(),
} as const;

describe("heldMessageKind", () => {
  it("reads each nod alone, closing marks and case aside, as a backchannel", () => {
    // "Mm-hmm. Uh-huh." in one message, and a quoted nod, are a backchannel too, never words.
    const nods = ["Mm-hmm.", "mm-hm", "MHM!", "Uh-huh…", "Hmm?", "  mm-hmm  ", "Mm-hmm. Uh-huh.", "mhm, mhm"];
    nods.push('"Mm-hmm"', "“Uh-huh.”", "(hmm)", "*mhm*", "mm-hmm -", "'mhm'");
    expect(nods.map((text) => heldMessageKind({ text }))).toEqual(nods.map(() => "backchannel"));
  });

  it("reads whitespace, a zero-width space and punctuation alone as blank", () => {
    const blanks = ["", "   ", "​", "\n\n", "…", "—"];
    expect(blanks.map((text) => heldMessageKind({ text }))).toEqual(blanks.map(() => "blank"));
  });

  it("reads a short real answer, and a nod with words after it, as substantive", () => {
    const answers = ["yes", "okay", "no", "hmm, no", "Mm-hmm, the build passed", "7"];
    expect(answers.map((text) => heldMessageKind({ text }))).toEqual(answers.map(() => "substantive"));
  });
});

describe("releaseTextOf", () => {
  it("says every held message in order, less commentary its own turn's answer has overtaken", () => {
    const held = [
      answer({ commentary: true, itemId: "c-1", turnId: "t-1" }),
      answer({ commentary: true, itemId: "c-2", turnId: "t-2" }),
      answer({ commentary: false, itemId: "a-1", turnId: "t-1" }),
    ];
    expect(releaseTextOf({ held, listed: NONE_LISTED, ...NOT_RUNNING })).toBe("c-2 text\n\na-1 text");
  });

  it("is empty with nothing, or only blank messages, held", () => {
    expect(releaseTextOf({ held: [], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("");
    const blank = { commentary: false, completedSeq: 0, itemId: "a", text: "  ", turnId: "t" };
    expect(releaseTextOf({ held: [blank], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("");
  });

  // A final nod never overtakes the turn's real commentary: dropped behind one, the voice would be handed neither.
  it("keeps a turn's commentary when its only answer is a nod or a blank, and drops it behind a real answer", () => {
    const checking = { commentary: true, completedSeq: 0, itemId: "c-1", text: "Checking the logs.", turnId: "t-1" };
    const nod = { commentary: false, completedSeq: 0, itemId: "n-1", text: "Mm-hmm.", turnId: "t-1" };
    const blank = { ...nod, itemId: "b-1", text: " " };
    const other = { commentary: false, completedSeq: 0, itemId: "a-2", text: "The build passed.", turnId: "t-2" };
    const real = { ...nod, itemId: "a-1", text: "Nothing in the logs." };
    const read = ({ held }: { held: HeldAnswer[] }) => releaseTextOf({ held, listed: NONE_LISTED, ...NOT_RUNNING });
    expect(read({ held: [checking, nod, other] })).toBe("Checking the logs.\n\nThe build passed.");
    expect(read({ held: [checking, blank] })).toBe("Checking the logs.");
    expect(read({ held: [checking, real] })).toBe("Nothing in the logs.");
    // Two nods joined are not words either, so they never overtake the commentary.
    const uhHuh = { ...nod, itemId: "n-2", text: "Uh-huh." };
    expect(read({ held: [checking, nod, uhHuh] })).toBe("Checking the logs.");
    expect(read({ held: [checking, nod, blank] })).toBe("Checking the logs.");
  });

  // Two answers that join into only the sign-off never overtake the turn's commentary.
  it("keeps a turn's commentary when its answers join into nothing but a split running-list sign-off", () => {
    const checking = { commentary: true, completedSeq: 0, itemId: "c-1", text: "Checking the logs.", turnId: "t-1" };
    const first = {
      commentary: false,
      completedSeq: 1,
      itemId: "a-1",
      text: "It's on your running list,",
      turnId: "t-1",
    };
    const second = { ...first, completedSeq: 2, itemId: "a-2", text: "what do you think?" };
    expect(releaseTextOf({ held: [checking, first, second], listed: NONE_LISTED, ...NOT_RUNNING })).toBe(
      "Checking the logs.",
    );
  });

  it("is empty with only a backchannel held, and keeps an answer beside one", () => {
    const nod = { commentary: false, completedSeq: 0, itemId: "n", text: "Mm-hmm.", turnId: "t" };
    expect(releaseTextOf({ held: [nod], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("");
    const said = answer({ commentary: false, itemId: "a", turnId: "t" });
    expect(releaseTextOf({ held: [said, nod], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("a text");
  });

  // The thinking model wrote this, no offer_copy was made all call, and the voice said it with "That's on your running list, what do you think?" on the end.
  it("never says a draft is on the owner's running list for a turn that landed no offer", () => {
    const said =
      "One shared definition, then. That's the last design choice in this pass. The proposal still flags a live " +
      "check of Vanta's person lookup as outstanding; that's technical verification for the fleet.";
    const text = releaseTextOf({
      held: [{ commentary: false, completedSeq: 0, itemId: "a-1", text: said, turnId: "t-1" }],
      listed: NONE_LISTED,
      ...NOT_RUNNING,
    });
    expect(text).toBe(said);
    expect(text.toLowerCase()).not.toContain("running list");
  });

  it("ends only the answer of a turn whose offer landed on the console's line, after its words", () => {
    const held = [
      answer({ commentary: false, itemId: "a-1", turnId: "t-1" }),
      answer({ commentary: true, itemId: "c-2", turnId: "t-2" }),
      answer({ commentary: false, itemId: "a-2", turnId: "t-2" }),
    ];
    expect(releaseTextOf({ held, listed: new Set(["t-2"]), ...NOT_RUNNING })).toBe(
      `a-1 text\n\na-2 text ${RUNNING_LIST_LANDED_LINE}`,
    );
    expect(RUNNING_LIST_LANDED_LINE).toBe("It's on your running list, what do you think?");
  });

  // A sign-off the thinking model writes itself would otherwise reach the voice with no offer behind it.
  it("cuts a sign-off the thinking model wrote itself, so the line is the console's or absent, never twice", () => {
    const own = ({ text, commentary }: { text: string; commentary: boolean }) => ({
      commentary,
      completedSeq: 0,
      itemId: "a-1",
      text,
      turnId: "t-1",
    });
    const signedOff = own({
      commentary: false,
      text: "A reply to Seth. That’s on your running list, what do you think?",
    });
    expect(releaseTextOf({ held: [signedOff], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("A reply to Seth.");
    expect(releaseTextOf({ held: [signedOff], listed: new Set(["t-1"]), ...NOT_RUNNING })).toBe(
      `A reply to Seth. ${RUNNING_LIST_LANDED_LINE}`,
    );
    // Two in a row are one run, cut whole.
    const twice = own({ commentary: false, text: `A reply. ${RUNNING_LIST_LANDED_LINE} ${RUNNING_LIST_LANDED_LINE}` });
    expect(releaseTextOf({ held: [twice], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("A reply.");
    expect(releaseTextOf({ held: [twice], listed: new Set(["t-1"]), ...NOT_RUNNING })).toBe(
      `A reply. ${RUNNING_LIST_LANDED_LINE}`,
    );
    const commentary = own({ commentary: true, text: "Drafting. It is on your running list what do you think" });
    expect(releaseTextOf({ held: [commentary], listed: new Set(["t-1"]), ...NOT_RUNNING })).toBe("Drafting.");
    // Mid-answer or quoted, the voice says it all the same, so it is cut wherever it sits.
    const quoted = own({
      commentary: false,
      text: 'I kept saying "it\'s on your running list, what do you think?" with nothing added. That was the bug.',
    });
    expect(releaseTextOf({ held: [quoted], listed: NONE_LISTED, ...NOT_RUNNING })).toBe(
      "I kept saying with nothing added. That was the bug.",
    );
    const midAnswer = own({
      commentary: false,
      text: "Draft done. It's on your running list, what do you think? We can discuss timing next.",
    });
    expect(releaseTextOf({ held: [midAnswer], listed: NONE_LISTED, ...NOT_RUNNING })).toBe(
      "Draft done. We can discuss timing next.",
    );
    // A cut can join halves into a new sign-off, so it is cut until none is left.
    const nested = own({
      commentary: false,
      text:
        "It's on your running list, It's on your running list, It's on your running list, what do you think? " +
        "what do you think?what do you think?",
    });
    expect(releaseTextOf({ held: [nested], listed: NONE_LISTED, ...NOT_RUNNING })).toBe("");
    expect(withoutSignOff({ text: `A. ${nested.text} B.` })).toBe("A. B.");
    // Split over two messages, it would be whole again once they are joined.
    const split = [
      { commentary: false, completedSeq: 0, itemId: "a-1", text: "Done. It's on your running list,", turnId: "t-1" },
      {
        commentary: false,
        completedSeq: 0,
        itemId: "a-2",
        text: "what do you think? Next, the ISO PR.",
        turnId: "t-1",
      },
    ];
    expect(releaseTextOf({ held: split, listed: NONE_LISTED, ...NOT_RUNNING })).toBe("Done. Next, the ISO PR.");
    expect(releaseTextOf({ held: split, listed: new Set(["t-1"]), ...NOT_RUNNING })).toBe(
      `Done. Next, the ISO PR. ${RUNNING_LIST_LANDED_LINE}`,
    );
  });

  // `src/__tests__/unit/talk/listSignOffMirror.test.ts` holds this restated cut equal to the continuity cut.
  it("cuts every form of the sign-off, and its own line is one", () => {
    expect(`Done. ${RUNNING_LIST_LANDED_LINE}`.replace(OWN_LIST_SIGN_OFF, "")).toBe("Done.");
    // The halves split, or the line ended, by any run of punctuation are the same sign-off.
    expect(
      [
        "A reply. It's on your running list. What do you think?",
        "A reply. That is on your running list — what do you think.",
        "A reply. It’s on your running list; what do you think",
        "A reply. It's on your running list? What do you think?",
        "A reply. It’s on your running list… what do you think?!",
        "A reply. It's on your running list... what do you think?\"",
        // No word boundary is needed before it, so a glued digit or letter does not hide it.
        "A reply.1It's on your running list, what do you think?",
      ].map((text) => text.replace(OWN_LIST_SIGN_OFF, "")),
    ).toEqual(["A reply.", "A reply.", "A reply.", "A reply.", "A reply.", "A reply.", "A reply.1"]);
  });

  it("says the console's line alone when a landed offer's answer is blank, and never on commentary", () => {
    const listed = new Set(["t-1"]);
    const blank = { commentary: false, completedSeq: 0, itemId: "a-1", text: " ", turnId: "t-1" };
    expect(releaseTextOf({ held: [blank], listed, ...NOT_RUNNING })).toBe(RUNNING_LIST_LANDED_LINE);
    const commentary = answer({ commentary: true, itemId: "c-1", turnId: "t-1" });
    expect(releaseTextOf({ held: [commentary], listed, ...NOT_RUNNING })).toBe("c-1 text");
  });

  // A turn answering in two messages must not say the line after each.
  it("says the line once for a turn answering in two messages, after the last of them", () => {
    const held = [
      answer({ commentary: false, itemId: "a-1", turnId: "t-1" }),
      answer({ commentary: false, itemId: "a-2", turnId: "t-1" }),
      answer({ commentary: true, itemId: "c-2", turnId: "t-2" }),
    ];
    expect(releaseTextOf({ held, listed: new Set(["t-1"]), ...NOT_RUNNING })).toBe(
      `a-1 text\n\na-2 text ${RUNNING_LIST_LANDED_LINE}\n\nc-2 text`,
    );
  });

  // Measured: a turn's commentary `…8bdc7` re-read the last card's question, the owner's "No, no, don't send it"
  // closed, and the voice still said `…8bdc7` before the same turn's `…ce4ff` "Do not send it" — the owner hung up 3s
  // later. Those three arrived in that order, numbered 1, 2 and 3.
  it("drops 8bdc7 after the owner's done and speaks only ce4ff when the running turn answers", () => {
    const turnId = "01a16335";
    const restated = {
      commentary: true,
      completedSeq: 1,
      itemId: "8bdc7",
      text: "Do I send that note to Felix, revise it, or park it?",
      turnId,
    };
    const doNotSend = {
      commentary: false,
      completedSeq: 3,
      itemId: "ce4ff",
      text: "Do not send it. You gave no approval.",
      turnId,
    };
    const base = { latestHeardDoneSeq: 2, listed: NONE_LISTED, owedLine: false, turnStarts: new Map<string, number>() };
    const running = new Set([turnId]);
    expect(releaseTextOf({ ...base, held: [restated], runningTurns: running })).toBe("");
    expect(releaseTextOf({ ...base, held: [restated, doNotSend], runningTurns: running })).toBe(doNotSend.text);
    // Its turn already complete, or completed after the owner's newest done, the commentary is not the owner's words' to overtake.
    expect(releaseTextOf({ ...base, held: [restated], runningTurns: new Set() })).toBe(restated.text);
    const after = { ...restated, completedSeq: 3 };
    expect(releaseTextOf({ ...base, held: [after], runningTurns: running })).toBe(restated.text);
  });

  // Measured: a turn's `…e28be` and `…3271` arrived 1 and 2, its turn complete, and a newer turn's start arrived 3.
  // The voice said them anyway, over the card the owner had just ruled on.
  it("drops an older turn's answer and commentary once a newer turn started, its own turn complete", () => {
    const old = [
      { commentary: true, completedSeq: 1, itemId: "e28be", text: "Next is Jasper's question.", turnId: "01a16675" },
      { commentary: false, completedSeq: 2, itemId: "3271", text: "Which reply to Jasper?", turnId: "01a16675" },
    ];
    const newer = { commentary: false, completedSeq: 4, itemId: "f620", text: "Address both?", turnId: "01a1667b" };
    const started = { ...NOT_RUNNING, listed: NONE_LISTED, turnStarts: new Map([["01a1667b", 3]]) };
    expect(releaseTextOf({ ...started, held: old })).toBe("");
    expect(releaseTextOf({ ...started, held: [...old, newer] })).toBe("Address both?");
    // Completed after that start, it is the newer turn's own, and said.
    expect(releaseTextOf({ ...started, held: [newer] })).toBe("Address both?");
    // Its own turn's start, delivered after it, overtakes nothing.
    const lateOwnStart = { ...NOT_RUNNING, listed: NONE_LISTED, turnStarts: new Map([["01a16675", 3]]) };
    expect(releaseTextOf({ ...lateOwnStart, held: old })).toBe("Which reply to Jasper?");
  });

  it("says an owed line once, after the last answer kept, unless the release says a listed turn's own", () => {
    const held = [
      answer({ commentary: false, itemId: "a-1", turnId: "t-1" }),
      answer({ commentary: true, itemId: "c-2", turnId: "t-2" }),
    ];
    const owed = { ...NOT_RUNNING, owedLine: true };
    expect(releaseTextOf({ ...owed, held, listed: NONE_LISTED })).toBe(
      `a-1 text ${RUNNING_LIST_LANDED_LINE}\n\nc-2 text`,
    );
    expect(releaseTextOf({ ...owed, held, listed: new Set(["t-1"]) })).toBe(
      `a-1 text ${RUNNING_LIST_LANDED_LINE}\n\nc-2 text`,
    );
    // Commentary alone keeps no answer to say it after, so it stays owed.
    expect(releaseTextOf({ ...owed, held: [held[1]], listed: NONE_LISTED })).toBe("c-2 text");
  });
});

describe("HeldAnswers", () => {
  it("holds an answer landing mid-clause and hands it over five seconds after the owner's last words", async () => {
    const { clock, events, held, hears, spoken, voicedAt } = harness();
    hears({ words: MID_CLAUSE });
    clock.advance({ ms: 1_000 });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    expect(held.count()).toBe(1);
    clock.advance({ ms: 3_900 });
    await settle();
    expect(spoken).toEqual([]);
    clock.advance({ ms: 100 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(voicedAt).toEqual([5_000]);
    expect(held.count()).toBe(0);
    expect(events).toEqual([
      {
        detail: "the owner is still talking",
        itemId: "a-1",
        kind: "held-answer",
        pending: true,
        phase: "held",
        turnId: "t-1",
      },
      {
        detail: "the owner's words went quiet",
        itemId: "a-1",
        kind: "held-answer",
        pending: true,
        phase: "handing",
        turnId: "t-1",
      },
      {
        detail: "the owner's words went quiet",
        itemId: "a-1",
        kind: "held-answer",
        pending: false,
        phase: "released",
        turnId: "t-1",
      },
    ]);
  });

  // The page's rollover reads `pending`, so a release overtaken mid-write must not clear it.
  it("says a newer answer held during a release is still owed when that release lands, and none once it is handed", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const { clock, events, held } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          landings.push(resolve);
        }),
    });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    clock.advance({ ms: 250 });
    await settle();
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(events.map((e) => [e.kind === "held-answer" && e.phase, e.kind === "held-answer" && e.pending])).toEqual([
      ["handing", true],
      ["held", true],
      ["released", true],
      ["handing", true],
      ["released", false],
    ]);
  });

  // Released the moment it completes, an answer is never `held`, and the voice's write can take
  // its whole timeout — the page's rollover must still read it as owed until that write lands.
  it("says an answer handed over at once is owed while the voice's write is unanswered", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const { clock, events, held } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          landings.push(resolve);
        }),
    });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 9_000 });
    await settle();
    const owed = events.map((e) => [e.kind === "held-answer" && e.phase, e.kind === "held-answer" && e.pending]);
    expect(owed).toEqual([["handing", true]]);
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(events.map((e) => [e.kind === "held-answer" && e.phase, e.kind === "held-answer" && e.pending])).toEqual([
      ["handing", true],
      ["released", false],
    ]);
  });

  it("keeps holding while the owner carries on, from their newest words", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: "by update prompt, we mean" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 4_000 });
    hears({ words: " the full-page block" });
    clock.advance({ ms: 4_000 });
    await settle();
    expect(spoken).toEqual([]);
    clock.advance({ ms: 1_000 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
  });

  it("hands an answer over at once when the floor is already free, with no held line", async () => {
    const { events, held, spoken } = harness();
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(events.map((e) => e.kind === "held-answer" && e.phase)).toEqual(["handing", "released"]);
  });

  it("hands everything held over in one write, the overtaken commentary dropped", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    held.hold({ answer: answer({ commentary: true, itemId: "c-1", turnId: "t-1" }) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 12_000 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
  });

  it("goes at once on the owner's nudge, but never past another of the call's own writes, saying what freed it", async () => {
    const { events, held, hears, spoken, state } = harness();
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    state.blocked = "a look line is being sent";
    expect(held.releaseNow({ why: "the owner nudged" })).toBe(false);
    state.blocked = undefined;
    expect(held.releaseNow({ why: "the owner nudged" })).toBe(true);
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(events.slice(-2).map((e) => e.kind === "held-answer" && [e.phase, e.detail])).toEqual([
      ["handing", "the owner nudged"],
      ["released", "the owner nudged"],
    ]);
    expect(held.releaseNow({ why: "the owner nudged" })).toBe(false);
  });

  it("tries a release the session refused outright again, and hands it over once it is taken", async () => {
    const replies: RpcOutcome[] = [
      { kind: "error", message: "busy" },
      { kind: "result", result: {} },
    ];
    const { clock, events, held, spoken } = harness({ speak: () => Promise.resolve(replies.shift()!) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    for (let i = 0; i < 4; i += 1) {
      await settle();
      clock.advance({ ms: 250 });
    }
    expect(spoken).toEqual(["a-1 text", "a-1 text"]);
    const message = "the voice did not take the thinking model's answer, trying again: busy";
    const failed = { detail: message, itemId: "a-1", kind: "held-answer", phase: "failed", turnId: "t-1" } as const;
    expect(events).toEqual([
      { ...failed, detail: "the floor was free", pending: true, phase: "handing" },
      { kind: "error", message },
      // Put back for the next free floor, so still owed.
      { ...failed, pending: true },
      { ...failed, detail: "the owner's words went quiet", pending: true, phase: "handing" },
      { ...failed, detail: "the owner's words went quiet", pending: false, phase: "released" },
    ]);
    expect(held.count()).toBe(0);
  });

  // A turn answering in two messages, released apart, must not say the line after each.
  it("says the running-list line once per landed offer's turn, across releases and a second offer in it", async () => {
    const { held, saysMore, spoken } = harness();
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    await settle();
    saysMore();
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-1" }) });
    await settle();
    held.offerLanded({ turnId: "t-1" });
    saysMore();
    held.hold({ answer: answer({ commentary: false, itemId: "a-3", turnId: "t-1" }) });
    await settle();
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`, "a-2 text", "a-3 text"]);
  });

  it("keeps the line on a release refused outright, since that write said nothing", async () => {
    const replies: RpcOutcome[] = [
      { kind: "error", message: "busy" },
      { kind: "result", result: {} },
    ];
    const { clock, held, spoken } = harness({ speak: () => Promise.resolve(replies.shift()!) });
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    for (let i = 0; i < 4; i += 1) {
      await settle();
      clock.advance({ ms: 250 });
    }
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`, `a-1 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  it("gives a release up after three outright refusals, saying so", async () => {
    const { clock, events, held, spoken } = harness({
      speak: () => Promise.resolve({ kind: "error", message: "no session" }),
    });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    for (let i = 0; i < 8; i += 1) {
      await settle();
      clock.advance({ ms: 250 });
    }
    expect(spoken).toEqual(["a-1 text", "a-1 text", "a-1 text"]);
    const message = "the voice was not handed the thinking model's answer in 3 tries: no session";
    expect(events.slice(-2)).toEqual([
      { kind: "error", message },
      { detail: message, itemId: "a-1", kind: "held-answer", pending: false, phase: "failed", turnId: "t-1" },
    ]);
    expect(held.count()).toBe(0);
  });

  it("never tries again a release that timed out, since the voice may still say it, and starts the next count afresh", async () => {
    const busy: RpcOutcome = { kind: "error", message: "busy" };
    const replies: RpcOutcome[] = [busy, { kind: "timeout" }, busy, busy, busy];
    const { clock, events, held, spoken } = harness({ speak: () => Promise.resolve(replies.shift()!) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    for (let i = 0; i < 8; i += 1) {
      await settle();
      clock.advance({ ms: 250 });
    }
    expect(spoken).toEqual(["a-1 text", "a-1 text"]);
    const message =
      "the voice may not have been handed the thinking model's answer, and it is not tried again so it is never said twice: no answer in time";
    expect(events.slice(-2)).toEqual([
      { kind: "error", message },
      { detail: message, itemId: "a-1", kind: "held-answer", pending: false, phase: "failed", turnId: "t-1" },
    ]);
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    for (let i = 0; i < 8; i += 1) {
      await settle();
      clock.advance({ ms: 250 });
    }
    expect(spoken.filter((text) => text === "a-2 text")).toEqual(["a-2 text", "a-2 text", "a-2 text"]);
  });

  it("reads the owner's finished words, not the deltas a done corrected, before giving the 2s after over", async () => {
    const { clock, finishes, held, opens, spoken } = harness();
    opens({ words: "I think that's all, over" });
    clock.advance({ ms: 1_000 });
    finishes({ words: "I think that's all, over there" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 4_900 });
    await settle();
    expect(spoken).toEqual([]);
    clock.advance({ ms: 100 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
  });

  // A blank after nearly every answer read on the stream as an error, the voice handed nothing.
  it("traces a blank answer as dropped, no fault, and hands the voice nothing", async () => {
    const { events, handed, held, spoken } = harness();
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "  ", turnId: "t-1" } });
    await settle();
    expect(spoken).toEqual([]);
    expect(handed).toEqual([]);
    expect(events).toEqual([
      {
        detail: "the message was blank, so there was nothing to hand the voice",
        itemId: "a-1",
        kind: "held-answer",
        pending: false,
        phase: "dropped",
        turnId: "t-1",
      },
    ]);
    expect(held.count()).toBe(0);
  });

  // A turn wrote "Mm-hmm." over the owner's unfinished clause; handed it, the voice said
  // "I'm following that and checking it now" and nothing was ever checked.
  it("never hands the voice a lone backchannel, and traces it as dropped", async () => {
    const { events, handed, held, spoken } = harness();
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "Mm-hmm.", turnId: "01a19738" } });
    await settle();
    expect(spoken).toEqual([]);
    expect(handed).toEqual([]);
    expect(events).toEqual([
      {
        detail: "the message was only a backchannel, so there was nothing to hand the voice",
        itemId: "a-1",
        kind: "held-answer",
        pending: false,
        phase: "dropped",
        turnId: "01a19738",
      },
    ]);
  });

  it("hands only the answer of a release that also holds a trailing blank, naming the turn it answered", async () => {
    const { clock, events, handed, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.hold({ answer: { commentary: false, itemId: "a-2", text: "​", turnId: "t-1" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(handed).toEqual([{ answered: ["t-1"], commented: [] }]);
    expect(events.map((e) => e.kind === "held-answer" && [e.phase, e.itemId, e.pending])).toEqual([
      ["held", "a-1", true],
      ["held", "a-2", true],
      ["dropped", "a-2", true],
      ["handing", "a-2", true],
      ["released", "a-2", false],
    ]);
  });

  it("names no turn handed when the voice refused the write outright", async () => {
    const { handed, held } = harness({ speak: () => Promise.resolve({ kind: "error", message: "busy" }) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    await settle();
    expect(handed).toEqual([]);
  });

  it("names the turn handed on a timeout, since the voice may have said it", async () => {
    const { handed, held } = harness({ speak: () => Promise.resolve({ kind: "timeout" }) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    await settle();
    expect(handed).toEqual([{ answered: ["t-1"], commented: [] }]);
  });

  it("names a turn whose commentary alone went as commented, never answered", async () => {
    const { clock, handed, held, hears } = harness();
    held.hold({ answer: answer({ commentary: true, itemId: "c-1", turnId: "t-1" }) });
    await settle();
    hears({ words: "and the other thing" });
    held.hold({ answer: answer({ commentary: true, itemId: "c-2", turnId: "t-2" }) });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(handed).toEqual([
      { answered: [], commented: ["t-1"] },
      { answered: ["t-2"], commented: [] },
    ]);
  });

  // The counterexample, released together.
  it("hands a turn's commentary beside its lone nod, naming it commented and the other turn answered", async () => {
    const { clock, handed, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    held.hold({
      answer: { commentary: true, itemId: "c-1", text: "Checking the logs.", turnId: "t-1" },
    });
    held.hold({ answer: { commentary: false, itemId: "n-1", text: "Mm-hmm.", turnId: "t-1" } });
    held.hold({
      answer: { commentary: false, itemId: "a-2", text: "The build passed.", turnId: "t-2" },
    });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["Checking the logs.\n\nThe build passed."]);
    expect(handed).toEqual([{ answered: ["t-2"], commented: ["t-1"] }]);
  });

  // The counterexample: t-1's line, owed once t-2 overtook it, rides t-2's answer.
  it("names the overtaken turn whose owed running-list line a release says as answered", async () => {
    const { clock, handed, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    clock.advance({ ms: 5_000 });
    await settle();
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
    expect(handed).toEqual([{ answered: ["t-2", "t-1"], commented: [] }]);
  });

  // The sign-off split across t-1's two messages is cut from their join.
  it("never names a turn handed whose only words were a sign-off split across two of its messages", async () => {
    const { clock, handed, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    const t1 = { commentary: false, turnId: "t-1" };
    held.hold({ answer: { ...t1, itemId: "a-1", text: "It's on your running list," } });
    held.hold({ answer: { ...t1, itemId: "a-2", text: "what do you think?" } });
    held.hold({ answer: answer({ commentary: false, itemId: "a-3", turnId: "t-2" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-3 text"]);
    expect(handed).toEqual([{ answered: ["t-2"], commented: [] }]);
  });

  // t-2's answer between the halves never keeps the sign-off from being cut.
  it("cuts a turn's split sign-off with another turn's answer between its halves, and keeps its commentary", async () => {
    const { clock, handed, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    const t1 = { commentary: false, turnId: "t-1" };
    held.hold({ answer: { ...t1, commentary: true, itemId: "c-1", text: "Checking the logs." } });
    held.hold({ answer: { ...t1, itemId: "a-1", text: "It's on your running list," } });
    held.hold({ answer: { ...t1, itemId: "a-2", text: "The build passed.", turnId: "t-2" } });
    held.hold({ answer: { ...t1, itemId: "a-3", text: "what do you think?" } });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["Checking the logs.\n\nThe build passed."]);
    expect(handed).toEqual([{ answered: ["t-2"], commented: ["t-1"] }]);
  });

  it("names a turn whose commentary a real answer overtook as answered, never commented", async () => {
    const { clock, handed, held, hears, spoken } = harness();
    hears({ words: "and the other thing" });
    held.hold({
      answer: { commentary: true, itemId: "c-1", text: "Checking the logs.", turnId: "t-1" },
    });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(handed).toEqual([{ answered: ["t-1"], commented: [] }]);
  });

  it("says the running-list line when the landed offer's only answer is a nod, and names that turn handed", async () => {
    const { handed, held, spoken } = harness();
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: { commentary: false, itemId: "a-1", text: "Mhm", turnId: "t-1" } });
    await settle();
    expect(spoken).toEqual([RUNNING_LIST_LANDED_LINE]);
    expect(handed).toEqual([{ answered: ["t-1"], commented: [] }]);
  });

  // Replayed from the owner's bug report's done (the clock's zero): a turn's commentary `…8bdc7` completes at 3.3s as
  // the voice says "Send it, then.", the owner's "No, no, don't send it" is last transcribed at 6.07s and closes at
  // 11.76s, and the same turn's answer `…ce4ff` completes at 19.23s. Measured: the voice was handed `…8bdc7` at 11.07s
  // — five seconds after that delta, "the owner's words went quiet", with them still open — and said it before
  // `…ce4ff`.
  it("does not release 8bdc7 at 10:43:19.040 while EbkYIU3za87J399keZGgc is open, then drops it for ce4ff", async () => {
    const { clock, events, finishes, held, opens, spoken, state } = harness();
    const turnId = "01a16335";
    state.running.add(turnId);
    finishes({ words: "the console voice dropped out twice" });
    clock.advance({ ms: 3_300 });
    state.voiceAt = clock.nowMs();
    held.hold({ answer: { commentary: true, itemId: "8bdc7", text: "Send it, revise it, or park it?", turnId } });
    clock.advance({ ms: 1_700 });
    state.voiceAt = clock.nowMs();
    clock.advance({ ms: 1_070 });
    opens({ words: "No, no," });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([]);
    expect(held.count()).toBe(1);
    clock.advance({ ms: 690 });
    finishes({ words: "No, no, don't send it." });
    clock.advance({ ms: 5_250 });
    await settle();
    expect(spoken).toEqual([]);
    expect(held.count()).toBe(0);
    expect(events.at(-1)).toEqual({
      detail: "the owner's words since it reached turn 01a16335, still running, whose answer is the one owed",
      itemId: "8bdc7",
      kind: "held-answer",
      pending: false,
      phase: "dropped",
      turnId,
    });
    clock.advance({ ms: 2_220 });
    held.hold({ answer: { commentary: false, itemId: "ce4ff", text: "Do not send it.", turnId } });
    await settle();
    expect(spoken).toEqual(["Do not send it."]);
  });

  it("speaks the commentary when the done that closed the owner's utterance carried no words", async () => {
    const { clock, events, finishes, held, opens, spoken, state } = harness();
    const turnId = "01a16335";
    state.running.add(turnId);
    finishes({ words: "the console voice dropped out twice" });
    clock.advance({ ms: 3_300 });
    state.voiceAt = clock.nowMs();
    held.hold({ answer: { commentary: true, itemId: "8bdc7", text: "Send it, revise it, or park it?", turnId } });
    clock.advance({ ms: 1_700 });
    state.voiceAt = clock.nowMs();
    clock.advance({ ms: 1_070 });
    opens({ words: "No, no," });
    clock.advance({ ms: 5_690 });
    await settle();
    expect(spoken).toEqual([]);
    finishes({ words: " ​ " });
    clock.advance({ ms: 5_250 });
    await settle();
    expect(spoken).toEqual(["Send it, revise it, or park it?"]);
    expect(events.some((event) => event.kind === "held-answer" && event.phase === "dropped")).toBe(false);
  });

  it("speaks commentary completed after the owner's worded done even when the wall clock stepped back between them", async () => {
    const { clock, events, held, spoken, state } = harness();
    const turnId = "01a16335";
    state.running.add(turnId);
    // The owner's done is stamped 10,000ms, then the clock steps back to 0 before the commentary completes.
    state.heardAt = clock.nowMs();
    held.heard({ atMs: 10_000, phase: "done", text: "½" });
    held.hold({ answer: { commentary: true, itemId: "c-1", text: "Send it, revise it, or park it?", turnId } });
    clock.advance({ ms: 5_250 });
    await settle();
    expect(spoken).toEqual(["Send it, revise it, or park it?"]);
    expect(events.some((event) => event.kind === "held-answer" && event.phase === "dropped")).toBe(false);
  });

  // Replayed from the clock's zero, when the owner's utterance about Jasper's card opened. A turn writes `…e28be` at
  // 9.695s and `…3271` at 17.761s, both held while the owner talks, and completes. The owner's words start a newer turn
  // at 311.749s, close at 314.297s, and the voice says "Yep, on it." until 316.701s. Measured: at 319.545s the voice
  // was handed both, and re-read the card: "That is the one we just did."
  it("drops 01a16675's held e28be and 3271 once 01a1667b started, and speaks only 01a1667b's f620", async () => {
    const { clock, events, finishes, held, opens, spoken, state } = harness();
    const old = "01a16675";
    const newer = "01a1667b";
    state.running.add(old);
    opens({ words: "Hey, I've already got the Slack thread in front of me" });
    clock.advance({ ms: 9_695 });
    held.hold({ answer: { commentary: true, itemId: "e28be", text: "Next is Jasper's question.", turnId: old } });
    clock.advance({ ms: 8_066 });
    held.hold({ answer: { commentary: false, itemId: "3271", text: "Which reply to Jasper?", turnId: old } });
    state.running.delete(old);
    clock.advance({ ms: 290_000 });
    opens({ words: " in line with my concerns." });
    clock.advance({ ms: 3_988 });
    held.turnStarted({ turnId: newer });
    state.running.add(newer);
    clock.advance({ ms: 2_548 });
    finishes({ words: "I'm going to send this card back for a recut. Send it back" });
    clock.advance({ ms: 2_404 });
    state.voiceAt = clock.nowMs();
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([]);
    expect(held.count()).toBe(0);
    expect(events.at(-1)).toEqual({
      detail: "turn 01a1667b started after it was written, and its answer is the one owed",
      itemId: "3271",
      kind: "held-answer",
      pending: false,
      phase: "dropped",
      turnId: old,
    });
    held.hold({ answer: { commentary: false, itemId: "f620", text: "Address both, or AWS?", turnId: newer } });
    state.running.delete(newer);
    await settle();
    expect(spoken).toEqual(["Address both, or AWS?"]);
  });

  // Measured: a turn's `…f620` (the recut question), held while the voice talked and then while the owner moved on to
  // the next card, was handed after the owner's words had started the newer turn — the last card's question, again.
  it("drops f620 once 01a1667c started for the next card, and speaks 01a1667c's own answer", async () => {
    const { clock, events, finishes, held, opens, spoken, state } = harness();
    state.voiceAt = clock.nowMs();
    held.hold({ answer: { commentary: false, itemId: "f620", text: "Address both, or AWS?", turnId: "01a1667b" } });
    // The voice is still re-reading the last card, transcribed about once a second, until the owner cuts in.
    for (let second = 0; second < 8; second += 1) {
      clock.advance({ ms: 1_000 });
      state.voiceAt = clock.nowMs();
    }
    clock.advance({ ms: 500 });
    opens({ words: "That is the one we just did. The next card" });
    clock.advance({ ms: 56_000 });
    held.turnStarted({ turnId: "01a1667c" });
    clock.advance({ ms: 1_800 });
    finishes({ words: "That is the one we just did. Happy to send this as is" });
    clock.advance({ ms: 6_000 });
    await settle();
    expect(spoken).toEqual([]);
    expect(events.at(-1)).toEqual({
      detail: "turn 01a1667c started after it was written, and its answer is the one owed",
      itemId: "f620",
      kind: "held-answer",
      pending: false,
      phase: "dropped",
      turnId: "01a1667b",
    });
    held.hold({ answer: { commentary: false, itemId: "2b1b", text: "Sending the bump.", turnId: "01a1667c" } });
    await settle();
    expect(spoken).toEqual(["Sending the bump."]);
  });

  it("speaks an answer its own turn wrote when that turn's start is replayed after it", async () => {
    const { clock, events, held, hears, spoken } = harness();
    held.turnStarted({ turnId: "t-2" });
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    held.turnStarted({ turnId: "t-2" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-2 text"]);
    expect(events.some((event) => event.kind === "held-answer" && event.phase === "dropped")).toBe(false);
  });

  // The app-server's start notification for a turn can reach the console after that turn's
  // own message, and that start is never a newer turn.
  it("speaks an answer whose own turn's start arrives only after it", async () => {
    const { clock, events, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(events.some((event) => event.kind === "held-answer" && event.phase === "dropped")).toBe(false);
  });

  // The stream's listeners run synchronously, so one could start a turn mid-release.
  it("says the handing first, as before, and drops the answer a turn its listener started overtook", async () => {
    const spokenAtHanding: number[] = [];
    const starts: ((input: { turnId: string }) => void)[] = [];
    const { clock, events, held, hears, spoken } = harness({
      onEmit: (event) => {
        if (event.kind === "held-answer" && event.phase === "handing") {
          spokenAtHanding.push(spoken.length);
          starts.forEach((start) => start({ turnId: "t-2" }));
        }
      },
    });
    starts.push((input) => held.turnStarted(input));
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spokenAtHanding).toEqual([0]);
    expect(spoken).toEqual([]);
    expect(events.at(-1)).toEqual({
      detail: "turn t-2 started after it was written, and its answer is the one owed",
      itemId: "a-1",
      kind: "held-answer",
      pending: false,
      phase: "dropped",
      turnId: "t-1",
    });
  });

  // An older turn's start delivered after its own message is no newer turn.
  it("lets an older turn's start that arrives after its message overtake no newer answer, nor take its line", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.offerLanded({ turnId: "t-0" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-0", turnId: "t-0" }) });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-0" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  // Its own turn's late start during the handing overtakes nothing.
  it("hands an answer over once when its own turn's late start arrives during the handing", async () => {
    const starts: ((input: { turnId: string }) => void)[] = [];
    const { clock, events, held, hears, spoken } = harness({
      onEmit: (event) => {
        if (event.kind === "held-answer" && event.phase === "handing") {
          starts.forEach((start) => start({ turnId: "t-1" }));
        }
      },
    });
    starts.push((input) => held.turnStarted(input));
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(events.filter((event) => event.kind === "held-answer").map((event) => event.phase)).toEqual([
      "held",
      "handing",
      "released",
    ]);
  });

  // A turn carrying t-0's line that never answers passes it on at the next start.
  it("passes a carried line on through a newer turn that never answers", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.offerLanded({ turnId: "t-0" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-0", turnId: "t-0" }) });
    held.turnStarted({ turnId: "t-1" });
    held.turnStarted({ turnId: "t-2" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  // t-2's start arrives only after its own answer, so the line t-0's dropped answer owes
  // has no newer start to ride and was stranded.
  it("says a dropped answer's line on a newer turn's answer whose own start arrived after it", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.offerLanded({ turnId: "t-0" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-0", turnId: "t-0" }) });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    held.turnStarted({ turnId: "t-2" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  it("moves a running-list line owed to an overtaken answer onto the newer turn's answer, said once", async () => {
    const { clock, held, hears, saysMore, spoken } = harness();
    held.offerLanded({ turnId: "t-1" });
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([]);
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    await settle();
    saysMore();
    held.hold({ answer: answer({ commentary: false, itemId: "a-3", turnId: "t-2" }) });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`, "a-3 text"]);
  });

  // The page's answer to an older turn's offer can land after the newer start.
  it("says a running-list line that lands for an older turn after a newer one started, on the newer turn's answer", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    held.offerLanded({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual([]);
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  it("says a late-landing older turn's line once when its dropped answer is released beside the newer one", async () => {
    const { clock, held, hears, saysMore, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    held.offerLanded({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    await settle();
    saysMore();
    held.hold({ answer: answer({ commentary: false, itemId: "a-3", turnId: "t-2" }) });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`, "a-3 text"]);
  });

  // A late landing moved onto a line already in flight is one that write never said.
  it("keeps an older turn's late line owed when it moves onto a newer line already being handed over", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const { clock, held, hears, saysMore, spoken } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          landings.push(resolve);
        }),
    });
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-0", turnId: "t-0" }) });
    held.turnStarted({ turnId: "t-1" });
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    held.offerLanded({ turnId: "t-0" });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    saysMore();
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-1" }) });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`, `a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  it("says the line of a turn whose answer was already dropped when its offer lands, on the newer turn's answer", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    clock.advance({ ms: 5_000 });
    await settle();
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    await settle();
    expect(spoken).toEqual([`a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  // A turn none of whose answers was overtaken keeps its line, exactly as before.
  it("leaves the line of a turn with nothing overtaken on that turn, even once a newer turn started", async () => {
    const { clock, held, hears, spoken } = harness();
    held.turnStarted({ turnId: "t-1" });
    held.turnStarted({ turnId: "t-2" });
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    held.offerLanded({ turnId: "t-1" });
    clock.advance({ ms: 5_000 });
    await settle();
    expect(spoken).toEqual(["a-2 text"]);
  });

  // The line carried from t-0 is t-0's too, so its second offer merges into it.
  it("merges a carried turn's second offer into its line already being handed over", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const { clock, held, hears, saysMore, spoken } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          landings.push(resolve);
        }),
    });
    hears({ words: MID_CLAUSE });
    held.offerLanded({ turnId: "t-0" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-0", turnId: "t-0" }) });
    held.turnStarted({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    clock.advance({ ms: 5_000 });
    await settle();
    held.offerLanded({ turnId: "t-0" });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    saysMore();
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-1" }) });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`, "a-2 text"]);
  });

  it("never says an older answer again once its refused write is retried after a newer turn started", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const { clock, events, held, spoken } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          landings.push(resolve);
        }),
    });
    held.offerLanded({ turnId: "t-1" });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    landings.shift()!({ kind: "error", message: "busy" });
    await settle();
    clock.advance({ ms: 250 });
    await settle();
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`]);
    expect(events.at(-1)).toEqual({
      detail: "turn t-2 started after it was written, and its answer is the one owed",
      itemId: "a-1",
      kind: "held-answer",
      pending: false,
      phase: "dropped",
      turnId: "t-1",
    });
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    // The refused write said nothing, so the line it carried is owed to the newer turn's answer.
    expect(spoken).toEqual([`a-1 text ${RUNNING_LIST_LANDED_LINE}`, `a-2 text ${RUNNING_LIST_LANDED_LINE}`]);
  });

  // The residue, stated: a write the session already took cannot be called back by a turn starting after it.
  it("reports a write in flight when a newer turn starts as released, never as dropped", async () => {
    const landings: ((outcome: RpcOutcome) => void)[] = [];
    const { events, held, spoken } = harness({
      speak: () =>
        new Promise<RpcOutcome>((resolve) => {
          landings.push(resolve);
        }),
    });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.turnStarted({ turnId: "t-2" });
    landings.shift()!({ kind: "result", result: {} });
    await settle();
    expect(spoken).toEqual(["a-1 text"]);
    expect(events.map((e) => e.kind === "held-answer" && e.phase)).toEqual(["handing", "released"]);
  });

  it("says nothing held once the call has ended", async () => {
    const { clock, held, hears, spoken } = harness();
    hears({ words: MID_CLAUSE });
    held.hold({ answer: answer({ commentary: false, itemId: "a-1", turnId: "t-1" }) });
    held.stop();
    held.hold({ answer: answer({ commentary: false, itemId: "a-2", turnId: "t-2" }) });
    clock.advance({ ms: 20_000 });
    await settle();
    expect(spoken).toEqual([]);
    expect(held.count()).toBe(0);
  });
});
