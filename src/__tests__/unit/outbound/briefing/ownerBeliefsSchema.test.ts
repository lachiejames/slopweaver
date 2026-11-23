/**
 * The correction block's schema and its above-the-fold word count: a valid block parses unchanged, every
 * bound is pinned with its accepted edge beside its refused neighbour, a duplicate proposal id and an unknown
 * key are refused, and the word count charges only the domain, the claim and the proposal id.
 */
import { describe, expect, it } from "vitest";

import { ownerBeliefRowAboveFoldWords, ownerBeliefsSchema } from "../../../../outbound/briefing/ownerBeliefsSchema.js";
import type { BriefingOwnerBeliefsRow } from "../../../../outbound/briefing/types.js";

const row = (over: Partial<BriefingOwnerBeliefsRow> = {}): BriefingOwnerBeliefsRow => ({
  claim: "Monitors stay alert only.",
  domain: "datadog",
  held: "stated-confident",
  proposalId: "p-0123456789abcdef",
  quote: "no recovery pings, ever",
  reviewedAtIso: "2026-09-12T02:06:09Z",
  unitId: "u-fedcba9876543210",
  wrapped: false,
  ...over,
});

const accepts = ({ rows, notShown = 0 }: { rows: readonly unknown[]; notShown?: number }): boolean =>
  ownerBeliefsSchema.safeParse({ notShown, rows }).success;

const acceptsRow = (over: Record<string, unknown>): boolean => accepts({ rows: [{ ...row(), ...over }] });

