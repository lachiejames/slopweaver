/**
 * What the sweep says about an ask a live worker is still holding — the worker line, the reviewer half of it,
 * and the guarantee that an ask with no progress card never reaches Slack.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { reportStillWorking } from "../../../../../cli/commands/turn/sweepStillWorking.js";
import type { AskLifecycle } from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, capturedAskFor, ensureCapturedAskLifecycle } from "../../../../../live/ask/store.js";
import { dispatchIdOf, type FreshDispatchRecord } from "../../../../../live/turn/dispatch.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import { reviewPaths, writeReview } from "../../../../../live/turn/reviewStore.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
const NOW = "2026-10-02T01:00:00.000Z";

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home holding one dispatched ask, plus the folded entry the sweep would hold for it. */
function dispatchedAsk({ firstAnswered = false }: { firstAnswered?: boolean } = {}): {
  readonly entry: AskLifecycle;
  readonly home: string;
} {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-sweep-still-working-"));
  fixtureDirs.push(home);
  ensureCapturedAskLifecycle({ askIdentity: ASK, home, surface: "channel", userId: "U0OWNER" });
  appendAskLifecycleEvent({
    event: {
      ...ASK,
      decision: DECISION,
      kind: "dispatched",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      tier: "fresh-visible-session",
      tsIso: "2026-10-02T00:00:00.000Z",
    },
    home,
  });
  if (firstAnswered) {
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        answerDigest: `sha256:${"a".repeat(64)}`,
        answerTs: "1785000100.000200",
        kind: "first-answered",
        leaseExpiresAt: "2099-01-02T00:00:00.000Z",
        owes: "pull-requests",
        tsIso: "2026-10-02T00:30:00.000Z",
        what: "open the PR",
      },
      home,
    });
  }
  return { entry: capturedAskFor({ channel: ASK.channel, home, messageTs: ASK.messageTs })!, home };
}

/** The live screen read the sweep hands over, over a worker the caller names. */
function liveRead({
  home,
  sessionName,
}: {
  home: string;
  sessionName?: string;
}): Parameters<typeof reportStillWorking>[0]["read"] {
  const record: FreshDispatchRecord = {
    ...ASK,
    askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
    briefPath: join(home, "brief.json"),
    decision: DECISION,
    dispatchId: dispatchIdOf({ askIdentity: ASK }),
    execution: { mode: "single-turn", supervisorHost: "claude-code" },
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    schemaVersion: 3,
    session: {
      host: "claude-code",
      ...(sessionName === undefined ? {} : { sessionName }),
      surfaceId: "id-surface:1",
      surfaceRef: "surface:1",
      workspaceId: "id-workspace:1",
      workspaceRef: "workspace:1",
    },
  };
  return { record, screen: "", truth: { kind: "working" } };
}

/** Run the report and hand back every line it wrote, plus how many courtesy updates failed. */
async function run({
  entry,
  home,
  sessionName,
}: {
  entry: AskLifecycle;
  home: string;
  sessionName?: string;
}): Promise<{ readonly failedUpdates: number; readonly lines: readonly string[] }> {
  const lines: string[] = [];
  let failedUpdates = 0;
  await reportStillWorking({
    deps: {
      processSnapshot: () => ({ kind: "rows", rows: [] }),
      writeLine: ({ line }) => {
        lines.push(line);
      },
    },
    entry,
    home,
    nowIso: NOW,
    onChecklistUpdateFailed: () => {
      failedUpdates += 1;
    },
    read: liveRead({ home, ...(sessionName === undefined ? {} : { sessionName }) }),
  });
  return { failedUpdates, lines };
}

describe("reportStillWorking", () => {
  it("names the worker and says no reviewer is open, saying a record predating named workers is unnamed", async () => {
    const { entry, home } = dispatchedAsk();

    const { lines } = await run({ entry, home });

    expect(lines[0]).toBe(
      "still working: C1/1785000000.000100 — worker (unnamed — this record predates named workers) (workspace:1); no reviewer open",
    );
  });

  it("addresses a named worker by name", async () => {
    const { entry, home } = dispatchedAsk();

    const { lines } = await run({ entry, home, sessionName: "answer-c1-1785" });

    expect(lines[0]).toBe(
      "still working: C1/1785000000.000100 — worker answer-c1-1785 (workspace:1); no reviewer open",
    );
  });

  it("reports an ask whose FIRST answer stands as still working, exactly like any live worker", async () => {
    const { entry, home } = dispatchedAsk({ firstAnswered: true });

    const { lines } = await run({ entry, home, sessionName: "answer-c1-1785" });

    expect(lines[0]).toBe(
      "still working: C1/1785000000.000100 — worker answer-c1-1785 (workspace:1); no reviewer open",
    );
  });

  it("names an open reviewer and tells the caller never to message it while its verdict is unwritten", async () => {
    const { entry, home } = dispatchedAsk();
    const paths = reviewPaths({ askIdentity: ASK, home });
    const record: ReviewRecord = {
      ...ASK,
      answerDigest: `sha256:${"a".repeat(64)}`,
      answerPath: join(home, "answer.json"),
      authorSession: "author workspace workspace:1 (id-workspace:1)",
      carriedUnresolved: [],
      packetPath: paths.packet,
      reviewer: {
        host: "claude-code",
        sessionName: "review-c1-1785",
        surfaceId: "id-surface:9",
        surfaceRef: "surface:9",
        workspaceId: "id-workspace:9",
        workspaceRef: "workspace:9",
      },
      reviewerSession: "reviewer workspace workspace:9 (id-workspace:9)",
      round: 1,
      schemaVersion: 2,
      spawnedAt: "2026-10-02T00:40:00.000Z",
      verdictPath: paths.verdict,
    };
    writeReview({ home, packet: "packet", record });

    const { lines } = await run({ entry, home, sessionName: "answer-c1-1785" });

    expect(lines[0]).toBe(
      "still working: C1/1785000000.000100 — worker answer-c1-1785 (workspace:1); " +
        "reviewer review-c1-1785 (workspace:9) — mid-verdict, never message it",
    );
  });

  it("pushes nothing to Slack for an ask with no progress card, and counts no failed update", async () => {
    const { entry, home } = dispatchedAsk();

    const { failedUpdates } = await run({ entry, home });

    expect(failedUpdates).toBe(0);
  });
});
