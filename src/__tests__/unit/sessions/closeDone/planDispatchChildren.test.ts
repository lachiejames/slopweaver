/**
 * How the done-chat sweep plans the bot loop's dispatch children: reaped on a finalised turn, an expired parent
 * lease or a gone worker; kept while their turn runs, while a reviewer is mid-verdict, or when cmux re-issued
 * their ref to another dispatch. Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { BOOTING_GRACE_MS, planCloseDone } from "../../../../sessions/closeDone.js";
import { type CloseDoneOutcome, renderCloseDoneOutcome } from "../../../../sessions/closeDoneOutcome.js";
import type { SessionItem } from "../../../../sessions/session.js";
import { always, never } from "../closeDonePlanFixtures.js";
import { ASK, captured, dispatched, NO_REVIEW, NOW, reviewing, WORKER_KEY, WORKER_NAME } from "../dispatchFixtures.js";
import { childRow, childWorkspace, LOOP_CWD, noStanding, planChildren } from "./children.js";

describe("planCloseDone over dispatch children", () => {
  const ANSWERED: AskLifecycleEvent = {
    ...ASK,
    answerTs: "1789046999.1",
    kind: "answered",
    tsIso: "2026-09-03T08:00:00.000Z",
  };

  it("makes a review child of an answered ask a candidate", () => {
    const plan = planChildren({
      askEvents: [captured(), ANSWERED],
      rows: [childRow()],
      workspaces: [childWorkspace()],
    });
    expect(plan).toEqual([
      {
        evidence: { kind: "turn-finalised", role: "review", terminal: "answered" },
        kind: "candidate",
        row: childRow(),
        workspace: childWorkspace(),
      },
    ]);
  });

  // End-to-end rather than on the evidence function alone: a guard the planner never hands a live posture
  // to is indistinguishable from no guard, so the posture has to reach it through `reviewPostureFor`.
  it("keeps a review child mid-verdict as dispatch-open, past a parent lease that has run out", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" })];
    const plan = planChildren({
      askEvents,
      review: reviewing({ spawnedAt: "2026-09-03T09:40:00.000Z" }),
      rows: [childRow()],
      workspaces: [childWorkspace()],
    });
    expect(plan).toEqual([{ kind: "kept", reason: "dispatch-open", row: childRow() }]);
  });

  it("makes that same review child a candidate once no reviewer is open", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" })];
    const plan = planChildren({ askEvents, rows: [childRow()], workspaces: [childWorkspace()] });
    expect(plan).toEqual([
      {
        evidence: { kind: "parent-lease-expired" },
        kind: "candidate",
        row: childRow(),
        workspace: childWorkspace(),
      },
    ]);
  });

  it("makes an ask worker of an answered ask a candidate too", () => {
    const worker = childRow({ sessionKey: WORKER_KEY });
    const plan = planChildren({
      askEvents: [captured(), ANSWERED],
      rows: [worker],
      workspaces: [childWorkspace({ description: `spawned session · ${WORKER_NAME}` })],
    });
    expect(plan[0]!.kind).toBe("candidate");
  });

  it("keeps a child of a turn that is still running, silently", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" })];
    const plan = planChildren({ askEvents, rows: [childRow()], workspaces: [childWorkspace()] });
    expect(plan).toEqual([{ kind: "kept", reason: "dispatch-open", row: childRow() }]);
    expect(
      renderCloseDoneOutcome({ dryRun: false, outcome: { item: plan[0]!, kind: "kept" } as CloseDoneOutcome }),
    ).toBeUndefined();
  });

  it("reads a live worker row as the parent still being there", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" })];
    const worker = childRow({ sessionKey: WORKER_KEY, workspaceRef: "workspace:8" });
    const workerWorkspace = childWorkspace({
      description: `spawned session · ask-${ASK.channel}-${ASK.messageTs}`,
      workspaceId: "id-8",
      workspaceRef: "workspace:8",
    });
    const plan = planChildren({
      askEvents,
      rows: [worker, childRow()],
      workspaces: [workerWorkspace, childWorkspace()],
    });
    expect(plan.map((item) => item.kind)).toEqual(["kept", "kept"]);
  });

  it("reaps a review child whose worker row has no live workspace left", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" })];
    const worker = childRow({ sessionKey: WORKER_KEY, status: "closed", workspaceRef: "workspace:8" });
    const plan = planChildren({ askEvents, rows: [worker, childRow()], workspaces: [childWorkspace()] });
    expect(plan).toEqual([
      { evidence: { kind: "parent-worker-gone" }, kind: "candidate", row: childRow(), workspace: childWorkspace() },
    ]);
  });

  it("reaps a CLOSED review row whose exact ref still pairs to the workspace its own name claims", () => {
    const closed = childRow({ status: "closed" });
    const plan = planChildren({ askEvents: [captured(), ANSWERED], rows: [closed], workspaces: [childWorkspace()] });
    expect(plan).toEqual([
      {
        evidence: { kind: "turn-finalised", role: "review", terminal: "answered" },
        kind: "candidate",
        row: closed,
        workspace: childWorkspace(),
      },
    ]);
  });

  it("keeps a review row, open or closed, whose ref cmux has re-issued to some other dispatch", () => {
    const reissued = childWorkspace({
      description: "spawned session · review-C0ZZZ-1789000000.000001",
      title: "review: something else",
    });
    const closed = childRow({ status: "closed" });
    expect(planChildren({ askEvents: [captured(), ANSWERED], rows: [closed], workspaces: [reissued] })).toEqual([
      { kind: "kept", reason: "dispatch-ref-reused", row: closed },
    ]);
    // The OPEN row is the half review found: a stale row for a workspace that vanished
    // without a ledger close, paired by a re-issued ref to ANOTHER ask's live child in the shared checkout,
    // was handed this ask's terminal evidence and closed. The witness is required of every dispatch row.
    const open = childRow();
    expect(planChildren({ askEvents: [captured(), ANSWERED], rows: [open], workspaces: [reissued] })).toEqual([
      { kind: "kept", reason: "dispatch-ref-reused", row: open },
    ]);
  });

  it("keeps a child whose live workspace names no dispatch at all", () => {
    const nameless = childWorkspace({ description: undefined, title: "some other session" });
    expect(planChildren({ askEvents: [captured(), ANSWERED], rows: [childRow()], workspaces: [nameless] })).toEqual([
      { kind: "kept", reason: "dispatch-ref-reused", row: childRow() },
    ]);
  });

  it("leaves a CLOSED review row with no live workspace out of the plan altogether", () => {
    const closed = childRow({ status: "closed" });
    expect(planChildren({ askEvents: [captured(), ANSWERED], rows: [closed], workspaces: [] })).toEqual([]);
  });

  it("frees the worktree fallback for the slug-backed row a dispatch child used to swallow", () => {
    // Narrowing the fallback to slug-backed rows CHANGES what a slug-backed row gets,
    // and the change is the point. Both rows carry a ref cmux has renumbered past; before, the dispatch row
    // claimed the live workspace on the shared cwd and the real session read `drifted`, so its ledger row was
    // retired while its workspace ran on. Now the dispatch row cannot claim it and the slug row does.
    const child = childRow({ workspaceRef: "workspace:1010" });
    const session: SessionItem = {
      cwd: LOOP_CWD,
      lastEventIso: "2026-09-03T07:02:00.000Z",
      sessionKey: "live-loop",
      slug: "live-loop",
      spawnedIso: "2026-09-03T07:02:00.000Z",
      status: "open",
      workspaceRef: "workspace:1011",
    };
    const live = childWorkspace({ description: undefined, title: "live loop", workspaceRef: "workspace:19" });
    const plan = planCloseDone({
      askEvents: [captured(), ANSWERED],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [child, session],
      workspaces: [live],
    });
    expect(plan).toEqual([
      { kind: "drifted", row: child, workspaceRef: "workspace:1010" },
      { evidence: { kind: "run-closed" }, kind: "candidate", row: session, workspace: live },
    ]);
  });

  it("lets a closed dispatch row claim the workspace it IS, so a slug row's fallback stops taking it", () => {
    // The second half of the same consequence. Two live workspaces share the loop's
    // checkout: one IS the closed dispatch child and says so by name, the other is unclaimed. Before this
    // diff the closed row was invisible, so the slug row's cwd-only fallback took the dispatch child's
    // workspace and was kept for the wrong reason. Now the row that can be identified claims it, and the
    // fallback reaches the workspace nothing else claims — which is what the fallback is for.
    const closedChild = childRow({ status: "closed" });
    const session: SessionItem = {
      cwd: LOOP_CWD,
      lastEventIso: "2026-09-03T07:02:00.000Z",
      sessionKey: "live-loop",
      slug: "live-loop",
      spawnedIso: "2026-09-03T07:02:00.000Z",
      status: "open",
      workspaceRef: "workspace:1011",
    };
    const other = childWorkspace({
      description: undefined,
      title: "live loop",
      workspaceId: "id-19",
      workspaceRef: "workspace:19",
    });
    const plan = planCloseDone({
      askEvents: [captured(), ANSWERED],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [closedChild, session],
      workspaces: [childWorkspace(), other],
    });
    expect(plan).toEqual([
      {
        evidence: { kind: "turn-finalised", role: "review", terminal: "answered" },
        kind: "candidate",
        row: closedChild,
        workspace: childWorkspace(),
      },
      { evidence: { kind: "run-closed" }, kind: "candidate", row: session, workspace: other },
    ]);
  });

  it("never pairs a dispatch child on the shared checkout alone", () => {
    const stale = childRow({ workspaceRef: "workspace:1010" });
    const plan = planChildren({ askEvents: [captured(), ANSWERED], rows: [stale], workspaces: [childWorkspace()] });
    expect(plan).toEqual([{ kind: "drifted", row: stale, workspaceRef: "workspace:1010" }]);
  });

  it("keeps a child of an ask nothing on the lifecycle log accounts for", () => {
    const plan = planChildren({ askEvents: [], rows: [childRow()], workspaces: [childWorkspace()] });
    expect(plan).toEqual([{ kind: "kept", reason: "no-slug", row: childRow() }]);
  });

  it("outranks terminal dispatch evidence with pinned, own-workspace, standing and booting", () => {
    const askEvents = [captured(), ANSWERED];
    const pinned = planChildren({ askEvents, rows: [childRow()], workspaces: [childWorkspace({ pinned: true })] });
    expect(pinned).toEqual([{ kind: "kept", reason: "pinned", row: childRow() }]);
    const own = planCloseDone({
      askEvents,
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: "id-9",
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [childRow()],
      workspaces: [childWorkspace()],
    });
    expect(own).toEqual([{ kind: "kept", reason: "own-workspace", row: childRow() }]);
    const booting = childRow({ spawnedIso: new Date(Date.parse(NOW) - BOOTING_GRACE_MS + 1).toISOString() });
    expect(planChildren({ askEvents, rows: [booting], workspaces: [childWorkspace()] })).toEqual([
      { kind: "kept", reason: "booting", row: booting },
    ]);
  });
});
