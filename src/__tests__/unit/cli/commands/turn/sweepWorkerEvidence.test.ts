/**
 * `readyWorkerAlivePastLease` — the one liveness read a `ready` answer gets, and only once its lease has run
 * out. The check is a plain fake that records every workspace it was asked about, so each case pins both the
 * answer and whether cmux would have been reached at all.
 */
import { describe, expect, it } from "vitest";

import { readyWorkerAlivePastLease } from "../../../../../cli/commands/turn/sweepWorkerEvidence.js";
import type { WorkspaceLiveness } from "../../../../../cmux/liveness.js";
import type { DispatchedEvent } from "../../../../../live/ask/lifecycle.js";
import { dispatchIdOf, type FreshDispatchRecord } from "../../../../../live/turn/dispatch.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

const RECORD: FreshDispatchRecord = {
  ...ASK,
  askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
  briefPath: "/tmp/brief.json",
  decision: {
    confidence: "high",
    needs: [],
    rationale: "a live investigation is needed",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "none",
  },
  dispatchId: dispatchIdOf({ askIdentity: ASK }),
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt: "2026-08-12T02:00:00.000Z",
  schemaVersion: 3,
  session: {
    host: "claude-code",
    surfaceId: "id-surface:1",
    surfaceRef: "surface:1",
    workspaceId: "id-workspace:1",
    workspaceRef: "workspace:1",
  },
};

const DISPATCHED: DispatchedEvent = {
  ...ASK,
  decision: RECORD.decision,
  kind: "dispatched",
  leaseExpiresAt: RECORD.leaseExpiresAt,
  tier: "fresh-visible-session",
  tsIso: "2026-08-12T00:00:00.000Z",
};

const READY_READ = {
  record: RECORD,
  screen: "",
  truth: { answerPath: "/tmp/answer.json", dispatchId: RECORD.dispatchId, kind: "ready" },
} as const;

/** A liveness fake answering `kind` and recording every workspace it was asked about. */
function livenessAnswering({ kind, asked }: { kind: "alive" | "unknown"; asked: string[] }) {
  return ({ workspaceId }: { workspaceId: string }): Promise<WorkspaceLiveness> => {
    asked.push(workspaceId);
    if (kind === "alive") {
      return Promise.resolve({ kind, pid: 42, process: "claude", workspaceId });
    }
    return Promise.resolve({ kind, reason: "a unit test's answer", workspaceId });
  };
}

describe("readyWorkerAlivePastLease", () => {
  it("is true for a ready answer past its lease whose worker cmux reports alive", async () => {
    const asked: string[] = [];
    const alive = await readyWorkerAlivePastLease({
      deps: { workerLiveness: livenessAnswering({ asked, kind: "alive" }) },
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      read: READY_READ,
    });
    expect(alive).toBe(true);
    expect(asked).toEqual(["id-workspace:1"]);
  });

  it("is false when the liveness check could not tell — unknown is no evidence anyone is left", async () => {
    const asked: string[] = [];
    const alive = await readyWorkerAlivePastLease({
      deps: { workerLiveness: livenessAnswering({ asked, kind: "unknown" }) },
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      read: READY_READ,
    });
    expect(alive).toBe(false);
    expect(asked).toEqual(["id-workspace:1"]);
  });

  it("never asks cmux for a ready answer still inside its lease", async () => {
    const asked: string[] = [];
    const alive = await readyWorkerAlivePastLease({
      deps: { workerLiveness: livenessAnswering({ asked, kind: "alive" }) },
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T01:00:00.000Z",
      read: READY_READ,
    });
    expect(alive).toBe(false);
    expect(asked).toEqual([]);
  });

  it("never asks cmux for a working screen, even past the lease", async () => {
    const asked: string[] = [];
    const alive = await readyWorkerAlivePastLease({
      deps: { workerLiveness: livenessAnswering({ asked, kind: "alive" }) },
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      read: { record: RECORD, screen: "still going", truth: { kind: "working" } },
    });
    expect(alive).toBe(false);
    expect(asked).toEqual([]);
  });
});
