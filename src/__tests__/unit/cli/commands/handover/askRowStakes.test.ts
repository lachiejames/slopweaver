/**
 * An ask row's stakes survive the doc they are written into — risk, blast radius, the still-real check, and
 * the instant that check was made, which the verb stamps from its own clock rather than taking from a flag.
 *
 * The round trip is the property, not the writer's text alone: the console reads the stakes off
 * `parseHandoverDoc`, so a front-matter key the parser does not read would publish a card saying "not stated"
 * over a row that stated them.
 */
import { describe, expect, it } from "vitest";

import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { type AskShape } from "../../../../../handover/askShape.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

const CHECKED = "2026-09-22T21:40:00.000Z";

const SHAPE: AskShape = {
  lean: "main — the one citation reads like a typo",
  options: [
    { letter: "A", option: "main", tradeoff: "every other run is on it" },
    { letter: "B", option: "the release branch", tradeoff: "this doc cites it once" },
  ],
  problem: "the doc cites two base branches and names neither",
  stakes: {
    blastRadius: "this one doc and whichever run picks it up",
    risk: "a run starts on the wrong base and its diff is unreviewable",
    stillReal: "the doc still cites both branches",
  },
};

const written = ({ shape }: { shape: AskShape | undefined }): string =>
  askRowText({
    anchor: undefined,
    ask: "which base branch?",
    askedIso: "2026-09-22T21:00:00.000Z",
    branch: undefined,
    checkedIso: CHECKED,
    dispatch: false,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape,
    slug: "staked-row",
  });

const parsed = ({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> =>
  parseHandoverDoc({ path: "/state/handovers/staked-row.md", text });

describe("askRowText — the stakes", () => {
  it("round-trips all three stakes and dates the check to the verb's own clock", () => {
    const doc = parsed({ text: written({ shape: SHAPE }) });

    expect(doc.risk).toBe(SHAPE.stakes!.risk);
    expect(doc.blastRadius).toBe(SHAPE.stakes!.blastRadius);
    expect(doc.stillReal).toBe(SHAPE.stakes!.stillReal);
    expect(doc.stillRealIso).toBe(CHECKED);
  });

  it("writes the stakes into the body as well, where a reader of the doc meets them", () => {
    const text = written({ shape: SHAPE });

    expect(text).toContain("## The stakes");
    expect(text).toContain(SHAPE.stakes!.stillReal);
  });

  it("writes no stakes and no check instant for a row with no shape", () => {
    const doc = parsed({ text: written({ shape: undefined }) });

    expect(doc.risk).toBeUndefined();
    expect(doc.stillRealIso).toBeUndefined();
  });

  it("quotes a stakes value that spells a second key, so it cannot author one", () => {
    const risk = 'wrong base\nlean: "the release branch"';
    const doc = parsed({ text: written({ shape: { ...SHAPE, stakes: { ...SHAPE.stakes!, risk } } }) });

    // One scalar, its break decoded and then held to one line as every prose field is — never a second key.
    expect(doc.risk).toBe('wrong base lean: "the release branch"');
    expect(doc.lean).toBe(SHAPE.lean);
  });
});
