/*
 * A class of card the owner keeps sending back becomes a "make it a general ruling?" question, because the same
 * feedback repeating means a rule is missing. The fixture chain: sd-aca21d36,
 * sent back for no proof and re-cut as sd-b9230a1c, which came back the same way, beside sd-4a11e00c and sd-ffab16e8.
 */

import { describe, expect, it } from "vitest";

import { readTriageFeedback } from "../../components/live/readAlignment";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import { type CardFeedback, cardRulingCandidates } from "../../lib/alignmentRules";

/** One cut, as `slack draft list --json` prints it. */
const cut = ({
  id,
  outcome,
  state,
}: {
  id: string;
  outcome?: string;
  state: "held" | "dropped";
}): Record<string, unknown> => ({
  draft: {
    advisory: [],
    channel: "D0ISO",
    digest: `digest-${id}`,
    mentions: [],
    payload: { text: `cut ${id}` },
    shape: "top-level",
    tsIso: "2026-10-13T02:00:00.000Z",
    why: `cut ${id}`,
  },
  id,
  ...(outcome === undefined ? {} : { outcome }),
  ...(state === "held"
    ? { release: { command: `slopweaver slack post --as me --draft ${id} --approve digest-${id}`, kind: "send" } }
    : { resolvedIso: "2026-10-13T02:10:00.000Z" }),
  state,
});

const REGISTER: readonly ParkedDraft[] = readParkedDrafts({
  items: [
    cut({ id: "sd-b9230a1c", state: "held" }),
    cut({ id: "sd-aca21d36", outcome: "superseded by sd-b9230a1c (recorded with --supersedes)", state: "dropped" }),
    cut({ id: "sd-4a11e00c", state: "held" }),
    cut({ id: "sd-ffab16e8", state: "held" }),
  ],
  people: [],
})!;

/** The owner's feedback on one card. */
const said = ({ about, atIso, words }: { about: string; atIso: string; words: string }): CardFeedback => ({
  about,
  atIso,
  feedback: "no-receipts",
  words,
});

describe("cardRulingCandidates", () => {
  it("asks once the owner has sent back two distinct drafts for one class, quoting their latest words on each, newest first", () => {
    const feedback = [
      said({ about: "post:sd-4a11e00c", atIso: "2026-10-13T23:30:00.000Z", words: "no receipts on this" }),
      said({ about: "post:sd-ffab16e8", atIso: "2026-10-13T23:40:00.000Z", words: "where's the proof" }),
    ];
    expect(cardRulingCandidates({ drafts: REGISTER, feedback })).toEqual([
      {
        feedback: "no-receipts",
        key: "align:rule-card-no-receipts",
        quotes: [
          { atIso: "2026-10-13T23:40:00.000Z", draftId: "sd-ffab16e8", words: "where's the proof" },
          { atIso: "2026-10-13T23:30:00.000Z", draftId: "sd-4a11e00c", words: "no receipts on this" },
        ],
        stakes: {
          blastRadius:
            "It would reach every card in that class, not only these. This question is based on 2 distinct draft chains you sent back on 13 Oct 2026.",
          risk: "Making this standing would let the fleet hold back, before it reaches you, every card it judges to be a card that makes a claim with no receipt to check it, without asking on each one. The draft readings do not measure how often that judgement is wrong.",
        },
      },
    ]);
  });

  it("dates its blast radius by the chains that stand, so a superseded cut's earlier feedback widens nothing", () => {
    const feedback = [
      said({ about: "post:sd-aca21d36", atIso: "2026-10-01T02:00:00.000Z", words: "no proof" }),
      said({ about: "post:sd-b9230a1c", atIso: "2026-10-13T23:30:00.000Z", words: "still no receipts" }),
      said({ about: "post:sd-4a11e00c", atIso: "2026-10-20T23:30:00.000Z", words: "no receipts on this" }),
    ];
    expect(
      cardRulingCandidates({ drafts: REGISTER, feedback }).map((candidate) => candidate.stakes.blastRadius),
    ).toEqual([
      "It would reach every card in that class, not only these. This question is based on 2 distinct draft chains you sent back from 13 Oct 2026 to 20 Oct 2026.",
    ]);
  });

  it("counts a re-cut chain once, at the cut that stands, so a draft sent back twice is not a repeat", () => {
    const feedback = [
      said({ about: "post:sd-aca21d36", atIso: "2026-10-13T02:00:00.000Z", words: "no proof" }),
      said({ about: "post:sd-b9230a1c", atIso: "2026-10-13T23:30:00.000Z", words: "still no receipts" }),
      said({ about: "post:sd-b9230a1c", atIso: "2026-10-13T23:31:00.000Z", words: "send it back" }),
    ];
    expect(cardRulingCandidates({ drafts: REGISTER, feedback })).toEqual([]);
  });

  it("keeps the classes apart, and skips a key that names no draft", () => {
    const feedback: readonly CardFeedback[] = [
      said({ about: "post:sd-4a11e00c", atIso: "2026-10-13T23:30:00.000Z", words: "no receipts" }),
      {
        ...said({ about: "post:sd-ffab16e8", atIso: "2026-10-13T23:40:00.000Z", words: "too much" }),
        feedback: "not-at-a-glance",
      },
      said({ about: "act:ev-9", atIso: "2026-10-13T23:50:00.000Z", words: "no receipts" }),
    ];
    expect(cardRulingCandidates({ drafts: REGISTER, feedback })).toEqual([]);
  });
});

describe("readTriageFeedback", () => {
  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    about: "post:sd-4a11e00c",
    heard: "no receipts on this",
    registeredAtIso: "2026-10-13T23:30:00.000Z",
    state: "registered",
    ...over,
  });

  it("reads the owner's named feedback, and skips a relay with no triage, none named, or not yet registered", () => {
    expect(
      readTriageFeedback({
        rows: [
          row({ triageRuling: { feedback: "no-receipts", verdict: "needs-more-info" } }),
          row({}),
          row({ triageRuling: null }),
          row({ triageRuling: { verdict: "rewrite" } }),
          row({
            registeredAtIso: null,
            state: "intended",
            triageRuling: { feedback: "no-receipts", verdict: "rewrite" },
          }),
        ],
      }),
    ).toEqual([
      {
        about: "post:sd-4a11e00c",
        atIso: "2026-10-13T23:30:00.000Z",
        feedback: "no-receipts",
        words: "no receipts on this",
      },
    ]);
  });

  it("refuses the whole reading on a triage it cannot read, rather than dropping a repeat", () => {
    expect([
      readTriageFeedback({ rows: [row({ triageRuling: { feedback: "too-long", verdict: "rewrite" } })] }),
      readTriageFeedback({ rows: [row({ triageRuling: { feedback: "no-receipts", verdict: "send-it" } })] }),
      readTriageFeedback({ rows: [row({ triageRuling: { mood: "cross", verdict: "rewrite" } })] }),
      readTriageFeedback({ rows: [row({ triageRuling: "rewrite" })] }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
