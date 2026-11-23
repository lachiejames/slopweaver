/**
 * `spawnDrawdownInvestigation` over injected edges: the plan it hands the session opener, the receipt a
 * booted session yields, the typed error each failure kind becomes, and that the spawn dependencies are
 * closed on every one of those endings. No socket and no workspace are ever touched.
 */
import { describe, expect, it } from "vitest";

import { ClaudeErrors } from "../../../claude/claudeErrors.js";
import type { DrawdownIncident } from "../../../claude/drawdownAnomaly.js";
import { type DrawdownInvestigationEdges, spawnDrawdownInvestigation } from "../../../claude/drawdownInvestigation.js";
import { drawdownInvestigationBrief } from "../../../claude/drawdownTick.js";
import type { CmuxClient } from "../../../cmux/client.js";
import { CmuxErrors } from "../../../cmux/errors.js";
import type { VisibleSessionPlan } from "../../../cmux/plan.js";
import type { SpawnDeps } from "../../../cmux/spawn.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-10-13T09:00:00.000Z";
const REPO_ROOT = "/fixture/repo";
const BRANCH = "main";

/** One incident with a single ready seven-day trigger. */
const INCIDENT: DrawdownIncident = {
  incidentId: "inc-7d-max",
  observedAtIso: NOW,
  triggers: [
    {
      baselineFractionPerHour: 0.002,
      currentFractionPerHour: 0.01,
      maturity: "ready",
      planAlias: "max",
      ratio: 5,
      resetAtIso: "2026-10-16T00:00:00.000Z",
      window: "seven-day",
    },
  ],
};

/** A client no test here reaches: the session opener is faked whole, so every call is refused. */
const UNUSED = CmuxErrors.callFailed({ cmuxCode: "not_found", message: "not used here", method: "workspace.list" });
const UNUSED_CLIENT: CmuxClient = {
  close: () => undefined,
  closeWorkspace: () => Promise.resolve(err(UNUSED)),
  createWorkspace: () => Promise.resolve(err(UNUSED)),
  identify: () => Promise.resolve(err(UNUSED)),
  interruptTurn: () => Promise.resolve(err(UNUSED)),
  listWorkspaces: () => Promise.resolve(err(UNUSED)),
  listWorkspacesStrict: () => Promise.resolve(err(UNUSED)),
  pinWorkspace: () => Promise.resolve(err(UNUSED)),
  processTree: () => Promise.resolve(err(UNUSED)),
  workspaceTop: () => Promise.resolve(err(UNUSED)),
  readResumeBinding: () => Promise.resolve(err(UNUSED)),
  readScreen: () => Promise.resolve(err(UNUSED)),
  readScreenGrid: () => Promise.resolve(err(UNUSED)),
  renameWorkspace: () => Promise.resolve(err(UNUSED)),
  resolveWorkspace: () => Promise.resolve(err(UNUSED)),
  sendLine: () => Promise.resolve(err(UNUSED)),
  submitComposer: () => Promise.resolve(err(UNUSED)),
  topologyStrict: () => Promise.resolve(err(UNUSED)),
  unpinWorkspace: () => Promise.resolve(err(UNUSED)),
  workspaceSurface: () => Promise.resolve(err(UNUSED)),
};

type SessionOpener = DrawdownInvestigationEdges["openSession"];

/**
 * Edges whose deps count their closes and whose opener records each plan before answering as `open` says.
 *
 * @param open what the faked opener does once it has recorded the plan
 * @returns the edges, the plans the opener saw and a live count of closes
 */
function recordingEdges({ open }: { open: SessionOpener }): {
  readonly edges: DrawdownInvestigationEdges;
  readonly plans: VisibleSessionPlan[];
  readonly closes: () => number;
} {
  let closed = 0;
  const plans: VisibleSessionPlan[] = [];
  const deps: SpawnDeps = {
    client: UNUSED_CLIENT,
    close: () => {
      closed += 1;
    },
    ensureWorktree: () => undefined,
    gateCodexBrowserSurface: () => ok(undefined),
    gateCredentialStore: ({ plan }) => Promise.resolve(ok(plan)),
    holdWorkspaceCreate: () => ok({ claimed: new Set<string>(), release: () => undefined }),
    observedEvents: () => [],
    resolvePluginDir: () => "/fixture/plugin",
    sidebarCli: { run: () => ok("") },
    wait: () => Promise.resolve(),
    // The session opener is faked whole, so no boot is ever judged on its composer here.
    witnessClaudeBoot: () => Promise.resolve({ kind: "unwitnessed" }),
  };
  const makeDeps: DrawdownInvestigationEdges["makeDeps"] = () => deps;
  const openSession: SessionOpener = (input) => {
    plans.push(input.plan);
    return open(input);
  };
  return { closes: () => closed, edges: { makeDeps, openSession }, plans };
}

const BOOTED: SessionOpener = () => Promise.resolve(ok({ workspaceRef: "workspace:9" }));

