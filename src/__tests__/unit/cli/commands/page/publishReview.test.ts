/*
 * The review half of `page publish`: no `--review` is refused unless the hatch is open, an open hatch publishes a
 * WAIVED record rather than a silent page, a false citation refuses with its own message, and a cut that moved
 * since its review needs `--review-changed`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pagePublishReview, readCitedPass } from "../../../../../cli/commands/page/publishReview.js";
import type { CodexArtifactRecord } from "../../../../../codex/types.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { PageReviewErrors } from "../../../../../pages/reviewErrors.js";
import type { PageReviewReads } from "../../../../../pages/reviewResolve.js";
import {
  FIXTURE_DIFF_SHA,
  FIXTURE_FRAGMENT_SHA,
  fixtureCodexRecord,
  fixturePreparation,
} from "../../../../pageReviewFixture.js";

const NOW = "2026-11-03T07:00:00.000Z";

/** Reads that know the given Codex passes and an empty fallback store. */
function reads({ passes = {} }: { passes?: Record<string, CodexArtifactRecord> }): PageReviewReads {
  return {
    commitFacts: () => ok({ diffSha256: FIXTURE_DIFF_SHA, fragmentSha256: FIXTURE_FRAGMENT_SHA }),
    readPass: ({ artifactId }) => ok(passes[artifactId]),
    readPreparation: () => ok(fixturePreparation()),
    scanFallback: async () =>
      ok({
        foreign: 0,
        foreignModes: [],
        foreignReceipts: [],
        unboundReceipts: [],
        pending: 0,
        pendingPlans: 0,
        planReceipts: [],
        problems: [],
        receipts: [],
        unreadable: 0,
      }),
  };
}

/** One decision over the given citations. */
function decide({
  reviewIds = [],
  reviewChanged,
  reviewWaived = false,
}: {
  reviewIds?: readonly string[];
  reviewChanged?: string;
  reviewWaived?: boolean;
}): ReturnType<typeof pagePublishReview> {
  return pagePublishReview({
    fragment: "<title>Queue</title><p>hi</p>",
    home: "/h",
    publishedAtIso: NOW,
    reads: reads({ passes: { "pass-1": fixtureCodexRecord() } }),
    reviewChanged,
    reviewIds,
    reviewWaived,
    slug: "queue",
  });
}

describe("pagePublishReview", () => {
  it("refuses a page citing no review with the unreviewed-page hatch's lines", async () => {
    const lines = unwrapErr(await decide({}));
    expect(lines[0]).toContain("slopweaver page publish blocked because the page cites no review");
    expect(lines[0]).toContain('("queue" was passed no --review)');
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_UNREVIEWED_PAGE=1");
  });

  it("publishes a WAIVED record under the open hatch, never a silent page", async () => {
    const record = unwrap(await decide({ reviewWaived: true }));
    expect(record).toMatchObject({ hatch: "unreviewed-page", slug: "queue", status: "waived" });
  });

  it("refuses a citation naming nothing even with the hatch open, since a false review is a fact", async () => {
    const lines = unwrapErr(await decide({ reviewIds: ["nope"], reviewWaived: true }));
    expect(lines).toStrictEqual([PageReviewErrors.reviewNotFound({ reviewId: "nope" }).message]);
  });

  it("needs --review-changed when the published bytes are not the reviewed cut", async () => {
    const lines = unwrapErr(await decide({ reviewIds: ["pass-1"] }));
    expect(lines[0]).toContain('--review-changed "<what you changed after the review>" is required');
  });

  it("records the review and what changed after it", async () => {
    const record = unwrap(await decide({ reviewChanged: "tightened the opening", reviewIds: ["pass-1"] }));
    expect(record).toMatchObject({ changedAfterReview: "tightened the opening", status: "reviewed" });
  });
});

describe("readCitedPass", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sw-cited-"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("answers no record for an id with no record file, so the fallback store is asked next", () => {
    expect(unwrap(readCitedPass({ artifactId: "pass-9", orchestrationRoot: root }))).toBe(undefined);
    expect(unwrap(readCitedPass({ artifactId: "../escape", orchestrationRoot: root }))).toBe(undefined);
  });

  it("refuses a record that is on disk but will not decode, rather than calling the pass absent", () => {
    mkdirSync(join(root, "pass-1"));
    writeFileSync(join(root, "pass-1", "record.json"), "{not json");
    expect(unwrapErr(readCitedPass({ artifactId: "pass-1", orchestrationRoot: root }))).toStrictEqual(
      PageReviewErrors.reviewUnreadable({ path: join(root, "pass-1", "record.json"), reviewId: "pass-1" }),
    );
  });
});
