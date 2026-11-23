/*
 * `rulingBeforeRepeatedQuestion`: the ruling the owner already gave on a question asked again word for word, as
 * `talk restore` re-asks a landed ask. A ruled ask restored
 * with the same text is the shape: the Queue ranked it first as though never answered.
 */
import { describe, expect, it } from "vitest";

import { rulingBeforeRepeatedQuestion } from "../../../handover/heldQuestion.js";
import type { RunEvent } from "../../../handover/ledger.js";

const QUESTION = "Should fleet-runs-dry stay the forecast warning, become the measured card, or carry both?";
const RESTORED_ISO = "2026-11-09T11:04:00.498Z";

const asked = ({ atIso, question = QUESTION }: { atIso: string; question?: string }): RunEvent => ({
  atIso,
  kind: "question",
  question,
});

const ruled = ({ anchor, decidedIso }: { anchor: string; decidedIso: string }): RunEvent => ({
  anchor,
  atIso: decidedIso,
  decidedIso,
  kind: "ruling",
  ruling: `ruled at ${decidedIso}`,
});

const ruledThenRestored: readonly RunEvent[] = [
  asked({ atIso: "2026-11-05T04:33:19.159Z" }),
  ruled({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z" }),
  asked({ atIso: RESTORED_ISO }),
];

describe("the ruling the owner gave before the same question was asked again", () => {
  it("is the ruling between two askings of the same words", () => {
    expect(
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: ruledThenRestored, question: QUESTION }),
    ).toEqual({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z", words: "ruled at 2026-11-08T11:38:32.359Z" });
  });

  it("is the latest decision when the owner ruled twice, a tie going to the later line", () => {
    const twice: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z" }),
      ruled({ anchor: "talk:late", decidedIso: "2026-11-08T12:00:00.000Z" }),
      ruled({ anchor: "talk:early", decidedIso: "2026-11-07T12:00:00.000Z" }),
      ruled({ anchor: "talk:tie", decidedIso: "2026-11-08T12:00:00.000Z" }),
      asked({ atIso: RESTORED_ISO }),
    ];
    expect(rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: twice, question: QUESTION })!.anchor).toBe(
      "talk:tie",
    );
  });

  it("is none for a question asked in other words, or a later asking it never named", () => {
    const reworded: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z", question: "Which fleet-runs-dry card?" }),
      ruled({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z" }),
      asked({ atIso: RESTORED_ISO }),
    ];
    expect([
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: reworded, question: QUESTION }),
      rulingBeforeRepeatedQuestion({
        askedIso: "2026-11-10T00:00:00.000Z",
        events: ruledThenRestored,
        question: QUESTION,
      }),
    ]).toEqual([undefined, undefined]);
  });

  it("is none for a ruling before the first asking, or one given after a correction restated it", () => {
    const before: readonly RunEvent[] = [
      ruled({ anchor: "talk:a", decidedIso: "2026-11-04T00:00:00.000Z" }),
      asked({ atIso: "2026-11-05T04:33:19.159Z" }),
      asked({ atIso: RESTORED_ISO }),
    ];
    const corrected: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z" }),
      { atIso: "2026-11-06T00:00:00.000Z", kind: "question-corrected", question: "Which card?", why: "reworded" },
      ruled({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z" }),
      asked({ atIso: RESTORED_ISO }),
    ];
    expect([
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: before, question: QUESTION }),
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: corrected, question: QUESTION }),
    ]).toEqual([undefined, undefined]);
  });

  // A re-ask that needs the owner again says what changed, so
  // the same words after the run moved on are still the question they ruled on.
  it("keeps the owner's ruling across a correction, or another question asked and answered, before the same words", () => {
    const thenCorrected: readonly RunEvent[] = [
      ...ruledThenRestored.slice(0, 2),
      { atIso: "2026-11-08T12:00:00.000Z", kind: "question-corrected", question: "Which card?", why: "reworded" },
      asked({ atIso: RESTORED_ISO }),
    ];
    const thenAskedOther: readonly RunEvent[] = [
      ...ruledThenRestored.slice(0, 2),
      { answer: "ruled", atIso: "2026-11-08T12:00:00.000Z", kind: "answered" },
      asked({ atIso: "2026-11-08T13:00:00.000Z", question: "Which card?" }),
      { answer: "the measured one", atIso: "2026-11-08T14:00:00.000Z", kind: "answered" },
      asked({ atIso: RESTORED_ISO }),
    ];
    expect([
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: thenCorrected, question: QUESTION })!.anchor,
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: thenAskedOther, question: QUESTION })!.anchor,
    ]).toEqual(["talk:a", "talk:a"]);
  });

  // A correction INTO these words, then the owner's ruling on them, then the same words asked
  // again.
  it("is the ruling the owner gave on the corrected words, when the re-ask repeats those words", () => {
    const correctedThenRuled: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z", question: "Which card?" }),
      { atIso: "2026-11-06T00:00:00.000Z", kind: "question-corrected", question: QUESTION, why: "reworded" },
      ruled({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z" }),
      { answer: "ruled", atIso: "2026-11-08T12:00:00.000Z", kind: "answered" },
      asked({ atIso: RESTORED_ISO }),
    ];
    expect(
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: correctedThenRuled, question: QUESTION })!.anchor,
    ).toBe("talk:a");
  });

  // A restating line landing after the answer binds to no held question, so it
  // restated nothing. Its counterexample was an offer; a correction takes the same unbound path.
  it("keeps the owner's ruling across a restatement that landed after the answer and bound to nothing", () => {
    const strayCorrection: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z" }),
      ruled({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z" }),
      { answer: "ruled", atIso: "2026-11-08T12:00:00.000Z", kind: "answered" },
      { atIso: "2026-11-08T12:30:00.000Z", kind: "question-corrected", question: QUESTION, why: "late" },
      asked({ atIso: RESTORED_ISO }),
    ];
    expect(
      rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: strayCorrection, question: QUESTION })!.anchor,
    ).toBe("talk:a");
  });

  // A ruling backfilled under this question, decided while another question was held.
  it("is none for a backfilled ruling decided before the question it was appended under was asked", () => {
    const backfilled: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z" }),
      {
        anchor: "talk:old",
        atIso: "2026-11-06T00:00:00.000Z",
        backfilledFrom: "2026-11-04T00:00:00.000Z",
        decidedIso: "2026-11-04T00:00:00.000Z",
        kind: "ruling",
        ruling: "ruled at 2026-11-04T00:00:00.000Z",
      },
      asked({ atIso: RESTORED_ISO }),
    ];
    expect(rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: backfilled, question: QUESTION })).toBe(
      undefined,
    );
  });

  // The reshape path re-asks the same words as a `question-shaped` line keeping
  // the first asking's instant, and a ruling can land between that path's last re-read and its append.
  it("is the ruling journalled before a same-words reshape of the question the owner ruled on", () => {
    const shape = {
      lean: "the measured card",
      options: [
        { letter: "A", option: "the forecast warning", tradeoff: "no new card" },
        { letter: "B", option: "the measured card", tradeoff: "one more read a tick" },
      ],
      problem: "the warning fires before the fleet runs dry",
      stakes: { blastRadius: "one card", risk: "a false alarm", stillReal: "no reply" },
    };
    const askedIso = "2026-11-05T04:33:19.159Z";
    const reshapedAfterRuling: readonly RunEvent[] = [
      asked({ atIso: askedIso }),
      ruled({ anchor: "talk:a", decidedIso: "2026-11-08T11:38:32.359Z" }),
      { ...shape, atIso: "2026-11-08T11:38:32.400Z", kind: "question-shaped", question: QUESTION, replaces: QUESTION },
    ];
    const reshapedIntoOtherWords: readonly RunEvent[] = [
      ...reshapedAfterRuling.slice(0, 2),
      {
        ...shape,
        atIso: "2026-11-08T11:38:32.400Z",
        kind: "question-shaped",
        question: "Which card?",
        replaces: QUESTION,
      },
    ];
    expect([
      rulingBeforeRepeatedQuestion({ askedIso, events: reshapedAfterRuling, question: QUESTION })!.anchor,
      rulingBeforeRepeatedQuestion({ askedIso, events: reshapedIntoOtherWords, question: "Which card?" }),
      rulingBeforeRepeatedQuestion({ askedIso, events: reshapedAfterRuling.slice(0, 2), question: QUESTION }),
    ]).toEqual(["talk:a", undefined, undefined]);
  });

  it("is none for a ruling whose decision instant will not parse", () => {
    const unparsed: readonly RunEvent[] = [
      asked({ atIso: "2026-11-05T04:33:19.159Z" }),
      ruled({ anchor: "talk:a", decidedIso: "not a date" }),
      asked({ atIso: RESTORED_ISO }),
    ];
    expect(rulingBeforeRepeatedQuestion({ askedIso: RESTORED_ISO, events: unparsed, question: QUESTION })).toBe(
      undefined,
    );
  });
});
