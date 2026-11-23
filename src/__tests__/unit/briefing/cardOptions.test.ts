/**
 * The OPTIONS cell of a react-now card: how its letters are split, and every defect one option can carry.
 *
 * Each `checkOptions` case compares the WHOLE defect list, so a rule that starts firing where it should not
 * fails as loudly as one that stops firing where it should.
 */
import { describe, expect, it } from "vitest";

import { adminMergeRefusal } from "../../../briefing/adminMergeOffer.js";
import { checkOptions, type PushOptionDefect, splitOptions } from "../../../briefing/cardOptions.js";
import { scopeChangeRefusal, sentElsewhereRefusal } from "../../../briefing/optionPickability.js";
import { ownHandRefusal } from "../../../briefing/ownHandAction.js";

/** A pull-request premise, the one arm the scope rule keys on. */
const PR_CARD = '<div class="age" data-premise-kind="pull-request">premise</div>';

/** A handover premise: the same markup, a different arm. */
const HANDOVER_CARD = '<div class="age" data-premise-kind="handover">premise</div>';

/** Every defect one card's options cell reports, in the order reported. */
function defectsOf({
  options,
  applyFraming = false,
  cardHtml = "",
  ownHand = false,
  what,
  questionRaw,
}: {
  options: string | undefined;
  applyFraming?: boolean;
  cardHtml?: string;
  ownHand?: boolean;
  what?: string;
  questionRaw?: string;
}): readonly { field: "options"; reason: string }[] {
  const defects: { field: "options"; reason: string }[] = [];
  const push: PushOptionDefect = (defect) => {
    defects.push(defect);
  };
  const fields = new Map<string, string>();
  if (options !== undefined) {
    fields.set("options", options);
  }
  if (what !== undefined) {
    fields.set("what", what);
  }
  checkOptions({ applyFraming, cardHtml, fields, ownHand, push, questionRaw });
  return defects;
}

/** `count` plain lowercase words ending in a full stop. */
function sentenceOf({ count }: { count: number }): string {
  return `${Array.from({ length: count }, () => "word").join(" ")}.`;
}

describe("splitOptions", () => {
  it("splits on letter markers across a line break and extra spaces, dropping leading prose", () => {
    expect(splitOptions({ text: "Prose first A: Hold.\nB:  Go now.   C:Wait." })).toEqual([
      { body: "Hold.", letter: "A" },
      { body: "Go now.", letter: "B" },
      { body: "Wait.", letter: "C" },
    ]);
  });

  it("finds no option in empty text or in a word that merely ends in a colon", () => {
    expect(splitOptions({ text: "" })).toEqual([]);
    expect(splitOptions({ text: "Note: hold." })).toEqual([]);
  });
});

describe("checkOptions — the cell itself", () => {
  it("reports a card with no options cell as missing", () => {
    expect(defectsOf({ options: undefined })).toEqual([{ field: "options", reason: "missing" }]);
  });

  it("reports a cell carrying no lettered option as unshaped", () => {
    expect(defectsOf({ options: "just hold it" })).toEqual([{ field: "options", reason: "not shaped as `A: … B: …`" }]);
  });

  it("accepts four options and refuses five", () => {
    expect(defectsOf({ options: "A: Hold. B: Go. C: Wait. D: Stop." })).toEqual([]);
    expect(defectsOf({ options: "A: Hold. B: Go. C: Wait. D: Stop. E: Rest." })).toEqual([
      {
        field: "options",
        reason:
          "5 options, over the cap of 4. More choices than that is a design discussion, not a decision you can react to.",
      },
    ]);
  });

  it("reads only the text above the fold", () => {
    expect(defectsOf({ options: "A: Hold. <details>B: not an option here</details>" })).toEqual([]);
  });
});

describe("checkOptions — one option's shape", () => {
  it("refuses an option that never terminates", () => {
    expect(defectsOf({ options: "A: ship it" })).toEqual([
      { field: "options", reason: 'option A is not a full sentence: "ship it"' },
    ]);
  });

  it("refuses an option of two sentences", () => {
    expect(defectsOf({ options: "A: Ship it. Then wait." })).toEqual([
      { field: "options", reason: "option A is 2 sentences, over the cap of 1. One option, one sentence." },
    ]);
  });

  it("accepts 25 words and refuses 26", () => {
    expect(defectsOf({ options: `A: ${sentenceOf({ count: 25 })}` })).toEqual([]);
    expect(defectsOf({ options: `A: ${sentenceOf({ count: 26 })}` })).toEqual([
      {
        field: "options",
        reason:
          "26 words above the fold, over the cap of 25. " +
          "Cut option A down, or move the rest into a details fold inside the card.",
      },
    ]);
  });
});

describe("checkOptions — the undefined-label rule", () => {
  it("accepts a Title-Case label the card's what defines and refuses it when nothing does", () => {
    const options = "A: take the Fast Path now.";
    expect(defectsOf({ options, what: "the Fast Path skips the queue" })).toEqual([]);
    expect(defectsOf({ options })).toEqual([
      { field: "options", reason: 'option A uses an undefined label: "Fast Path"' },
    ]);
  });

  it("counts the question block toward the vocabulary", () => {
    expect(defectsOf({ options: "A: take the Fast Path now.", questionRaw: "<p>Take the Fast Path?</p>" })).toEqual([]);
  });

  it("refuses a bare number-word label no field defines", () => {
    expect(defectsOf({ options: "A: go 2-way now." })).toEqual([
      { field: "options", reason: 'option A uses an undefined label: "2-way"' },
    ]);
  });
});

describe("checkOptions — the phrase rules every card carries", () => {
  it("refuses an admin merge whether or not the framing rules run", () => {
    const expected = [{ field: "options", reason: adminMergeRefusal({ cell: "option A", phrase: "admin merge" }) }];
    expect(defectsOf({ options: "A: admin merge it now." })).toEqual(expected);
    expect(defectsOf({ applyFraming: true, options: "A: admin merge it now." })).toEqual(expected);
  });
});

describe("checkOptions — the conditional rules", () => {
  it("refuses an option sent elsewhere only when the framing rules run", () => {
    const options = "A: decide per pull request off the numbers.";
    expect(defectsOf({ options })).toEqual([]);
    expect(defectsOf({ applyFraming: true, options })).toEqual([
      {
        field: "options",
        reason: sentElsewhereRefusal({ cell: "option A", phrase: "decide per pull request off the numbers" }),
      },
    ]);
  });

  it("refuses a scope change only with framing on AND a pull-request premise", () => {
    const options = "A: squash the commits before landing.";
    expect(defectsOf({ applyFraming: true, cardHtml: PR_CARD, options })).toEqual([
      { field: "options", reason: scopeChangeRefusal({ cell: "option A", phrase: "squash the commits" }) },
    ]);
    expect(defectsOf({ applyFraming: true, cardHtml: HANDOVER_CARD, options })).toEqual([]);
    expect(defectsOf({ applyFraming: false, cardHtml: PR_CARD, options })).toEqual([]);
  });

  it("refuses an option opening with a hand action only on a me-facing card", () => {
    const options = "A: run the migration now.";
    expect(defectsOf({ options, ownHand: false })).toEqual([]);
    expect(defectsOf({ options, ownHand: true })).toEqual([
      { field: "options", reason: ownHandRefusal({ cell: "option A", phrase: "run" }) },
    ]);
  });
});
