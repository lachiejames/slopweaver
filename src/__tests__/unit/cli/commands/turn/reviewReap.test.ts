/**
 * Releasing a reviewer, over a temp home's real review record and session ledger with a recording closer and
 * clock in place of cmux and the wall clock: the closer is handed exactly the reviewer's workspace id BEFORE the
 * clock is read; a close cmux refused is returned unchanged while the record is still stamped and the ledger row
 * still retired; with nothing to close the closer is never called and both writes still happen; and the
 * ledger's `closed` event names only this round's workspace, so an earlier round's row under the same session
 * key stays open.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ReviewerReleaseNow,
  type ReviewerWorkspaceCloser,
  releaseReviewerWorkspace,
} from "../../../../../cli/commands/turn/reviewReap.js";
import type { ReviewRecord } from "../../../../../live/turn/review.js";
import { readReviewRecord, writeReview } from "../../../../../live/turn/reviewStore.js";
import { foldSessions, parseSessionLog, type SessionEvent } from "../../../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../../../sessions/sessionStore.js";

const RELEASED_AT = "2026-10-01T12:00:00.000Z";
const SESSION_KEY = "review-C0SYNREVIEW1-1789000000.000100";

const RECORD: ReviewRecord = {
  answerDigest: "digest-1",
  answerPath: "/answers/answer.md",
  authorSession: "worker-session",
  carriedUnresolved: [],
  channel: "C0SYNREVIEW1",
  messageTs: "1789000000.000100",
  packetPath: "/reviews/packet.md",
  reviewer: {
    host: "claude-code",
    surfaceId: "surface-id-2",
    surfaceRef: "surface:2",
    workspaceId: "workspace-id-2",
    workspaceRef: "workspace:2",
  },
  reviewerSession: "reviewer-session",
  round: 2,
  schemaVersion: 2,
  spawnedAt: "2026-10-01T11:00:00.000Z",
  threadTs: "1789000000.000100",
  verdictPath: "/reviews/verdict.json",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "review-reap-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A closer answering one fixed result, tracing each call. */
function tracingCloser({ trace, answer }: { trace: string[]; answer: string | undefined }): ReviewerWorkspaceCloser {
  return async ({ workspaceId }) => {
    trace.push(`close ${workspaceId}`);
    return answer;
  };
}

/** A clock answering the fixed release instant, tracing each read. */
function tracingClock({ trace }: { trace: string[] }): ReviewerReleaseNow {
  return () => {
    trace.push("clock");
    return RELEASED_AT;
  };
}

/** The ledger's events as they now stand on disk. */
function ledgerEvents(): readonly SessionEvent[] {
  return parseSessionLog({ text: readSessionLogText({ home }) }).events;
}

describe("releaseReviewerWorkspace", () => {
  it("closes exactly the reviewer's workspace, then reads the clock, then stamps the record and retires the row", async () => {
    const trace: string[] = [];
    writeReview({ home, packet: "the packet", record: RECORD });

    const failure = await releaseReviewerWorkspace({
      closeReviewer: tracingCloser({ answer: undefined, trace }),
      closeWorkspace: true,
      home,
      nowIso: tracingClock({ trace }),
      record: RECORD,
    });

    expect(failure).toBeUndefined();
    expect(trace).toEqual(["close workspace-id-2", "clock"]);
    expect(readReviewRecord({ askIdentity: RECORD, home })).toEqual({ ...RECORD, releasedAt: RELEASED_AT });
    expect(ledgerEvents()).toEqual([
      { kind: "closed", sessionKey: SESSION_KEY, tsIso: RELEASED_AT, workspaceRef: "workspace:2" },
    ]);
  });

  it("returns a close cmux refused unchanged, and still stamps the record and retires the row", async () => {
    const trace: string[] = [];
    writeReview({ home, packet: "the packet", record: RECORD });

    const failure = await releaseReviewerWorkspace({
      closeReviewer: tracingCloser({ answer: "workspace not found", trace }),
      closeWorkspace: true,
      home,
      nowIso: tracingClock({ trace }),
      record: RECORD,
    });

    expect(failure).toBe("workspace not found");
    expect(trace).toEqual(["close workspace-id-2", "clock"]);
    expect(readReviewRecord({ askIdentity: RECORD, home })).toEqual({ ...RECORD, releasedAt: RELEASED_AT });
    expect(ledgerEvents()).toEqual([
      { kind: "closed", sessionKey: SESSION_KEY, tsIso: RELEASED_AT, workspaceRef: "workspace:2" },
    ]);
  });

  it("never calls the closer when there is no workspace to close, and still stamps and retires", async () => {
    const trace: string[] = [];
    writeReview({ home, packet: "the packet", record: RECORD });

    const failure = await releaseReviewerWorkspace({
      closeReviewer: tracingCloser({ answer: "must not be reached", trace }),
      closeWorkspace: false,
      home,
      nowIso: tracingClock({ trace }),
      record: RECORD,
    });

    expect(failure).toBeUndefined();
    expect(trace).toEqual(["clock"]);
    expect(readReviewRecord({ askIdentity: RECORD, home })).toEqual({ ...RECORD, releasedAt: RELEASED_AT });
    expect(ledgerEvents()).toEqual([
      { kind: "closed", sessionKey: SESSION_KEY, tsIso: RELEASED_AT, workspaceRef: "workspace:2" },
    ]);
  });

  it("retires only this round's workspace, leaving an earlier round's row under the same key open", async () => {
    const spawned = ({ workspaceRef, tsIso }: { workspaceRef: string; tsIso: string }): SessionEvent => ({
      branch: "main",
      cwd: "/checkout",
      kind: "spawned",
      sessionKey: SESSION_KEY,
      surfaceRef: "surface:1",
      tsIso,
      workspaceRef,
    });
    appendSessionEvent({ event: spawned({ tsIso: "2026-10-01T10:00:00.000Z", workspaceRef: "workspace:1" }), home });
    appendSessionEvent({ event: spawned({ tsIso: "2026-10-01T11:00:00.000Z", workspaceRef: "workspace:2" }), home });
    writeReview({ home, packet: "the packet", record: RECORD });

    await releaseReviewerWorkspace({
      closeReviewer: tracingCloser({ answer: undefined, trace: [] }),
      closeWorkspace: true,
      home,
      nowIso: tracingClock({ trace: [] }),
      record: RECORD,
    });

    expect(foldSessions({ events: ledgerEvents() }).map((session) => [session.workspaceRef, session.status])).toEqual([
      ["workspace:2", "closed"],
      ["workspace:1", "open"],
    ]);
  });

  it("writes no record when the review was never opened, though the row is still retired", async () => {
    const failure = await releaseReviewerWorkspace({
      closeReviewer: tracingCloser({ answer: undefined, trace: [] }),
      closeWorkspace: false,
      home,
      nowIso: tracingClock({ trace: [] }),
      record: RECORD,
    });

    expect(failure).toBeUndefined();
    expect(readReviewRecord({ askIdentity: RECORD, home })).toBeUndefined();
    expect(ledgerEvents()).toEqual([
      { kind: "closed", sessionKey: SESSION_KEY, tsIso: RELEASED_AT, workspaceRef: "workspace:2" },
    ]);
  });
});
