/**
 * cmux's launch translations are exact both ways, so `cmux spawn` reads byte-identical output through the seam: a
 * plan survives the round trip through the launch spec, and every spawn outcome survives the round trip through the
 * launcher's vocabulary.
 */
import { describe, expect, it } from "vitest";

import type { VisibleSessionPlan } from "../../../cmux/plan.js";
import type { SpawnedSession, SpawnFailure } from "../../../cmux/spawn.js";
import {
  launchFailureFromSpawn,
  launchSpecFromPlan,
  openedFromSpawned,
  planFromLaunchSpec,
  spawnedFromOpened,
  spawnFailureFromLaunch,
} from "../../../sessionHarness/cmuxLaunch.js";
import { launchLeftSessionOpen } from "../../../sessionHarness/launch.js";

const PLAN: VisibleSessionPlan = {
  baseBranch: "main",
  branch: "a-branch",
  codexHome: "/stores/codex-a",
  cwd: "/work/tree-7",
  driver: "codex",
  effort: "high",
  host: "codex",
  model: "gpt-5",
  pickupCommand: "read the doc, then start it",
  repoRoot: "/work/repo",
  respondingToHandle: undefined,
  sessionName: "a-doc-seat",
  spawnedAt: "2026-11-07T02:59:00.000Z",
  template: "code",
  workspaceName: "a-doc",
  workspaceTitle: "a doc",
  worktreeExists: false,
};

const SPAWNED: SpawnedSession = {
  bootWitness: { by: "event", confirmed: true },
  delivery: { kind: "resubmitted", witness: { by: "screen", confirmed: true } },
  pickupCommand: "read the doc, then resume it",
  surfaceId: "surface-id-7",
  surfaceRef: "surface:7",
  workspaceId: "id-7",
  workspaceRef: "workspace:7",
};

describe("launchSpecFromPlan / planFromLaunchSpec", () => {
  it("round-trips a plan whose driver agrees with its host", () => {
    expect(planFromLaunchSpec({ spec: launchSpecFromPlan({ ledgerKey: "a-doc", plan: PLAN }) })).toEqual(PLAN);
  });

  it("names the plan in the session's vocabulary, the ledger key and slug beside it", () => {
    const spec = launchSpecFromPlan({ ledgerKey: "a-doc", plan: PLAN, slug: "a-doc" });
    expect([spec.directory, spec.directoryExists, spec.launchKey, spec.title, spec.initialMessage, spec.slug]).toEqual([
      "/work/tree-7",
      false,
      "a-doc",
      "a doc",
      "read the doc, then start it",
      "a-doc",
    ]);
  });

  it("derives the claude driver for a Claude Code host", () => {
    const claudePlan: VisibleSessionPlan = { ...PLAN, driver: "claude", host: "claude-code" };
    expect(planFromLaunchSpec({ spec: launchSpecFromPlan({ ledgerKey: "a-doc", plan: claudePlan }) }).driver).toBe(
      "claude",
    );
  });
});

describe("openedFromSpawned / spawnedFromOpened", () => {
  it("round-trips a spawned session", () => {
    expect(spawnedFromOpened({ opened: openedFromSpawned({ spawned: SPAWNED }) })).toEqual(SPAWNED);
  });

  it("keys the opened session by the workspace's stable id", () => {
    const opened = openedFromSpawned({ spawned: SPAWNED });
    expect([opened.sessionId, opened.handle, opened.endpointId, opened.endpointHandle]).toEqual([
      "id-7",
      "workspace:7",
      "surface-id-7",
      "surface:7",
    ]);
  });
});

describe("launchFailureFromSpawn / spawnFailureFromLaunch", () => {
  const failures: readonly SpawnFailure[] = [
    { reason: "the credential gate refused", surfaceRef: "", workspaceRef: "" },
    { reason: "the boot was never witnessed", surfaceRef: "", workspaceId: "id-8", workspaceRef: "workspace:8" },
    {
      reason: "the pickup was left in the composer",
      strandedInComposer: true,
      surfaceRef: "surface:9",
      workspaceId: "id-9",
      workspaceRef: "workspace:9",
    },
    {
      pickupSubmissionUnproven: true,
      reason: "nothing saw the pickup submitted",
      surfaceRef: "surface:9",
      workspaceRef: "workspace:9",
    },
    {
      quotaKind: "usage-limit",
      reason: "the seat hit its usage limit",
      surfaceRef: "surface:10",
      workspaceId: "id-10",
      workspaceRef: "workspace:10",
    },
  ];

  it("round-trips every spawn failure shape", () => {
    expect(
      failures.map((failure) =>
        spawnFailureFromLaunch({ failure: launchFailureFromSpawn({ failure, operation: "open" }) }),
      ),
    ).toEqual(failures);
  });

  it("carries an address only when cmux named one, and leaves a session open only on a held message", () => {
    const launched = failures.map((failure) => launchFailureFromSpawn({ failure, operation: "resume" }));
    expect(launched.map((failure) => failure.opened)).toEqual([
      undefined,
      { endpointHandle: "", handle: "workspace:8", sessionId: "id-8" },
      { endpointHandle: "surface:9", handle: "workspace:9", sessionId: "id-9" },
      { endpointHandle: "surface:9", handle: "workspace:9" },
      { endpointHandle: "surface:10", handle: "workspace:10", sessionId: "id-10" },
    ]);
    expect(launched.map((failure) => launchLeftSessionOpen({ failure }))).toEqual([false, false, true, true, false]);
    expect(launched.map((failure) => failure.operation)).toEqual(["resume", "resume", "resume", "resume", "resume"]);
  });
});
