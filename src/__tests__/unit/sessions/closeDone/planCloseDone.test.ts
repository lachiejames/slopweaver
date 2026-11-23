/**
 * How the done-chat sweep pairs slug-backed ledger rows with live workspaces, and what it plans for each: a
 * candidate, a park candidate, a drifted row, or a row kept for a named reason. Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import { BOOTING_GRACE_MS, planCloseDone } from "../../../../sessions/closeDone.js";
import { workspace } from "../../cli/commands/session/closeDoneHarness.js";
import { always, never, row } from "../closeDonePlanFixtures.js";
import { NO_REVIEW, NOW } from "../dispatchFixtures.js";
import { noStanding } from "./children.js";

describe("planCloseDone", () => {
  it("makes a done row with an idle-eligible live workspace a candidate", () => {
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row()],
      workspaces: [workspace()],
    });
    expect(plan).toEqual([{ evidence: { kind: "run-closed" }, kind: "candidate", row: row(), workspace: workspace() }]);
  });

  it("makes a row whose run is open a park candidate, judged by its screen and session next", () => {
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row()],
      workspaces: [workspace()],
    });
    expect(plan).toEqual([{ kind: "park-candidate", row: row(), workspace: workspace() }]);
  });

  it("ignores closed rows entirely", () => {
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row({ status: "closed" })],
      workspaces: [workspace()],
    });
    expect(plan).toEqual([]);
  });

  it("marks an open row with no live workspace as drifted", () => {
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row()],
      workspaces: [],
    });
    expect(plan).toEqual([{ kind: "drifted", row: row(), workspaceRef: "workspace:1" }]);
  });

  it("does not pair a row with a live workspace that reuses its ref for different work", () => {
    const other = workspace({ currentDirectory: "/w/.claude/worktrees/other-doc", workspaceId: "id-other" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row()],
      workspaces: [other],
    });
    expect(plan).toEqual([{ kind: "drifted", row: row(), workspaceRef: "workspace:1" }]);
  });

  it("pairs a row with its worktree's live workspace after cmux re-numbered the ref", () => {
    const renumbered = workspace({ workspaceId: "id-19", workspaceRef: "workspace:19" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "ask-settled", settlement: "answered" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row({ workspaceRef: "workspace:1010" })],
      workspaces: [renumbered],
    });
    expect(plan).toEqual([
      {
        evidence: { kind: "ask-settled", settlement: "answered" },
        kind: "candidate",
        row: row({ workspaceRef: "workspace:1010" }),
        workspace: renumbered,
      },
    ]);
  });

  it("pairs across a symlinked worktree root by basename", () => {
    const live = workspace({ currentDirectory: "/w/.claude/worktrees.noindex/a-doc" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [row()],
      workspaces: [live],
    });
    expect(plan).toEqual([{ kind: "park-candidate", row: row(), workspace: live }]);
  });

  it("lets the exact-ref row claim the workspace, so a stale row for the same worktree drifts", () => {
    const fresh = row({ spawnedIso: "2026-09-03T07:00:00.000Z", workspaceRef: "workspace:19" });
    const stale = row({ workspaceRef: "workspace:1010" });
    const live = workspace({ workspaceId: "id-19", workspaceRef: "workspace:19" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [fresh, stale],
      workspaces: [live],
    });
    expect(plan).toEqual([
      { kind: "park-candidate", row: fresh, workspace: live },
      { kind: "drifted", row: stale, workspaceRef: "workspace:1010" },
    ]);
  });

  it("never pairs one live workspace with two rows", () => {
    const first = row({ sessionKey: "a-doc", workspaceRef: "workspace:455" });
    const second = row({ sessionKey: "a-doc", workspaceRef: "workspace:472" });
    const live = workspace({ workspaceId: "id-9", workspaceRef: "workspace:9" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [first, second],
      workspaces: [live],
    });
    expect(plan).toEqual([
      { evidence: { kind: "run-closed" }, kind: "candidate", row: first, workspace: live },
      { kind: "drifted", row: second, workspaceRef: "workspace:472" },
    ]);
  });

  it("keeps a row registered by hand with no workspace", () => {
    const noted = row({ cwd: undefined, slug: undefined, spawnedIso: undefined, workspaceRef: undefined });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [noted],
      workspaces: [],
    });
    expect(plan).toEqual([{ kind: "kept", reason: "no-workspace", row: noted }]);
  });

  it("keeps a dispatched child that answers to no slug, even in a done worktree", () => {
    const child = row({ sessionKey: "ask-C1-1.2", slug: undefined, workspaceRef: "workspace:82" });
    const live = workspace({ workspaceId: "id-82", workspaceRef: "workspace:82" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [child],
      workspaces: [live],
    });
    expect(plan).toEqual([{ kind: "kept", reason: "no-slug", row: child }]);
  });

  // A worktree named like the retired standing scheduler is an ORDINARY row now, closed on its own evidence
  // exactly as any other: the owner deleted the session whose naming this used to exempt.
  it("keeps the pinned workspace and the caller's own, in that order of precedence, and exempts nothing else", () => {
    const pinnedRow = row({ workspaceRef: "workspace:81" });
    const ownRow = row({ workspaceRef: "workspace:83" });
    const schedulerLookingRow = row({ cwd: "/w/recipe-scheduler-f7a1215242cc", workspaceRef: "workspace:70" });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: "id-83",
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [pinnedRow, ownRow, schedulerLookingRow],
      workspaces: [
        workspace({ pinned: true, workspaceId: "id-81", workspaceRef: "workspace:81" }),
        workspace({ workspaceId: "id-83", workspaceRef: "workspace:83" }),
        workspace({
          currentDirectory: "/w/recipe-scheduler-f7a1215242cc",
          workspaceId: "id-70",
          workspaceRef: "workspace:70",
        }),
      ],
    });
    expect(plan[0]).toEqual({ kind: "kept", reason: "pinned", row: pinnedRow });
    expect(plan[1]).toEqual({ kind: "kept", reason: "own-workspace", row: ownRow });
    expect(plan[2]!.kind).toBe("candidate");
  });

  it("keeps a row spawned inside the booting grace, whatever its predecessor's journal says", () => {
    const justSpawned = row({ spawnedIso: new Date(Date.parse(NOW) - BOOTING_GRACE_MS + 1000).toISOString() });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [justSpawned],
      workspaces: [workspace()],
    });
    expect(plan).toEqual([{ kind: "kept", reason: "booting", row: justSpawned }]);
  });

  it("judges a row spawned exactly at the grace boundary as no longer booting", () => {
    const atBoundary = row({ spawnedIso: new Date(Date.parse(NOW) - BOOTING_GRACE_MS).toISOString() });
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      standingFor: noStanding,
      rows: [atBoundary],
      workspaces: [workspace()],
    });
    expect(plan[0]!.kind).toBe("candidate");
  });
});
