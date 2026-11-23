import { describe, expect, it } from "vitest";

import { MAX_OPTIONS, OPTION_MAX_WORDS, SHORT_FIELD_MAX_WORDS } from "../../../briefing/caps.js";
import {
  type AskOption,
  askOptionsBlock,
  askOptionsFrom,
  askShapeProblems,
  askStakesFrom,
  MIN_OPTIONS,
  missingShapeFields,
  parseAskOptions,
  shapeCompleteness,
  stakesFrom,
  TRADEOFF_SEPARATOR,
} from "../../../handover/askShape.js";

/** A well-formed pair, so a case can say which half it is breaking. */
const option = ({ letter, text }: { letter: string; text: string }): AskOption => ({
  letter,
  option: text,
  tradeoff: `it costs ${text}`,
});

const WHOLE = {
  lean: "take B, because the queue card is what they read first",
  options: [option({ letter: "A", text: "ship the schema" }), option({ letter: "B", text: "ship the card" })],
  problem: "no verb states a lean, so every recorded ask reads as a paragraph",
  stakes: undefined,
};

const STAKES = {
  blastRadius: "every ask on the queue",
  risk: "they answer a card that no longer describes the problem",
  stillReal: "handover list --json still shows asks with no lean",
};

describe("askShapeProblems", () => {
  it("passes a whole, in-caps shape with nothing to say", () => {
    expect(askShapeProblems({ shape: WHOLE })).toEqual([]);
  });

  it("names an empty problem and an empty lean separately", () => {
    const problems = askShapeProblems({ shape: { ...WHOLE, lean: "   ", problem: "" } });
    expect(problems).toEqual(["problem is empty", "lean is empty"]);
  });

  it("names the word count and the cap on an over-long problem", () => {
    const long = Array.from({ length: SHORT_FIELD_MAX_WORDS + 1 }, () => "word").join(" ");
    const problems = askShapeProblems({ shape: { ...WHOLE, problem: long } });
    expect(problems).toEqual([
      `problem runs ${String(SHORT_FIELD_MAX_WORDS + 1)} words against a cap of ${String(SHORT_FIELD_MAX_WORDS)} — ` +
        "say it shorter, the fold is for the detail",
    ]);
  });

  it("refuses a problem that is two sentences, because the ruling calls it one line", () => {
    const problems = askShapeProblems({ shape: { ...WHOLE, problem: "The pool exhausted. Nobody knows why." } });
    expect(problems).toEqual(["problem runs 2 sentences against a cap of 1 — it is one line, not a paragraph"]);
  });

  it("allows a two-sentence lean, which carries its own reason", () => {
    expect(askShapeProblems({ shape: { ...WHOLE, lean: "Take B. The card is what they read." } })).toEqual([]);
  });

  it("refuses one option as a notification rather than a decision", () => {
    const problems = askShapeProblems({ shape: { ...WHOLE, options: [option({ letter: "A", text: "ship it" })] } });
    expect(problems).toEqual([
      `1 option(s) — an ask carries ${String(MIN_OPTIONS)} to ${String(MAX_OPTIONS)}, because one option is a ` +
        "notification rather than a decision",
    ]);
  });

  it("refuses more options than they can hold above the fold", () => {
    const five = ["A", "B", "C", "D", "E"].map((letter) => option({ letter, text: `do ${letter}` }));
    const problems = askShapeProblems({ shape: { ...WHOLE, options: five } });
    expect(problems).toEqual([
      `5 option(s) — an ask carries at most ${String(MAX_OPTIONS)}, which is what the owner can hold above the fold at once`,
    ]);
  });

  it("names the offending option by its letter, and its trade-off separately", () => {
    const long = Array.from({ length: OPTION_MAX_WORDS + 1 }, () => "word").join(" ");
    const problems = askShapeProblems({
      shape: { ...WHOLE, options: [{ letter: "A", option: long, tradeoff: "" }, WHOLE.options[1]!] },
    });
    expect(problems).toEqual([
      `option A runs ${String(OPTION_MAX_WORDS + 1)} words against a cap of ${String(OPTION_MAX_WORDS)} — ` +
        "one line each, so the owner can hold all of them at once",
      "option A's trade-off is empty",
    ]);
  });
});

