/*
 * A question the voice puts to the owner again after they answered it, held to what the call said. The replay is a written
 * synthetic projected call in the shape of the one the bug was reported on — each FINAL sentence of the voice's and of
 * the owner's, and each completed message of the thinking model's, every line with the card open as it was said, in the order
 * the page sees them. Its timestamps, kinds, order and punctuation are that call's; every word the fold does not read
 * is an invented word of the same length, and every id and card key is synthetic, so the fold makes the same decision
 * on every line and the whole call is still the false-positive measurement, not a handful of picks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  foldRepeatedAsks,
  NO_REPEATED_ASKS,
  questionsOf,
  type RepeatedAsk,
  type RepeatedAskInput,
} from "../../lib/talkRepeatedAsk";
import { claimShapeOf, spokenGroundingDetail } from "../../lib/talkSpokenClaims";

/** One line of a projected call. */
interface Line {
  readonly kind: "said" | "heard" | "wrote";
  readonly id: string;
  readonly text: string;
  readonly at: string;
  readonly card?: string | null;
}

/**
 * A projected call's lines, in the order the page saw them.
 *
 * @returns the lines
 */
function call({ file }: { file: string }): readonly Line[] {
  return readFileSync(join(__dirname, "fixtures", file), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Line);
}

/**
 * A line as the fold takes it: a voice sentence carries its card, absent read as none; nothing else carries one.
 *
 * @returns the input
 */
function inputOf({ line }: { line: Line }): RepeatedAskInput {
  if (line.kind === "said") {
    return { card: line.card ?? undefined, id: line.id, kind: "said", text: line.text };
  }
  return { id: line.id, kind: line.kind, text: line.text };
}

/**
 * Feed the fold in order, as the page does.
 *
 * @returns every repeat owed, with the time of the sentence that owed it
 */
function replay({ lines }: { lines: readonly Line[] }): readonly { at: string; ask: RepeatedAsk }[] {
  let state = NO_REPEATED_ASKS;
  const owed: { at: string; ask: RepeatedAsk }[] = [];
  for (const line of lines) {
    const step = foldRepeatedAsks({ input: inputOf({ line }), state });
    state = step.state;
    owed.push(...step.owed.map((ask) => ({ ask, at: line.at.slice(11, 19) })));
  }
  return owed;
}

/**
 * A run of lines a test writes, each minted an id and a time from its place.
 *
 * @returns the lines
 */
function minted({ fed }: { fed: readonly Omit<Line, "at" | "id">[] }): readonly Line[] {
  return fed.map((line, at) => ({ ...line, at: `2026-10-20T00:00:${String(at).padStart(2, "0")}.000Z`, id: `l${at}` }));
}

const REPEATED_ASK_CALL = call({ file: "repeatedAskCall.jsonl" });

const FIRST_ASK = "For those documents, upload now, get owners' review first, or wait for live checks?";
const REPEAT = "Upload now, get owners' review first, or wait for live checks?";

describe("the repeated-ask call, replayed whole", () => {
  it("has 71 sentences of the voice's, 44 of the owner's and 44 completed messages to measure over", () => {
    const kinds = ["said", "heard", "wrote"].map(
      (kind) => REPEATED_ASK_CALL.filter((line) => line.kind === kind).length,
    );
    expect(kinds).toEqual([71, 44, 44]);
  });

  it("owes exactly one grounding: the options asked again after the owner answered them", () => {
    expect(replay({ lines: REPEATED_ASK_CALL })).toEqual([
      { ask: { kind: "repeated-ask", start: 163, words: REPEAT }, at: "02:23:53" },
    ]);
  });

  it("owes nothing when the thinking model's answer itself asks the question again", () => {
    const upTo = REPEATED_ASK_CALL.findIndex((line) => line.at.startsWith("2026-10-20T02:23:53"));
    const card = REPEATED_ASK_CALL[upTo].card;
    const asked: Line = { at: "2026-10-20T02:23:42.000Z", card, id: "asked-again", kind: "wrote", text: REPEAT };
    const fed = [...REPEATED_ASK_CALL.slice(0, upTo), asked, REPEATED_ASK_CALL[upTo]];
    expect([replay({ lines: REPEATED_ASK_CALL.slice(0, upTo + 1) }).length, replay({ lines: fed })]).toEqual([1, []]);
  });
});

