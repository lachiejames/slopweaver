/**
 * The approved-draft gate's landing lines, pure: the owner's words with the voice turn they answered and the relay's
 * verdict beside them, and the two judgement commands in the order the verdict decides — an emphatic yes given to a
 * needs-more-info question as the worked case.
 */
import { describe, expect, it } from "vitest";

import {
  HEARD_CHARS,
  landedDraft,
  landingHead,
  STATE_UNKNOWN,
} from "../../../../../cli/commands/supervisor/approvedDraftLandings.js";
import type { AnswerContext, TriageVerdictRead } from "../../../../../talk/answerContext.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { draftItem } from "../../../supervisor/draftItemFixture.js";

const TURN = "a0000025-0000-4000-8000-000000000028";
const RELAY_ANCHOR = `talk:${TURN}`;
const POINTER = "talk-call:a0000044-0000-4000-8000-000000000047#turn_000000000000000000022";
const DRAFT = "sd-ffab16e8";

const landing = ({ anchor, words }: { anchor: string; words: string }): CardLandedRow => ({
  anchor,
  atIso: "2026-10-13T23:38:53.000Z",
  cardKey: `post:${DRAFT}`,
  decidedIso: "2026-10-13T23:38:47.000Z",
  kind: "landed",
  source: "relay",
  words,
  workSlug: "talk-a00000250000",
});

const RELAY_YES = landing({ anchor: RELAY_ANCHOR, words: "Yes, of course" });
const HEAD = `  post:${DRAFT} — the owner said "Yes, of course" at ${RELAY_ANCHOR} (2026-10-13T23:38:47.000Z)`;
const DRAFT_LINE = `    on ${DRAFT}, recorded 2026-10-13T23:30:00.000Z`;
const YES = `    yes: slopweaver slack draft approve ${DRAFT} --anchor ${RELAY_ANCHOR}`;
const NOT = `    not: slopweaver slack draft hold ${DRAFT} --reason not-owner-yes --why "<what they meant>"`;

const answer = ({ triage }: { triage: TriageVerdictRead }): AnswerContext => ({
  triage,
  voice: {
    kind: "found",
    turn: { beganIso: "2026-10-13T23:38:26.835Z", pointer: POINTER, text: "Needs more info here too?" },
  },
});
const VOICE_LINE = `    answering the voice's "Needs more info here too?" (${POINTER})`;

const bound = ({
  anchor = RELAY_ANCHOR,
  namedId = DRAFT,
  words = RELAY_YES.words,
}: { anchor?: string; namedId?: string; words?: string } = {}) => ({
  item: draftItem({ id: DRAFT, tsIso: "2026-10-13T23:30:00.000Z" }),
  landing: { ...RELAY_YES, anchor, words },
  namedId,
});

/** A remark the owner made with the card open, which carries no yes. */
const REMARK = "Hm, which one was that again?";
const NO_YES =
  "    yes: not at this anchor — the words carry no yes, so `slack draft approve` refuses this anchor; only a newer " +
  "yes from the owner, at its own anchor, approves it";

describe("landingHead", () => {
  it("prints the owner's words, then the voice's question and the stored verdict beneath them", () => {
    const triage = { kind: "stored", ruling: { label: undefined, verdict: "needs-more-info" } } as const;
    expect(landingHead({ answer: answer({ triage }), landing: RELAY_YES })).toStrictEqual([
      HEAD,
      VOICE_LINE,
      "    triage verdict needs-more-info: The owner's triage verdict on this card: needs more info — find what is missing and put it on the card.",
    ]);
  });

  it("says what the owner's words answered was not read, rather than printing them bare", () => {
    expect(landingHead({ answer: undefined, landing: RELAY_YES })).toStrictEqual([
      HEAD,
      "    what these words answered was not read for this landing: read the call before judging them",
    ]);
  });

  it("cuts the owner's words at the characters each named draft carries", () => {
    const long = landing({ anchor: RELAY_ANCHOR, words: "y".repeat(HEARD_CHARS + 20) });
    expect(landingHead({ answer: undefined, landing: long })[0]).toBe(
      `  post:${DRAFT} — the owner said "${"y".repeat(HEARD_CHARS)}" at ${RELAY_ANCHOR} (2026-10-13T23:38:47.000Z)`,
    );
  });
});