describe("askShapeProblems over the stakes", () => {
  it("passes whole, in-caps stakes with nothing to say", () => {
    expect(askShapeProblems({ shape: { ...WHOLE, stakes: STAKES } })).toEqual([]);
  });

  it("names each empty stake by the label a refusal prints", () => {
    const problems = askShapeProblems({ shape: { ...WHOLE, stakes: { blastRadius: " ", risk: "", stillReal: "" } } });
    expect(problems).toEqual(["risk is empty", "blast radius is empty", "still-real check is empty"]);
  });

  it("holds each stake to one sentence, because each is read at a glance", () => {
    const stakes = { ...STAKES, stillReal: "It still fails. The log says so." };
    expect(askShapeProblems({ shape: { ...WHOLE, stakes } })).toEqual([
      "still-real check runs 2 sentences against a cap of 1 — it is one line, not a paragraph",
    ]);
  });
});

describe("stakesFrom", () => {
  it("answers the whole stakes when all three are present", () => {
    expect(stakesFrom(STAKES)).toEqual({ missing: [], stakes: STAKES });
  });

  it("names the missing flags in the order a refusal prints them", () => {
    expect(stakesFrom({ blastRadius: undefined, risk: "r", stillReal: undefined })).toEqual({
      missing: ["--blast-radius", "--still-real"],
      stakes: undefined,
    });
  });
});

describe("askStakesFrom", () => {
  it("reads a whole stakes object off a decoded line", () => {
    expect(askStakesFrom({ value: { ...STAKES } })).toEqual(STAKES);
  });

  it("drops a partial object whole, so a card never draws two stakes of three", () => {
    expect(askStakesFrom({ value: { blastRadius: "b", risk: "r" } })).toBe(undefined);
  });

  it("answers undefined for an absent field", () => {
    expect(askStakesFrom({ value: undefined })).toBe(undefined);
  });
});

describe("shapeCompleteness", () => {
  it("reads a whole shape as whole", () => {
    expect(shapeCompleteness({ lean: "take B", options: WHOLE.options, problem: "it is unclear" })).toBe("whole");
  });

  it("reads the 43 free-text asks already on the board as none", () => {
    expect(shapeCompleteness({ lean: undefined, options: [], problem: undefined })).toBe("none");
  });

  it("reads any one field alone as partial, empty options included", () => {
    expect(shapeCompleteness({ lean: undefined, options: [], problem: "it is unclear" })).toBe("partial");
    expect(shapeCompleteness({ lean: "take B", options: [], problem: undefined })).toBe("partial");
    expect(shapeCompleteness({ lean: undefined, options: WHOLE.options, problem: undefined })).toBe("partial");
  });
});

describe("missingShapeFields", () => {
  it("names all three flags when nothing was passed", () => {
    expect(missingShapeFields({ lean: undefined, options: [], problem: undefined })).toEqual([
      "--problem",
      "--options",
      "--lean",
    ]);
  });

  it("names only the missing one, in the order the flags are written", () => {
    expect(missingShapeFields({ lean: undefined, options: WHOLE.options, problem: "it is unclear" })).toEqual([
      "--lean",
    ]);
  });

  it("says nothing about a whole shape", () => {
    expect(missingShapeFields({ lean: "take B", options: WHOLE.options, problem: "it is unclear" })).toEqual([]);
  });
});

