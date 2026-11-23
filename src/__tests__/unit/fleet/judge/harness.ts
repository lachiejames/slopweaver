/**
 * The fixtures every `judgeFleet` test file shares: the chair's and the worker's session ids, a live session on a
 * plan's token, the evidence for a healthy two-seat fleet, a journal folded into what the judge reads, and an
 * attempt that held a worker as a crash loop. Pure data; nothing here touches a disk or a provider.
 */
import type { FleetEvidence, FleetLiveSession } from "../../../../fleet/evidence.js";
import { type FleetJournalEvent, foldNewestAttempt, reorientationsBySession } from "../../../../fleet/journal.js";

/** The supervisor's session id. */
export const CHAIR = "a0000006-0000-4000-8000-000000000007";
/** The one worker's session id. */
export const WORKER = "a0000008-0000-4000-8000-000000000009";
const STARTED_MS = Date.parse("2026-10-04T05:00:00.000Z");

/**
 * A live session on a plan's token, running a p1 row.
 *
 * @returns the worker session with each override applied
 */
export function session(over: Partial<FleetLiveSession> = {}): FleetLiveSession {
  return {
    boot: { alias: "plan-one", kind: "token" },
    cwd: "/wt/a",
    row: { id: "a-row", priority: "p1", title: "A row" },
    sessionId: WORKER,
    startedAtMs: STARTED_MS,
    workspaceRef: "workspace:2",
    ...over,
  };
}

/**
 * Evidence for a healthy two-seat fleet whose chair reoriented after it started.
 *
 * @returns the healthy fleet's evidence with each override applied
 */
export function evidence(over: Partial<FleetEvidence> = {}): FleetEvidence {
  return {
    accounts: { emailFor: ({ alias }) => (alias === "plan-one" ? "one@example.com" : undefined) },
    attempt: undefined,
    attemptRunning: false,
    chairPinnedAtIso: "2026-10-04T04:00:00.000Z",
    chairSessionId: CHAIR,
    chairWorkspaceRef: "workspace:1",
    chairSweep: { kind: "none" },
    cmux: { kind: "answering" },
    config: { capacity: 6, schemaVersion: 1 },
    console: { port: 4321, state: "serving" },
    keepAlive: { detail: "Watching.", live: true },
    loop: { detail: "Listening for Slack.", live: true },
    nowIso: "2026-10-04T05:10:00.000Z",
    reorientations: new Map([[CHAIR, "2026-10-04T05:01:00.000Z"]]),
    sessions: [session({ row: undefined, sessionId: CHAIR, workspaceRef: "workspace:1" }), session()],
    signedOutStores: new Set(),
    ...over,
  };
}

/**
 * Fold a journal into the attempt and reorientations the judge reads.
 *
 * @returns the newest attempt and each session's reorientation, ready to spread into `evidence`
 */
export function journalled({
  events,
}: {
  events: readonly FleetJournalEvent[];
}): Pick<FleetEvidence, "attempt" | "reorientations"> {
  return { attempt: foldNewestAttempt({ events }), reorientations: reorientationsBySession({ events }) };
}

/**
 * An attempt that held the worker on `workspace:2` as a crash loop, finished or still running, its chair caught up.
 *
 * @param finished whether the journal closes the attempt with a deferred outcome
 * @returns the journal lines that attempt wrote
 */
export function crashLoopHeld({ finished }: { finished: boolean }): FleetJournalEvent[] {
  const base = { attemptId: "att", schemaVersion: 1 as const };
  const events: FleetJournalEvent[] = [
    { ...base, atIso: "2026-10-04T05:00:01.000Z", episodeId: "ep", kind: "attempt-started", pid: 42 },
    { ...base, atIso: "2026-10-04T05:01:00.000Z", chairSessionId: CHAIR, kind: "chair-reoriented" },
    {
      ...base,
      atIso: "2026-10-04T05:00:09.000Z",
      kind: "seat",
      phase: "held",
      refusal: { code: "CRASH_LOOP", message: "relaunched 3 times", workspaceRef: "workspace:2" },
      role: "worker",
      workspaceRef: "workspace:2",
    },
  ];
  if (finished) {
    events.push({ ...base, atIso: "2026-10-04T05:00:10.000Z", kind: "attempt-finished", outcome: "deferred" });
  }
  return events;
}
