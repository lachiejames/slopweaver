/**
 * The sweep's reviewer arm over a real state home — the half that was once missing, when
 * `turn dispatch --sweep` settled all three stranded WORKER pickups against cmux's own delivery record and
 * reconciled the stranded reviewer with nothing at all.
 *
 * The record round-trips through the real `writeReview`, so what is under test is the shipped read path
 * rather than a restatement of it. Only the two cmux effects are faked, and they are plain injected
 * functions, never `vi.fn`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ReviewerResubmitOutcome,
  type ReviewerSurfaceRead,
  reconcileStrandedReviewer,
  reviewerPickupOf,
} from "../../../../../cli/commands/turn/reviewSurface.js";
import { type ReviewRecord } from "../../../../../live/turn/review.js";
import { markReviewerReleased, reviewPaths, writeReview } from "../../../../../live/turn/reviewStore.js";

const REVIEWER = {
  host: "claude-code" as const,
  surfaceId: "id-surface:987",
  surfaceRef: "surface:987",
  workspaceId: "id-workspace:987",
  workspaceRef: "workspace:987",
};

const ASK = { channel: "C1", messageTs: "1788325215.000100", threadTs: "1788325215.000100" };

const SPAWNED_AT = "2026-09-02T05:00:00.000Z";

/** Fourteen minutes after the spawn — the exact wait the incident's reviewer sat through. */
const NOW = "2026-09-02T05:14:00.000Z";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home carrying one opened review, written through the real store. */
function homeWithReview(): { readonly home: string; readonly record: ReviewRecord } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-review-surface-"));
  homes.push(home);
  const paths = reviewPaths({ askIdentity: ASK, home });
  const record: ReviewRecord = {
    answerDigest: `sha256:${"a".repeat(64)}`,
    answerPath: join(home, "answer.json"),
    authorSession: "author workspace workspace:1 (id-workspace:1)",
    carriedUnresolved: [],
    channel: "C1",
    messageTs: "1788325215.000100",
    packetPath: paths.packet,
    reviewer: REVIEWER,
    reviewerSession: "reviewer workspace workspace:987 (id-workspace:987)",
    round: 1,
    schemaVersion: 2,
    spawnedAt: SPAWNED_AT,
    threadTs: "1788325215.000100",
    verdictPath: paths.verdict,
  };
  writeReview({ home, packet: "packet", record });
  return { home, record };
}

/** The screen a stranded reviewer renders: its pickup typed into an idle box. */
function typedScreen({ record }: { record: ReviewRecord }): string {
  return `╭────╮\n│ > ${reviewerPickupOf({ record })}\n╰────╮\n  ? for shortcuts`;
}

/** One run of the arm, recording what it wrote and whether the Enter was asked for. */
async function runArm({
  home,
  read,
  nowIso = NOW,
}: {
  home: string;
  read: ReviewerSurfaceRead;
  nowIso?: string;
}): Promise<{ readonly lines: readonly string[]; readonly submitted: number }> {
  const lines: string[] = [];
  let submitted = 0;
  const outcome: ReviewerResubmitOutcome = { kind: "submitted", reason: "typed and unsent" };
  await reconcileStrandedReviewer({
    askIdentity: ASK,
    deps: {
      resubmitPickup: () => {
        submitted += 1;
        return Promise.resolve(outcome);
      },
      reviewerSurface: () => Promise.resolve(read),
    },
    home,
    nowIso,
    writeLine: ({ line }) => {
      lines.push(line);
    },
  });
  return { lines, submitted };
}

describe("reconcileStrandedReviewer", () => {
  it("re-submits and reports a reviewer whose row carries no submitted field", async () => {
    const { home, record } = homeWithReview();
    const run = await runArm({
      home,
      read: { delivery: { kind: "none" }, screen: typedScreen({ record }) },
    });
    expect(run.submitted).toBe(1);
    expect(run.lines).toStrictEqual([
      "reviewer-delivery-unwitnessed: C1/1788325215.000100 — cmux holds no record of anything submitted to " +
        "workspace:987 in 14m, which is a doubt and not proof it never started; re-submit submitted (typed and unsent)",
    ]);
  });

  it("does nothing at all once the row carries a corroborated delivery", async () => {
    const { home, record } = homeWithReview();
    const run = await runArm({
      home,
      read: {
        delivery: { kind: "confirmed", submittedAtIso: "2026-09-02T05:00:04.000Z" },
        screen: typedScreen({ record }),
      },
    });
    expect(run.submitted).toBe(0);
    expect(run.lines).toStrictEqual([]);
  });

  it("does nothing inside the bound, so a reviewer that just booted is left alone", async () => {
    const { home, record } = homeWithReview();
    const run = await runArm({
      home,
      nowIso: "2026-09-02T05:00:30.000Z",
      read: { delivery: { kind: "none" }, screen: typedScreen({ record }) },
    });
    expect(run.submitted).toBe(0);
    expect(run.lines).toStrictEqual([]);
  });

  it("does nothing when this reviewer's own verdict is already on disk", async () => {
    const { home, record } = homeWithReview();
    writeFileSync(
      record.verdictPath,
      `${JSON.stringify({
        answerDigest: record.answerDigest,
        authorSession: record.authorSession,
        claims: [],
        outcome: "clean",
        reviewerSession: record.reviewerSession,
        schemaVersion: 1,
      })}\n`,
      "utf8",
    );
    const run = await runArm({ home, read: { delivery: { kind: "none" }, screen: typedScreen({ record }) } });
    expect(run.submitted).toBe(0);
    expect(run.lines).toStrictEqual([]);
  });

  it("does nothing for a reviewer that has already been released", async () => {
    const { home, record } = homeWithReview();
    markReviewerReleased({ atIso: "2026-09-02T05:02:00.000Z", home, record });
    const run = await runArm({ home, read: { delivery: { kind: "none" }, screen: typedScreen({ record }) } });
    expect(run.submitted).toBe(0);
    expect(run.lines).toStrictEqual([]);
  });

  it("does nothing for an ask that never opened a review", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-review-surface-"));
    homes.push(home);
    const run = await runArm({ home, read: { delivery: { kind: "none" }, screen: undefined } });
    expect(run.submitted).toBe(0);
    expect(run.lines).toStrictEqual([]);
  });

  it("still reports the stall when the re-submit itself holds — the report is not conditional on acting", async () => {
    const { home } = homeWithReview();
    const lines: string[] = [];
    await reconcileStrandedReviewer({
      askIdentity: ASK,
      deps: {
        resubmitPickup: () => Promise.resolve({ kind: "held" as const, reason: "the screen could not be read" }),
        reviewerSurface: () => Promise.resolve({ delivery: { kind: "none" as const }, screen: undefined }),
      },
      home,
      nowIso: NOW,
      writeLine: ({ line }) => {
        lines.push(line);
      },
    });
    expect(lines).toStrictEqual([
      "reviewer-delivery-unwitnessed: C1/1788325215.000100 — cmux holds no record of anything submitted to " +
        "workspace:987 in 14m, which is a doubt and not proof it never started; re-submit held (the screen could not be read)",
    ]);
  });
});
