import { describe, expect, it } from "vitest";
import { packProofSourceOf, packProofsFor, proofLines } from "../../../talk/packProofs.js";
import { packPrWordsOf, prWordsLines } from "../../../talk/packPrWords.js";

const CHECKED = "2026-10-14T08:00:00.000Z";
const GAP =
  'You asked for proof on acme/acme-admin#17564 on 2026-09-25 ("before and after") and its body still carries no screenshot.';

const document = {
  checkedIso: CHECKED,
  pullRequests: [
    { identity: "a/b#1", proof: { kind: "requested-and-met" }, rowSlugs: ["the-ask"] },
    { identity: "a/b#2", proof: { kind: "body-unread", why: "GitHub said 502" }, rowSlugs: ["the-ask"] },
    {
      identity: "acme/acme-admin#17564",
      proof: { gap: GAP, kind: "requested-and-unmet", missing: ["image"] },
      rowSlugs: ["proof-row", "the-ask"],
    },
    {
      identity: "a/b#3",
      proof: { gap: "other", kind: "requested-and-unmet", missing: ["run-link"] },
      rowSlugs: ["elsewhere"],
    },
  ],
  readFromIso: "2026-10-13T08:00:00.000Z",
};

/** Every pull request the ask's row names now. */
const NAMED = ["a/b#1", "a/b#2", "acme/acme-admin#17564"];

describe("packProofsFor", () => {
  it("carries every verdict naming the ask's row, the unmet one first", () => {
    const source = packProofSourceOf({ document });
    expect(packProofsFor({ named: NAMED, slug: "the-ask", source })).toEqual([
      { checkedIso: CHECKED, gap: GAP, identity: "acme/acme-admin#17564", verdict: "unmet" },
      { checkedIso: CHECKED, identity: "a/b#1", verdict: "met" },
      { checkedIso: CHECKED, identity: "a/b#2", verdict: "unread", why: "GitHub said 502" },
    ]);
    expect(packProofsFor({ named: NAMED, slug: "no-pr-row", source })).toEqual([]);
  });

  it("carries no verdict about a pull request the row no longer names, though the reading still lists its slug", () => {
    const source = packProofSourceOf({ document });
    expect(packProofsFor({ named: ["a/b#1"], slug: "the-ask", source })).toEqual([
      { checkedIso: CHECKED, identity: "a/b#1", verdict: "met" },
    ]);
    expect(packProofsFor({ named: [], slug: "the-ask", source })).toEqual([]);
  });

  it("is undefined, never an empty list, when the reading carries no verdicts to read", () => {
    const source = packProofSourceOf({ document: { checkedIso: CHECKED } });
    expect(source.kind).toBe("unread");
    expect(packProofsFor({ named: NAMED, slug: "the-ask", source })).toBe(undefined);
  });

  it("reads a gap naming nothing missing, or an empty gap, as no reading at all rather than a gap to lead with", () => {
    const withUnmet = ({ proof }: { proof: unknown }): unknown => ({
      checkedIso: CHECKED,
      pullRequests: [{ identity: "a/b#1", proof, rowSlugs: ["the-ask"] }],
    });
    const sources = [
      { gap: "Still missing screenshot.", kind: "requested-and-unmet" },
      { gap: "x", kind: "requested-and-unmet", missing: [] },
      { gap: "", kind: "requested-and-unmet", missing: ["image"] },
    ].map((proof) => packProofSourceOf({ document: withUnmet({ proof }) }));
    expect(sources.map((source) => source.kind)).toEqual(["unread", "unread", "unread"]);
  });
});

describe("proofLines", () => {
  it("leads with the gap, and says an unread body as not checked, never missing", () => {
    const proofs = packProofsFor({ named: NAMED, slug: "the-ask", source: packProofSourceOf({ document }) })!;
    expect(proofLines({ proofs })).toEqual({
      after: [
        `  proof on a/b#1: the body carried what the owner asked for at ${CHECKED}`,
        "  proof on a/b#2: the owner asked for it; the body was not checked (GitHub said 502) — say not checked, never missing",
      ],
      lead: [`  SAY THIS FIRST, before the question — ${GAP} (body read ${CHECKED})`],
    });
    expect(proofLines({ proofs: [] })).toEqual({ after: [], lead: [] });
    expect(proofLines({ proofs: undefined })).toEqual({ after: [], lead: [] });
  });
});

describe("prWordsLines", () => {
  const prWords = packPrWordsOf({
    prSteers: [
      ["one", "r1"],
      ["two", "r2"],
      ["three", "r3"],
      ["four", "r3"],
    ].map(([words, rowSlug]) => ({
      identity: "a/b#1",
      quote: { atIso: "2026-09-25T01:00:00.000Z", words: words! },
      rowSlug: rowSlug!,
    })),
  });

  it("draws the shown quotes with their source rows, and counts the rest with the rows that hold them", () => {
    expect(prWordsLines({ maxChars: 600, prWords, shown: 2 })).toEqual([
      '  the owner\'s words on a/b#1, 2026-09-25T01:00:00.000Z on ask:r1: "one"',
      '  the owner\'s words on a/b#1, 2026-09-25T01:00:00.000Z on ask:r2: "two"',
      "  2 more of the owner's words on its pull request(s) not shown — board_row on ask:r3",
    ]);
  });

  it("draws nothing for a board that carried no fold", () => {
    expect(packPrWordsOf({ prSteers: undefined })).toBe(undefined);
    expect(prWordsLines({ maxChars: 600, prWords: undefined, shown: 2 })).toEqual([]);
  });
});