describe("ownerBeliefsSchema", () => {
  it("parses a valid block unchanged", () => {
    const block = {
      notShown: 4,
      rows: [
        row(),
        row({
          held: "stated-uncertain",
          proposalId: "u-aaaaaaaaaaaaaaaa",
          quote: "maybe",
          unitId: "p-0000000000008888",
          wrapped: true,
        }),
      ],
    };
    const parsed = ownerBeliefsSchema.safeParse(block);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      notShown: 4,
      rows: [
        {
          claim: "Monitors stay alert only.",
          domain: "datadog",
          held: "stated-confident",
          proposalId: "p-0123456789abcdef",
          quote: "no recovery pings, ever",
          reviewedAtIso: "2026-09-12T02:06:09Z",
          unitId: "u-fedcba9876543210",
          wrapped: false,
        },
        {
          claim: "Monitors stay alert only.",
          domain: "datadog",
          held: "stated-uncertain",
          proposalId: "u-aaaaaaaaaaaaaaaa",
          quote: "maybe",
          reviewedAtIso: "2026-09-12T02:06:09Z",
          unitId: "p-0000000000008888",
          wrapped: true,
        },
      ],
    });
  });

  it("accepts 3 rows and refuses 4, naming where the rest go", () => {
    const ids = ["p-0000000000000001", "p-0000000000000002", "p-0000000000000003", "p-0000000000000004"];
    const rows = ids.map((proposalId) => row({ proposalId }));
    expect(accepts({ rows: rows.slice(0, 3) })).toBe(true);
    const refused = ownerBeliefsSchema.safeParse({ notShown: 0, rows });
    expect(refused.success).toBe(false);
    expect(refused.error!.issues.map((issue) => issue.message)).toEqual([
      "the correction block shows at most 3 beliefs. The queue keeps all of them — project the oldest open ones, and let `notShown` state how many are not on this page.",
    ]);
  });

  it("accepts an empty block", () => {
    expect(accepts({ rows: [] })).toBe(true);
  });

  it("accepts a 400-character claim and refuses a 401-character one", () => {
    expect(acceptsRow({ claim: "a".repeat(400) })).toBe(true);
    expect(acceptsRow({ claim: "a".repeat(401) })).toBe(false);
  });

  it("accepts both belief holds and refuses any other", () => {
    expect(acceptsRow({ held: "stated-uncertain" })).toBe(true);
    expect(acceptsRow({ held: "stated-confident" })).toBe(true);
    expect(acceptsRow({ held: "inferred" })).toBe(false);
  });

  it("accepts a p- and a u- queue id and refuses a wrong prefix, uppercase hex and a wrong length", () => {
    expect(acceptsRow({ proposalId: "p-0123456789abcdef" })).toBe(true);
    expect(acceptsRow({ proposalId: "u-0123456789abcdef" })).toBe(true);
    expect(acceptsRow({ proposalId: "x-0123456789abcdef" })).toBe(false);
    expect(acceptsRow({ proposalId: "p-0123456789ABCDEF" })).toBe(false);
    expect(acceptsRow({ proposalId: "p-0123456789abcde" })).toBe(false);
    expect(acceptsRow({ proposalId: "p-0123456789abcdef0" })).toBe(false);
    expect(acceptsRow({ unitId: "u-0123456789abcdef" })).toBe(true);
    expect(acceptsRow({ unitId: "q-0123456789abcdef" })).toBe(false);
  });

  it("refuses a malformed queue id with the message naming the queue's own shape", () => {
    const refused = ownerBeliefsSchema.safeParse({ notShown: 0, rows: [row({ proposalId: "p-xyz" })] });
    expect(refused.error!.issues.map((issue) => issue.message)).toEqual([
      "a correction row's ids are the queue's own: `p-` or `u-` and sixteen hex characters. One that is not is a row nothing wrote, so `slopweaver knowledge answer` could never find it.",
    ]);
  });

  it("accepts notShown 0 and refuses -1 and a fraction", () => {
    expect(accepts({ notShown: 0, rows: [] })).toBe(true);
    expect(accepts({ notShown: -1, rows: [] })).toBe(false);
    expect(accepts({ notShown: 1.5, rows: [] })).toBe(false);
  });

  it("accepts distinct proposal ids and refuses a duplicate with the ambiguity message", () => {
    expect(accepts({ rows: [row(), row({ proposalId: "p-0000000000001111" })] })).toBe(true);
    const refused = ownerBeliefsSchema.safeParse({ notShown: 0, rows: [row(), row()] });
    expect(refused.error!.issues.map((issue) => issue.message)).toEqual([
      "two rows of the correction block carry the same proposal id, so the owner's answer naming it could not say which row it marks. Project the queue's open proposals rather than re-assembling them.",
    ]);
  });

  it("does not constrain row order", () => {
    const first = row({ proposalId: "p-0000000000009999" });
    const second = row({ proposalId: "p-0000000000000000" });
    expect(accepts({ rows: [first, second] })).toBe(true);
    expect(accepts({ rows: [second, first] })).toBe(true);
  });

  it("accepts a 2- and a 40-character slug domain and refuses 1, 41, uppercase and a double hyphen", () => {
    expect(acceptsRow({ domain: "ab" })).toBe(true);
    expect(acceptsRow({ domain: "a" })).toBe(false);
    expect(acceptsRow({ domain: "a".repeat(40) })).toBe(true);
    expect(acceptsRow({ domain: "a".repeat(41) })).toBe(false);
    expect(acceptsRow({ domain: "Datadog" })).toBe(false);
    expect(acceptsRow({ domain: "data--dog" })).toBe(false);
  });

  it("refuses an empty quote and accepts a long one, since the quote is uncapped", () => {
    expect(acceptsRow({ quote: "" })).toBe(false);
    expect(acceptsRow({ quote: "word ".repeat(500) })).toBe(true);
  });

  it("refuses an instant no Date parses, with the instant message", () => {
    const refused = ownerBeliefsSchema.safeParse({ notShown: 0, rows: [row({ reviewedAtIso: "not a time" })] });
    expect(refused.error!.issues.map((issue) => issue.message)).toEqual([
      "a proposal's instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-12T02:06:09Z`.",
    ]);
    expect(acceptsRow({ reviewedAtIso: "" })).toBe(false);
  });

  it("accepts a 40-character instant and refuses a 41-character one", () => {
    const forty = "Saturday, September 12, 2026 2:06:09 GMT";
    const fortyOne = "Saturday, September 12, 2026 02:06:09 GMT";
    // The refused neighbour is one a Date parses, so only the 40-character cap can be what refuses it.
    expect(Number.isNaN(Date.parse(fortyOne))).toBe(false);
    expect(acceptsRow({ reviewedAtIso: forty })).toBe(true);
    expect(acceptsRow({ reviewedAtIso: fortyOne })).toBe(false);
  });

  it("accepts a non-ISO string that Date still parses, because the check is Date.parse and not ISO-8601", () => {
    expect(acceptsRow({ reviewedAtIso: "September 12, 2026" })).toBe(true);
  });

  it("refuses an unknown key on a row and on the block", () => {
    expect(acceptsRow({ confidence: "high" })).toBe(false);
    expect(ownerBeliefsSchema.safeParse({ extra: 1, notShown: 0, rows: [] }).success).toBe(false);
  });
});

describe("ownerBeliefRowAboveFoldWords", () => {
  it("counts the domain, the claim and the proposal id", () => {
    expect(ownerBeliefRowAboveFoldWords({ row: row() })).toBe(6);
  });

  it("ignores every folded field — quote, hold, wrap, unit and review time", () => {
    const folded = row({
      held: "stated-uncertain",
      quote: "a much longer quote of the owner's own words that would add many words if it were counted",
      reviewedAtIso: "2026-01-01T00:00:00Z",
      unitId: "p-0000000000007777",
      wrapped: true,
    });
    expect(ownerBeliefRowAboveFoldWords({ row: folded })).toBe(6);
  });

  it("grows with the claim", () => {
    expect(ownerBeliefRowAboveFoldWords({ row: row({ claim: "one two three four five six" }) })).toBe(8);
  });
});
