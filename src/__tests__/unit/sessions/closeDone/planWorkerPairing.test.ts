/**
 * How much latitude the done-chat sweep gives a dispatch row when pairing it, and how it tells a reviewer's own
 * worker apart: by its workspace name across a renumber, never by a doc-backed slug, never from another
 * checkout. Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../../cmux/client.js";
import { dispatchSessionName } from "../../../../cmux/planNames.js";
import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { planCloseDone } from "../../../../sessions/closeDone.js";
import type { SessionItem } from "../../../../sessions/session.js";
import { workspace } from "../../cli/commands/session/closeDoneHarness.js";
import { always, never } from "../closeDonePlanFixtures.js";
import { ASK, captured, dispatched, NO_REVIEW, NOW, REVIEW_KEY, WORKER_KEY, WORKER_NAME } from "../dispatchFixtures.js";
import { childRow, childWorkspace, noStanding, planChildren } from "./children.js";

describe("planCloseDone pairing latitude", () => {
  it("refuses to pair a dispatch row that names no worktree, however exact its ref", () => {
    // A row with no cwd fell through the worktree half of the exact match, leaving
    // the ref as the only evidence — and a re-issued `workspace:N` is what this pairing exists not to trust.
    const rootless: SessionItem = {
      lastEventIso: "2026-09-03T07:02:00.000Z",
      sessionKey: dispatchSessionName({ askChannel: ASK.channel, askMessageTs: ASK.messageTs, role: "review" }),
      spawnedIso: "2026-09-03T07:02:00.000Z",
      status: "open",
      workspaceRef: "workspace:9",
    };
    const elsewhere = childWorkspace({ currentDirectory: "/unrelated/worktree" });
    const answered: AskLifecycleEvent = {
      ...ASK,
      answerTs: "1789046999.1",
      kind: "answered",
      tsIso: "2026-09-03T08:00:00.000Z",
    };
    const plan = planCloseDone({
      askEvents: [captured(), answered],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [rootless],
      workspaces: [elsewhere],
    });
    expect(plan).toEqual([{ kind: "drifted", row: rootless, workspaceRef: "workspace:9" }]);
  });

  it("still pairs a SLUG-BACKED row that names no worktree on its ref alone, as it always has", () => {
    const rootless: SessionItem = {
      lastEventIso: "2026-09-03T07:02:00.000Z",
      sessionKey: "a-doc",
      slug: "a-doc",
      spawnedIso: "2026-09-03T07:02:00.000Z",
      status: "open",
      workspaceRef: "workspace:1",
    };
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [rootless],
      workspaces: [workspace()],
    });
    expect(plan).toEqual([
      { evidence: { kind: "run-closed" }, kind: "candidate", row: rootless, workspace: workspace() },
    ]);
  });
});

describe("planCloseDone worker liveness", () => {
  const LEASE_LIVE = "2026-09-03T11:00:00.000Z";

  /** The worker's live workspace, under whatever ref cmux happens to be issuing today. */
  function workerWorkspace({ workspaceRef }: { workspaceRef: string }): CmuxWorkspaceSummary {
    return childWorkspace({
      description: `spawned session · ${WORKER_NAME}`,
      title: "ask: why did staging exhaust",
      workspaceId: `id-${workspaceRef}`,
      workspaceRef,
    });
  }

  it("keeps a reviewer whose worker cmux has RENUMBERED past — a live worker is not a gone one", () => {
    // A dispatch row pairs on its exact ref or not at all, so a renumbered worker row
    // goes unpaired while running perfectly well. Reading "unpaired" as "gone" reaped this reviewer mid-turn,
    // with no terminal event and an hour of lease left. The worker's WORKSPACE NAME survives a renumber.
    const askEvents = [captured(), dispatched({ leaseExpiresAt: LEASE_LIVE })];
    const staleWorker = childRow({ sessionKey: WORKER_KEY, workspaceRef: "workspace:1010" });
    const plan = planChildren({
      askEvents,
      rows: [staleWorker, childRow()],
      workspaces: [workerWorkspace({ workspaceRef: "workspace:19" }), childWorkspace()],
    });
    expect(plan).toEqual([
      { kind: "drifted", row: staleWorker, workspaceRef: "workspace:1010" },
      { kind: "kept", reason: "dispatch-open", row: childRow() },
    ]);
  });

  it("still reads a worker whose workspace names nothing live as gone", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: LEASE_LIVE })];
    const worker = childRow({ sessionKey: WORKER_KEY, workspaceRef: "workspace:8" });
    const plan = planChildren({ askEvents, rows: [worker, childRow()], workspaces: [childWorkspace()] });
    expect(plan).toEqual([
      { kind: "drifted", row: worker, workspaceRef: "workspace:8" },
      { evidence: { kind: "parent-worker-gone" }, kind: "candidate", row: childRow(), workspace: childWorkspace() },
    ]);
  });
});

describe("planCloseDone worker identity", () => {
  it("never reads a doc-backed row as the worker, however its slug reads", () => {
    // `dispatchSessionName`'s output is a legal handover slug, so a doc named after
    // one would fabricate a worker row — and `gone` for a worker the ask never had — reaping a live reviewer
    // of a turn with an hour of lease left.
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T11:00:00.000Z" })];
    const impostor: SessionItem = {
      cwd: "/w/.claude/worktrees/ask-doc",
      lastEventIso: "2026-09-03T07:02:00.000Z",
      sessionKey: WORKER_KEY,
      slug: WORKER_KEY,
      spawnedIso: "2026-09-03T07:02:00.000Z",
      status: "open",
      workspaceRef: "workspace:8",
    };
    const plan = planCloseDone({
      askEvents,
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [impostor, childRow()],
      workspaces: [childWorkspace()],
    });
    expect(plan).toEqual([
      { kind: "drifted", row: impostor, workspaceRef: "workspace:8" },
      { kind: "kept", reason: "dispatch-open", row: childRow() },
    ]);
  });
});

describe("planCloseDone worker checkout", () => {
  it("never reads a worker row from another checkout as this ask's worker", () => {
    // Two asks whose channels differ only past SESSION_NAME_MAX_LENGTH share one
    // truncated worker key, and one of them missing from the fold hides the collision. A worker and its
    // reviewer always share `repoRoot`, so the checkout is the second factor that tells them apart.
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T11:00:00.000Z" })];
    const foreignWorker = childRow({ cwd: "/w/.claude/worktrees/other-loop", sessionKey: WORKER_KEY });
    const plan = planChildren({
      askEvents,
      rows: [foreignWorker, childRow()],
      workspaces: [childWorkspace()],
    });
    expect(plan).toEqual([
      { kind: "drifted", row: foreignWorker, workspaceRef: "workspace:9" },
      { kind: "kept", reason: "dispatch-open", row: childRow() },
    ]);
  });

  it("keeps a reviewer whose own row names no checkout, since nothing can then match its worker", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T11:00:00.000Z" })];
    const worker = childRow({ sessionKey: WORKER_KEY, workspaceRef: "workspace:8" });
    const rootlessReviewer: SessionItem = {
      lastEventIso: "2026-09-03T07:02:00.000Z",
      sessionKey: REVIEW_KEY,
      spawnedIso: "2026-09-03T07:02:00.000Z",
      status: "open",
      workspaceRef: "workspace:9",
    };
    const plan = planChildren({ askEvents, rows: [worker, rootlessReviewer], workspaces: [childWorkspace()] });
    expect(plan).toEqual([
      { kind: "drifted", row: worker, workspaceRef: "workspace:8" },
      { kind: "drifted", row: rootlessReviewer, workspaceRef: "workspace:9" },
    ]);
  });
});
