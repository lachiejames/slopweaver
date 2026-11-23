import { describe, expect, it } from "vitest";

import { type ReviewerListDocument, renderReviewerList } from "../../../../../cli/commands/github/reviewerCore.js";

const BASE = {
  observedAtIso: "2026-09-25T07:00:00.000Z",
  people: { U0ALICE: "Alice" },
  readingId: "2026-09-24T20:35:59.474Z-github-landing",
  readingObservedAtIso: "2026-09-24T20:35:59.474Z",
  registerAsks: 5,
} as const;

describe("renderReviewerList", () => {
  it("heads the list with the reading it was made over and how many asks the register holds", () => {
    const document: ReviewerListDocument = { ...BASE, rows: [] };
    expect(renderReviewerList({ document })).toEqual([
      "github reviewer: 0 open pull request(s) from reading 2026-09-24T20:35:59.474Z-github-landing " +
        "(2026-09-24T20:35:59.474Z); the register holds 5 ask(s)",
    ]);
  });

  it("prints each hook in words, names a known person, and puts a suggestion under its row", () => {
    const document: ReviewerListDocument = {
      ...BASE,
      rows: [
        {
          hook: { kind: "not-due", why: "draft" },
          number: 1,
          repoSlug: "slopweaver",
          title: "a draft",
          url: "https://github.com/lachiejames/slopweaver/pull/1",
        },
        {
          hook: { atIso: "2026-09-24T21:00:00.000Z", kind: "picked", reviewer: "U0ALICE" },
          number: 2,
          repoSlug: "slopweaver",
          title: "picked",
          url: "https://github.com/lachiejames/slopweaver/pull/2",
        },
        {
          hook: { kind: "nobody-asked" },
          number: 17560,
          repoSlug: "acme-admin",
          suggestion: {
            alternatives: [],
            primary: {
              basis: "GitHub names them as a code owner on this pull request",
              earlierPrs: 0,
              lastAskedIso: undefined,
              reviewer: "U0BOB",
              tier: "named-code-owner",
            },
          },
          title: "nobody asked",
          url: "https://github.com/acme/acme-admin/pull/17560",
        },
      ],
    };
    expect(renderReviewerList({ document }).slice(1)).toEqual([
      "slopweaver#1  not due — draft",
      "slopweaver#2  picked Alice (U0ALICE), no ask seen since",
      "acme-admin#17560  nobody asked in Slack yet",
      "    suggest U0BOB — GitHub names them as a code owner on this pull request",
    ]);
  });
});
