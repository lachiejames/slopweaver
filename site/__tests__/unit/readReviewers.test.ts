/*
 * `github reviewer list --json` read strictly: a pick, a suggestion with its tier and basis, the names — and a
 * row that will not parse refusing the whole reading rather than reading as nobody to suggest.
 */
import { describe, expect, it } from "vitest";

import { readReviewers, reviewerRowFor } from "../../components/live/readReviewers";

const PAYLOAD = {
  observedAtIso: "2026-09-24T19:20:43.085Z",
  people: { U0SYN000004: "Quinn" },
  readingId: "2026-09-24T19:19:44.231Z-github-landing",
  readingObservedAtIso: "2026-09-24T19:19:44.230Z",
  registerAsks: 5,
  rows: [
    {
      hook: { kind: "nobody-asked" },
      number: 17560,
      repoSlug: "acme/acme-admin",
      suggestion: {
        alternatives: [],
        primary: {
          basis: "you asked them on 2 earlier pull requests owned by @acme/dx — history, not ownership",
          earlierPrs: 2,
          lastAskedIso: "2026-09-10T00:00:00.000Z",
          reviewer: "U0SYN000004",
          tier: "team-history",
        },
      },
      title: "t",
      url: "u",
    },
    {
      hook: { atIso: "2026-09-24T20:00:00.000Z", kind: "picked", reviewer: "U0SYN000004" },
      number: 17561,
      repoSlug: "acme/acme-admin",
      title: "t",
      url: "u",
    },
  ],
};

describe("readReviewers", () => {
  it("reads the join: a suggestion with its tier and basis, a pick, and the names", () => {
    const reviewers = readReviewers(PAYLOAD)!;
    expect([reviewers.readingId, reviewers.registerAsks, [...reviewers.people]]).toEqual([
      "2026-09-24T19:19:44.231Z-github-landing",
      5,
      [["U0SYN000004", { handle: undefined, name: "Quinn" }]],
    ]);
    expect(reviewerRowFor({ number: 17560, repoSlug: "acme/acme-admin", reviewers })!.suggestion).toEqual({
      alternatives: [],
      primary: {
        basis: "you asked them on 2 earlier pull requests owned by @acme/dx — history, not ownership",
        reviewer: "U0SYN000004",
        tier: "team-history",
      },
    });
    expect(reviewerRowFor({ number: 17561, repoSlug: "acme/acme-admin", reviewers })!.picked).toEqual({
      atIso: "2026-09-24T20:00:00.000Z",
      reviewer: "U0SYN000004",
    });
  });

  it("refuses the whole reading on a tier it does not know, or a pick with no reviewer", () => {
    const [first, second] = PAYLOAD.rows;
    const badTier = {
      ...PAYLOAD,
      rows: [
        { ...first, suggestion: { ...first.suggestion, primary: { ...first.suggestion!.primary, tier: "vibes" } } },
      ],
    };
    const badPick = { ...PAYLOAD, rows: [{ ...second, hook: { kind: "picked" } }] };
    expect([readReviewers(badTier), readReviewers(badPick), readReviewers("nope")]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