describe("spawnDrawdownInvestigation", () => {
  it("opens one Opus research session at high effort in the current checkout, briefed with the incident", async () => {
    const seam = recordingEdges({ open: BOOTED });

    await spawnDrawdownInvestigation({
      branch: BRANCH,
      edges: seam.edges,
      incident: INCIDENT,
      nowIso: NOW,
      repoRoot: REPO_ROOT,
    });

    expect(seam.plans.length).toBe(1);
    const plan = seam.plans[0]!;
    expect(plan.model).toBe("opus");
    expect(plan.effort).toBe("high");
    expect(plan.cwd).toBe(REPO_ROOT);
    expect(plan.repoRoot).toBe(REPO_ROOT);
    expect(plan.branch).toBe(BRANCH);
    expect(plan.spawnedAt).toBe(NOW);
    expect(plan.template).toBe("research");
    expect(plan.workspaceName).toBe("drawdown-inc-7d-max");
    expect(plan.pickupCommand).toBe(drawdownInvestigationBrief({ incident: INCIDENT }));
  });

  it("returns the incident id and the opened workspace ref, and closes the deps once", async () => {
    const seam = recordingEdges({ open: BOOTED });

    const receipt = await spawnDrawdownInvestigation({
      branch: BRANCH,
      edges: seam.edges,
      incident: INCIDENT,
      nowIso: NOW,
      repoRoot: REPO_ROOT,
    });

    expect(receipt.isOk()).toBe(true);
    expect(unwrap(receipt)).toEqual({ incidentId: "inc-7d-max", workspaceRef: "workspace:9" });
    expect(seam.closes()).toBe(1);
  });

  it("refuses with DRAWDOWN_INVESTIGATION_FAILED carrying the dead workspace ref when the session fails to boot", async () => {
    const seam = recordingEdges({
      open: () => Promise.resolve(err({ reason: "boot never confirmed", workspaceRef: "workspace:4" })),
    });

    const receipt = await spawnDrawdownInvestigation({
      branch: BRANCH,
      edges: seam.edges,
      incident: INCIDENT,
      nowIso: NOW,
      repoRoot: REPO_ROOT,
    });

    expect(receipt.isErr()).toBe(true);
    expect(unwrapErr(receipt)).toEqual(
      ClaudeErrors.drawdownInvestigationFailed({ reason: "boot never confirmed", workspaceRef: "workspace:4" }),
    );
    expect(unwrapErr(receipt).code).toBe("DRAWDOWN_INVESTIGATION_FAILED");
    expect(unwrapErr(receipt).message).toBe("boot never confirmed (workspace workspace:4)");
    expect(seam.closes()).toBe(1);
  });

  it("refuses with DRAWDOWN_SPAWN_FAILED carrying the thrown message when the opener throws, and still closes", async () => {
    const seam = recordingEdges({
      open: () => Promise.reject(new Error("cmux socket refused the connection")),
    });

    const receipt = await spawnDrawdownInvestigation({
      branch: BRANCH,
      edges: seam.edges,
      incident: INCIDENT,
      nowIso: NOW,
      repoRoot: REPO_ROOT,
    });

    expect(receipt.isErr()).toBe(true);
    expect(unwrapErr(receipt)).toEqual(
      ClaudeErrors.drawdownSpawnFailed({ detail: "cmux socket refused the connection" }),
    );
    expect(unwrapErr(receipt).code).toBe("DRAWDOWN_SPAWN_FAILED");
    expect(unwrapErr(receipt).message).toBe(
      "the investigation could not be spawned: cmux socket refused the connection",
    );
    expect(seam.closes()).toBe(1);
  });

  it("reduces a non-Error throw to the detail `unknown`", async () => {
    const seam = recordingEdges({
      open: () => {
        throw "a bare string";
      },
    });

    const receipt = await spawnDrawdownInvestigation({
      branch: BRANCH,
      edges: seam.edges,
      incident: INCIDENT,
      nowIso: NOW,
      repoRoot: REPO_ROOT,
    });

    expect(receipt.isErr()).toBe(true);
    expect(unwrapErr(receipt)).toEqual(ClaudeErrors.drawdownSpawnFailed({ detail: "unknown" }));
    expect(unwrapErr(receipt).message).toBe("the investigation could not be spawned: unknown");
    expect(seam.closes()).toBe(1);
  });

  // Pins CURRENT behaviour, which is a reported defect: the deps are built outside the `try`, so a throw while
  // building them escapes as a rejection rather than becoming DRAWDOWN_SPAWN_FAILED.
  it("lets a throw while building the deps escape as a rejection, before any session is opened", async () => {
    const seam = recordingEdges({ open: BOOTED });
    const makeDeps: DrawdownInvestigationEdges["makeDeps"] = () => {
      throw new Error("no cmux socket");
    };

    await expect(
      spawnDrawdownInvestigation({
        branch: BRANCH,
        edges: { makeDeps, openSession: seam.edges.openSession },
        incident: INCIDENT,
        nowIso: NOW,
        repoRoot: REPO_ROOT,
      }),
    ).rejects.toThrow("no cmux socket");
    expect(seam.plans).toEqual([]);
  });
});
