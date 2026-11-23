/**
 * `tickNowLine` — the card says the reviewer round while one is open, and the worker's own line otherwise.
 * A real temp home, because "open" is a fact about the record and verdict files on disk.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tickNowLine } from "../../../../../cli/commands/turn/watchNowLine.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import { reviewPaths, writeReview } from "../../../../../live/turn/reviewStore.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const ASK = { channel: "C1", messageTs: "1789443736.519609", threadTs: "1789443736.519609" };
const NOW = "2026-09-15T04:40:00.000Z";
const ACTIVITY = {
  callsSoFar: 3,
  latest: { target: "slopweaver turn review --poll", tool: "Bash", tsIso: "2026-09-15T04:39:00.000Z" },
};

/** A home holding one review record for {@link ASK}, as `turn review` would have written it. */
function homeWithRecord({ releasedAt }: { releasedAt?: string }): { home: string; record: ReviewRecord } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-watch-now-"));
  dirs.push(home);
  const paths = reviewPaths({ askIdentity: ASK, home });
  const record: ReviewRecord = {
    ...ASK,
    answerDigest: "sha256:" + "a".repeat(64),
    answerPath: join(home, "answer.json"),
    authorSession: "author workspace workspace:1 (id-workspace:1)",
    carriedUnresolved: [],
    packetPath: paths.packet,
    ...(releasedAt === undefined ? {} : { releasedAt }),
    reviewStartedAt: "2026-09-15T04:00:00.000Z",
    reviewer: {
      host: "claude-code",
      surfaceId: "id-surface:9",
      surfaceRef: "surface:9",
      workspaceId: "id-workspace:9",
      workspaceRef: "workspace:9",
    },
    reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
    round: 2,
    schemaVersion: 2,
    spawnedAt: "2026-09-15T04:31:00.000Z",
    verdictPath: paths.verdict,
  };
  writeReview({ home, packet: "packet", record });
  return { home, record };
}

describe("tickNowLine", () => {
  it("shows the open reviewer round, its age and the whole review phase", () => {
    const { home } = homeWithRecord({});

    expect(tickNowLine({ activity: ACTIVITY, askIdentity: ASK, home, nowIso: NOW })).toBe(
      "now: still working, 57m · independent review, round 2 · open 9m · 40m in review so far",
    );
  });

  it("falls back to the worker's own line once the round's reviewer was released", () => {
    const { home } = homeWithRecord({ releasedAt: "2026-09-15T04:38:00.000Z" });

    expect(tickNowLine({ activity: ACTIVITY, askIdentity: ASK, home, nowIso: NOW })).toBe(
      "now: still working, 57m · getting a second opinion (started 1m ago) · 3 tool calls so far",
    );
  });

  it("falls back to the worker's own line once the reviewer's verdict is written", () => {
    const { home, record } = homeWithRecord({});
    writeFileSync(
      record.verdictPath,
      JSON.stringify({
        answerDigest: record.answerDigest,
        authorSession: record.authorSession,
        claims: [],
        outcome: "clean",
        reviewerSession: record.reviewerSession,
        schemaVersion: 1,
      }),
    );

    expect(tickNowLine({ activity: ACTIVITY, askIdentity: ASK, home, nowIso: NOW })).toBe(
      "now: still working, 57m · getting a second opinion (started 1m ago) · 3 tool calls so far",
    );
  });

  it("uses the worker's own line when no review was ever opened", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-watch-now-"));
    dirs.push(home);

    expect(tickNowLine({ activity: ACTIVITY, askIdentity: ASK, home, nowIso: NOW })).toBe(
      "now: still working, 57m · getting a second opinion (started 1m ago) · 3 tool calls so far",
    );
  });
});