describe("parseAskOptions", () => {
  it("letters by position and splits each line on the separator", () => {
    const parsed = parseAskOptions({
      text: `ship the schema ${TRADEOFF_SEPARATOR} a day of work\nship the card ${TRADEOFF_SEPARATOR} they wait`,
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.options).toEqual([
      { letter: "A", option: "ship the schema", tradeoff: "a day of work" },
      { letter: "B", option: "ship the card", tradeoff: "they wait" },
    ]);
  });

  it("keeps a comma, an em dash and a colon inside one option", () => {
    const parsed = parseAskOptions({ text: `do A, then B — carefully ${TRADEOFF_SEPARATOR} slower: by a day` });
    expect(parsed.options).toEqual([{ letter: "A", option: "do A, then B — carefully", tradeoff: "slower: by a day" }]);
  });

  it("names the line that states no trade-off and keeps the others", () => {
    const parsed = parseAskOptions({ text: `ship it\nship the card ${TRADEOFF_SEPARATOR} they wait` });
    expect(parsed.problems).toEqual([
      `this option line carries no \`${TRADEOFF_SEPARATOR}\`, so it states no trade-off: "ship it" — ` +
        `write it as \`<what the owner could do> ${TRADEOFF_SEPARATOR} <what that costs>\``,
    ]);
    expect(parsed.options).toEqual([{ letter: "A", option: "ship the card", tradeoff: "they wait" }]);
  });

  // "C · a background item" at position A drew
  // as "A  C · a background item", and its lean "C" pointed at the wrong option.
  it("refuses a line that opens with its own letter, since the card letters by position and would draw two", () => {
    const labelled = [
      "C · relaunch it",
      "B. open at login",
      "(A) a recovery app",
      "D) wait",
      "A: ship",
      "B — hold",
      "C - hold",
    ];
    const text = [...labelled, "keep it as is"].map((one) => `${one} ${TRADEOFF_SEPARATOR} costs`).join("\n");
    const parsed = parseAskOptions({ text });

    // The refused lines leave no gap: the one accepted line is still A.
    expect(parsed.options).toEqual([{ letter: "A", option: "keep it as is", tradeoff: "costs" }]);
    expect(parsed.problems).toEqual(
      ["C", "B", "A", "D", "A", "B", "C"].map(
        (letter, index) =>
          `this option line opens with its own letter "${letter}", but options are lettered by position, so the card ` +
          `would draw two: "${labelled[index]} ${TRADEOFF_SEPARATOR} costs" — drop the letter, and name an option in ` +
          `\`--lean\` by the letter its position gives it`,
      ),
    );
  });

  it("keeps a sentence that only opens with the word A or I, or a letter run like A:B", () => {
    const kept = ["A separate recovery app", "I build it", "A:B testing first"];
    const parsed = parseAskOptions({ text: kept.map((one) => `${one} ${TRADEOFF_SEPARATOR} costs`).join("\n") });

    expect(parsed.problems).toEqual([]);
    expect(parsed.options.map((one) => one.option)).toEqual(kept);
  });

  it("drops blank lines rather than lettering them", () => {
    const parsed = parseAskOptions({
      text: `\n  \nship the schema ${TRADEOFF_SEPARATOR} a day\n\nship the card ${TRADEOFF_SEPARATOR} they wait\n`,
    });
    expect(parsed.options.map((one) => one.letter)).toEqual(["A", "B"]);
  });

  it("answers an empty flag with nothing, and no complaint", () => {
    expect(parseAskOptions({ text: "" })).toEqual({ options: [], problems: [] });
  });

  it("numbers past D rather than lettering undefined, so a cap refusal can still name the option", () => {
    const text = ["a", "b", "c", "d", "e"].map((one) => `${one} ${TRADEOFF_SEPARATOR} costs`).join("\n");
    expect(parseAskOptions({ text }).options.map((one) => one.letter)).toEqual(["A", "B", "C", "D", "5"]);
  });
});

describe("askOptionsFrom", () => {
  it("re-letters by position over a hand-edited file that lettered them wrongly", () => {
    const decoded = askOptionsFrom({
      value: [
        { letter: "C", option: "ship the schema", tradeoff: "a day" },
        { letter: "C", option: "ship the card", tradeoff: "they wait" },
      ],
    });
    expect(decoded).toEqual([
      { letter: "A", option: "ship the schema", tradeoff: "a day" },
      { letter: "B", option: "ship the card", tradeoff: "they wait" },
    ]);
  });

  it("drops a member missing either half rather than losing the list", () => {
    const decoded = askOptionsFrom({
      value: [{ option: "ship the schema" }, { option: "ship the card", tradeoff: "they wait" }, null, "nonsense"],
    });
    expect(decoded).toEqual([{ letter: "A", option: "ship the card", tradeoff: "they wait" }]);
  });

  it("answers an absent or non-array field with nothing", () => {
    expect(askOptionsFrom({ value: undefined })).toEqual([]);
    expect(askOptionsFrom({ value: "ship it :: a day" })).toEqual([]);
  });
});

describe("askOptionsBlock", () => {
  it("writes a nested YAML block the front-matter reader parses back", () => {
    expect(askOptionsBlock({ options: WHOLE.options })).toBe(
      'options:\n  - option: "ship the schema"\n    tradeoff: "it costs ship the schema"\n' +
        '  - option: "ship the card"\n    tradeoff: "it costs ship the card"',
    );
  });

  it("escapes a quote and a backslash so their prose cannot break the block", () => {
    const written = askOptionsBlock({
      options: [{ letter: "A", option: 'they said "no"', tradeoff: "a path\\here, and a #hash: too" }],
    });
    expect(written).toBe(
      'options:\n  - option: "they said \\"no\\""\n    tradeoff: "a path\\\\here, and a #hash: too"',
    );
  });

  it("round-trips through the decoder", () => {
    expect(askOptionsFrom({ value: [...WHOLE.options] })).toEqual(WHOLE.options);
  });
});