describe("landedDraft", () => {
  it("never offers approve at a relay anchor whose stored verdict sent the card back, and names that verdict in the hold", () => {
    const triage = { kind: "stored", ruling: { label: undefined, verdict: "needs-more-info" } } as const;
    expect(landedDraft({ answer: answer({ triage }), bound: bound(), unsure: false }).slice(3)).toStrictEqual([
      DRAFT_LINE,
      `    not: slopweaver slack draft hold ${DRAFT} --reason not-owner-yes --why "relay verdict needs-more-info: <what they meant>"`,
      "    yes: not at this anchor — the relay stored needs-more-info, so `slack draft approve` refuses this anchor; only a newer yes from the owner, at its own anchor, approves it",
    ]);
  });

  it("says approve refuses a relay anchor that recorded no verdict", () => {
    const triage = { kind: "not-recorded", slug: "talk-a00000250000" } as const;
    expect(landedDraft({ answer: answer({ triage }), bound: bound(), unsure: false }).slice(3)).toStrictEqual([
      DRAFT_LINE,
      NOT,
      "    yes: not at this anchor — the relay recorded no verdict, so `slack draft approve` refuses this anchor; only a newer yes from the owner, at its own anchor, approves it",
    ]);
  });

  it("leads with approve when the relay stored send-it", () => {
    const triage = { kind: "stored", ruling: { label: undefined, verdict: "send-it" } } as const;
    expect(landedDraft({ answer: answer({ triage }), bound: bound(), unsure: false }).slice(3)).toStrictEqual([
      DRAFT_LINE,
      YES,
      NOT,
    ]);
  });

  it("offers approve at an unruled relay whose words carry a yes, and refuses one whose words are a remark", () => {
    const triage = { kind: "none" } as const;
    const yes = landedDraft({ answer: answer({ triage }), bound: bound(), unsure: false }).slice(3);
    const remark = landedDraft({ answer: answer({ triage }), bound: bound({ words: REMARK }), unsure: false }).slice(3);
    expect([yes.includes(YES), remark]).toStrictEqual([true, [DRAFT_LINE, NOT, NO_YES]]);
  });

  it("still offers approve on a stored send-it whatever the words, since the verdict is the affirmative act", () => {
    const triage = { kind: "stored", ruling: { label: undefined, verdict: "send-it" } } as const;
    const lines = landedDraft({ answer: answer({ triage }), bound: bound({ words: "Mm." }), unsure: false });
    expect(lines.slice(3)).toStrictEqual([DRAFT_LINE, YES, NOT]);
  });

  it("never offers approve at a call landing whose words are a remark, read or not", () => {
    const anchor = "call:a0000044-0000-4000-8000-000000000047#h1";
    expect(
      landedDraft({ answer: undefined, bound: bound({ anchor, words: REMARK }), unsure: false }).slice(2),
    ).toStrictEqual([DRAFT_LINE, NOT, NO_YES]);
  });

  it("never offers approve at a call landing with an uppercase call id, which the approve still word-checks", () => {
    const anchor = "call:A0000044-0000-4000-8000-000000000047#h1";
    expect(
      landedDraft({ answer: undefined, bound: bound({ anchor, words: REMARK }), unsure: false }).slice(2),
    ).toStrictEqual([DRAFT_LINE, NOT, NO_YES]);
  });

  it("never offers approve at a relay whose turn would not read, which the approve reads first", () => {
    const triage = { kind: "unreadable", why: "turn file is corrupt" } as const;
    expect(landedDraft({ answer: answer({ triage }), bound: bound(), unsure: false }).at(-1)).toBe(
      "    yes: not at this anchor — the relay's turn would not read (turn file is corrupt), so `slack draft approve` " +
        "refuses this anchor; only a newer yes from the owner, at its own anchor, approves it",
    );
  });

  it("never offers a re-record for a dropped draft whose landing words are a remark", () => {
    const anchor = "call:a0000044-0000-4000-8000-000000000047#h1";
    const dropped = {
      ...bound({ anchor, words: REMARK }),
      item: draftItem({
        id: DRAFT,
        outcome: "superseded",
        resolvedIso: "2026-10-13T23:35:00.000Z",
        state: "dropped",
        tsIso: "2026-10-13T23:30:00.000Z",
      }),
    };
    expect(landedDraft({ answer: undefined, bound: dropped, unsure: false })[3]).toBe(NO_YES);
  });

  it("leads with the hold when what the owner's words answered was not read", () => {
    const anchor = "call:a0000044-0000-4000-8000-000000000047#h1";
    expect(landedDraft({ answer: undefined, bound: bound({ anchor }), unsure: false }).slice(2)).toStrictEqual([
      DRAFT_LINE,
      NOT,
      `    yes: slopweaver slack draft approve ${DRAFT} --anchor ${anchor}`,
    ]);
  });

  it("names the cut that stands when the card named an earlier one", () => {
    const triage = { kind: "stored", ruling: { label: undefined, verdict: "send-it" } } as const;
    const lines = landedDraft({ answer: answer({ triage }), bound: bound({ namedId: "sd-00000001" }), unsure: false });
    expect(lines[3]).toBe(
      `    on ${DRAFT} (the card names sd-00000001; this is the cut that stands), recorded 2026-10-13T23:30:00.000Z`,
    );
  });

  it("prints the state unknown in place of any command when a register line this build cannot read names the draft", () => {
    expect(landedDraft({ answer: undefined, bound: bound(), unsure: true }).slice(2)).toStrictEqual([
      DRAFT_LINE,
      STATE_UNKNOWN,
    ]);
  });

  it("offers a re-record or a restore for a draft dropped before the owner's words landed", () => {
    const dropped = {
      ...bound(),
      item: draftItem({
        id: DRAFT,
        outcome: "superseded",
        resolvedIso: "2026-10-13T23:35:00.000Z",
        state: "dropped",
        tsIso: "2026-10-13T23:30:00.000Z",
      }),
    };
    expect(landedDraft({ answer: undefined, bound: dropped, unsure: false }).slice(2)).toStrictEqual([
      `    on ${DRAFT}, DROPPED 2026-10-13T23:35:00.000Z (superseded) before these words were landed, so the drop never weighed them`,
      `    yes: re-record its exact words with slopweaver slack draft record … --approved ${RELAY_ANCHOR}, which owes the send`,
      `    not: slopweaver talk restore --card post:${DRAFT} --anchor "<where you decided>" --why "<why the drop stands>"`,
    ]);
  });
});
