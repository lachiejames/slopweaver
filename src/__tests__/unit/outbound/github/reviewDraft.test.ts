import { describe, expect, it } from "vitest";

import {
  foldReviewDrafts,
  type ParkedReviewDraft,
  parseReviewDraftLog,
  recomputedDigest,
  reviewDraftById,
  reviewDraftDigest,
  reviewDraftEventLine,
  skippedReviewDraftNote,
} from "../../../../outbound/github/reviewDraft.js";

const HEAD = "d5e7b95cb463f00d54be6f14430afc6648deb99b";

/** A parked row whose digest is the digest of its own content, the way `record` writes one. */
function parked({
  id,
  tsIso,
  over = {},
}: {
  id: string;
  tsIso: string;
  over?: Partial<ParkedReviewDraft>;
}): ParkedReviewDraft {
  const bound = {
    body: "Looks right to me; two things inline.",
    comments: [
      {
        body: "I think this reads as reachable for an booking too",
        hunk: [{ kind: "header" as const, text: "@@ -1,2 +1,3 @@" }],
        line: 3,
        path: "src/a.ts",
      },
    ],
    headSha: HEAD,
    number: 17961,
    repo: "acme/acme-admin",
    verdict: "COMMENT" as const,
    ...over,
  };
  return {
    author: "someone",
    id,
    title: "a title",
    tsIso,
    url: "https://github.com/acme/acme-admin/pull/17961",
    why: "a review of someone else's pull request",
    ...bound,
    digest: reviewDraftDigest({ draft: bound }),
  };
}

describe("reviewDraftDigest", () => {
  const base = parked({ id: "rd-1", tsIso: "2026-09-28T00:00:00.000Z" });

  it("changes when anything that would be posted, or where, changes", () => {
    const variants: Partial<ParkedReviewDraft>[] = [
      { body: "different body" },
      { verdict: "APPROVE" },
      { headSha: "0".repeat(40) },
      { number: 1 },
      { repo: "o/other" },
      { comments: [{ ...base.comments[0]!, body: "other words" }] },
      { comments: [{ ...base.comments[0]!, line: 4 }] },
      { comments: [{ ...base.comments[0]!, startLine: 2 }] },
      { comments: [{ ...base.comments[0]!, path: "src/b.ts" }] },
    ];
    for (const over of variants) {
      expect(parked({ id: "rd-1", over, tsIso: base.tsIso }).digest).not.toBe(base.digest);
    }
  });

  it("does not change on bookkeeping or on the picture of the hunk", () => {
    const moved = { ...base, comments: [{ ...base.comments[0]!, hunk: [] }], title: "renamed", why: "other" };

    expect(reviewDraftDigest({ draft: moved })).toBe(base.digest);
  });
});

describe("recomputedDigest", () => {
  it("names a row whose content was edited after it was recorded", () => {
    const row = parked({ id: "rd-1", tsIso: "2026-09-28T00:00:00.000Z" });
    const edited = { ...row, body: "edited under the owner" };

    expect(recomputedDigest({ draft: row })._unsafeUnwrap()).toBe(row.digest);
    expect(recomputedDigest({ draft: edited })._unsafeUnwrapErr().code).toBe("REVIEW_DRAFT_DRIFTED");
  });
});

describe("the register", () => {
  const first = parked({ id: "rd-1", tsIso: "2026-09-28T00:00:00.000Z" });
  const second = parked({ id: "rd-2", tsIso: "2026-09-28T01:00:00.000Z" });
  const lines = [
    reviewDraftEventLine({ event: { draft: first, id: "rd-1", kind: "parked", tsIso: first.tsIso } }),
    reviewDraftEventLine({ event: { draft: second, id: "rd-2", kind: "parked", tsIso: second.tsIso } }),
    reviewDraftEventLine({
      event: { id: "rd-1", kind: "posted", tsIso: "2026-09-28T02:00:00.000Z", url: "https://x/review" },
    }),
    reviewDraftEventLine({ event: { id: "rd-9", kind: "dropped", note: "orphan", tsIso: "2026-09-28T03:00:00.000Z" } }),
    "not json",
    '{"kind":"parked","id":"rd-3"}',
    "",
  ];

  it("round-trips its own lines and counts, rather than hides, the ones it cannot read", () => {
    const log = parseReviewDraftLog({ lines });

    expect(log.events).toHaveLength(4);
    expect(log.skipped).toBe(2);
    expect(skippedReviewDraftNote({ skipped: log.skipped })).toContain("2 line(s)");
    expect(skippedReviewDraftNote({ skipped: 0 })).toBeUndefined();
  });

  it("reads a line as its own version wrote it, and passes over one with another version or an unknown field", () => {
    const dropped = { id: "rd-1", kind: "dropped", note: "n", tsIso: "2026-09-28T00:00:00.000Z" };
    const log = parseReviewDraftLog({
      lines: [
        JSON.stringify({ ...dropped, schemaVersion: 1 }),
        JSON.stringify({ ...dropped, schemaVersion: 2 }),
        JSON.stringify({ ...dropped, schemaVersion: 1, url: "https://x/review" }),
      ],
    });

    expect(log.events).toEqual([dropped]);
    expect(log.skipped).toBe(2);
  });

  it("folds newest first, resolves a posted row, and never invents a row from an orphan event", () => {
    const items = foldReviewDrafts({ events: parseReviewDraftLog({ lines }).events });

    expect(items.map((item) => [item.id, item.state])).toEqual([
      ["rd-2", "held"],
      ["rd-1", "posted"],
    ]);
    expect(items[1]?.outcome).toBe("https://x/review");
    expect(items[1]?.draft).toEqual(first);
  });

  it("keeps a posted row posted when a later parked line reuses its id", () => {
    const reused = parked({ id: "rd-1", over: { body: "another review" }, tsIso: "2026-09-28T04:00:00.000Z" });
    const reparked = reviewDraftEventLine({
      event: { draft: reused, id: "rd-1", kind: "parked", tsIso: reused.tsIso },
    });
    const items = foldReviewDrafts({ events: parseReviewDraftLog({ lines: [...lines, reparked] }).events });

    expect(items.find((item) => item.id === "rd-1")).toMatchObject({ draft: first, state: "posted" });
  });

  it("refuses a spent row where a post or drop needs a held one, and serves it to a read", () => {
    const items = foldReviewDrafts({ events: parseReviewDraftLog({ lines }).events });

    expect(reviewDraftById({ id: "rd-1", items, mustBeHeld: true })._unsafeUnwrapErr().code).toBe("REVIEW_DRAFT_SPENT");
    expect(reviewDraftById({ id: "rd-1", items, mustBeHeld: false })._unsafeUnwrap().state).toBe("posted");
    expect(reviewDraftById({ id: "rd-404", items, mustBeHeld: false })._unsafeUnwrapErr().code).toBe(
      "REVIEW_DRAFT_NOT_FOUND",
    );
  });
});