describe("foldRepeatedAsks", () => {
  const WROTE_ASK = { kind: "wrote", text: FIRST_ASK } as const;
  const SAID_ASK = { kind: "said", text: FIRST_ASK } as const;
  const HEARD = { kind: "heard", text: "None of the above." } as const;
  const ANSWER = { kind: "wrote", text: "The briefing comes first." } as const;
  const SAID_REPEAT = { kind: "said", text: `The briefing comes first. ${REPEAT}` } as const;

  it("owes the repeat once the ask was said, the owner spoke, and the answer voiced did not ask it", () => {
    const owed = replay({ lines: minted({ fed: [WROTE_ASK, SAID_ASK, HEARD, ANSWER, SAID_REPEAT] }) });
    expect(owed.map(({ ask }) => ask.words)).toEqual([REPEAT]);
  });

  it("owes nothing before the owner has spoken, after an ask only written, outside a hand-off, or over another card", () => {
    const cases = [
      [WROTE_ASK, SAID_ASK, ANSWER, SAID_REPEAT],
      [WROTE_ASK, HEARD, ANSWER, SAID_REPEAT],
      [WROTE_ASK, SAID_ASK, HEARD, SAID_REPEAT],
      [WROTE_ASK, { ...SAID_ASK, card: "ask:one" }, HEARD, ANSWER, { ...SAID_REPEAT, card: "ask:two" }],
    ];
    expect(cases.map((fed) => replay({ lines: minted({ fed }) }))).toEqual([[], [], [], []]);
  });

  it("owes nothing for a quoted question, a short one, or a line read twice", () => {
    const quoted = { kind: "said", text: `You said "${REPEAT}" was the wrong question.` } as const;
    const short = [{ kind: "said", text: "Next card?" }, HEARD, ANSWER, { kind: "said", text: "Next card?" }] as const;
    const fed = minted({ fed: [WROTE_ASK, SAID_ASK, HEARD, ANSWER, SAID_REPEAT] });
    const twice = [...fed, fed[4]];
    expect([
      replay({ lines: minted({ fed: [WROTE_ASK, SAID_ASK, HEARD, ANSWER, quoted] }) }),
      replay({ lines: minted({ fed: short }) }),
      replay({ lines: twice }).length,
    ]).toEqual([[], [], 1]);
  });

  it("grounds a voiced question the answer asked in fewer words", () => {
    const copy = "It's in your copy tray, what do you think?";
    const fed = [
      { kind: "wrote", text: copy },
      { kind: "said", text: copy },
      { kind: "heard", text: "Great, thanks." },
      { kind: "wrote", text: copy },
      { kind: "said", text: `Still going on this one - ${copy}` },
    ] as const;
    expect(replay({ lines: minted({ fed }) })).toEqual([]);
  });

  it("grounds a voiced question the answer asked with its words spelled apart differently", () => {
    const said = "Should we use real-time pre-checks?";
    const fed = [
      { kind: "said", text: said },
      { kind: "heard", text: "Yes." },
      { kind: "wrote", text: "Should we use realtime prechecks?" },
      { kind: "said", text: said },
    ] as const;
    const ungrounded = [fed[0], fed[1], { kind: "wrote", text: "Pre-checks are on." }, fed[3]] as const;
    expect([replay({ lines: minted({ fed }) }), replay({ lines: minted({ fed: ungrounded }) }).length]).toEqual([
      [],
      1,
    ]);
  });

  it("grounds a voiced question the answer asked with its number written as digits", () => {
    const said = "Upload all twenty-one documents?";
    const fed = [
      { kind: "said", text: said },
      { kind: "heard", text: "Not yet." },
      { kind: "wrote", text: "Upload all 21 documents?" },
      { kind: "said", text: said },
    ] as const;
    const other = [fed[0], fed[1], { kind: "wrote", text: "Uploading 22 documents next." }, fed[3]] as const;
    expect([replay({ lines: minted({ fed }) }), replay({ lines: minted({ fed: other }) }).length]).toEqual([[], 1]);
  });

  it("grounds a repeat on any question the answer asked since, a paraphrase included", () => {
    const paraphrase = "Which should we do: upload now, seek an owner review, or wait for checks to run live?";
    const fed = [
      WROTE_ASK,
      SAID_ASK,
      HEARD,
      { kind: "wrote", text: paraphrase },
      { kind: "said", text: REPEAT },
    ] as const;
    const short = [WROTE_ASK, SAID_ASK, HEARD, { kind: "wrote", text: "Ready?" }, SAID_REPEAT] as const;
    // A fullwidth question mark asks the owner something as plainly as an ASCII one.
    const fullwidth = [
      WROTE_ASK,
      SAID_ASK,
      HEARD,
      { kind: "wrote", text: "Which environment should we deploy to？" },
      SAID_REPEAT,
    ] as const;
    const quoted = [
      WROTE_ASK,
      SAID_ASK,
      HEARD,
      { kind: "wrote", text: 'Ana said "ready?" earlier.' },
      SAID_REPEAT,
    ] as const;
    expect([
      replay({ lines: minted({ fed }) }),
      replay({ lines: minted({ fed: short }) }),
      replay({ lines: minted({ fed: fullwidth }) }),
      replay({ lines: minted({ fed: quoted }) }).length,
    ]).toEqual([[], [], [], 1]);
  });

  it("reads a run of number words as one number, never across punctuation", () => {
    expect([
      questionsOf({ text: "Upload all eight of the docs now?" })[0].words,
      questionsOf({ text: "Pick option one, two or three today?" })[0].words,
      questionsOf({ text: "Close PR one hundred and five tonight?" })[0].words,
    ]).toEqual([
      ["upload", "all", "8", "docs", "now"],
      ["pick", "option", "1", "2", "3", "today"],
      ["close", "pr", "105", "tonight"],
    ]);
  });
});

describe("questionsOf", () => {
  it("reads each question sentence as said, where it starts, and its content words", () => {
    expect(questionsOf({ text: `The briefing comes first. ${REPEAT}` })).toEqual([
      {
        compact: "uploadnowownersreviewfirstwaitlivechecks",
        sentence: REPEAT,
        start: 25,
        words: ["upload", "now", "owners", "review", "first", "wait", "live", "checks"],
      },
    ]);
  });
});

describe("the repeated-ask grounding", () => {
  it("posts as exactly its kind, carrying none of the question's words", () => {
    expect(claimShapeOf({ claim: { kind: "repeated-ask", start: 0, words: REPEAT } })).toEqual({
      kind: "repeated-ask",
    });
  });

  it("is written on the call file as asked again after the owner spoke", () => {
    const claim = { kind: "repeated-ask", start: 0, words: REPEAT } as const;
    expect(spokenGroundingDetail({ note: { claim, kind: "ungrounded" } })).toBe(
      `said "${REPEAT}": asked again after the owner spoke, and nothing the thinking model wrote since asked it`,
    );
  });
});
