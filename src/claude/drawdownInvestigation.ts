/**
 * Opening the visible session that looks into a plan-drawdown anomaly.
 *
 * The effectful edge between `./drawdownTick.ts`, which decides, and the session harness's recording cmux
 * launcher, which opens a real workspace and writes its ledger row. It exists as its own module so the tick
 * stays testable with an injected function and never imports a socket.
 *
 * **Rule 2, concretely.** `openRecordedCmuxSession` opens an INTERACTIVE workspace the owner can see in their sidebar
 * and interrupt while it runs. Nothing here detaches a model, and the investigation is pinned to Opus
 * because it is an investigation rather than a mechanical leaf — rule 5's own division.
 */
import { OPUS_SPAWN_EFFORT } from "../cmux/modelPin.js";
import { planDrawdownInvestigation } from "../cmux/plan.js";
import { err, ok, type Result } from "../lib/result.js";
import { openRecordedCmuxSession, productionSpawnDeps } from "../sessionHarness/recordedSpawn.js";
import { type ClaudeError, ClaudeErrors } from "./claudeErrors.js";
import type { DrawdownIncident } from "./drawdownAnomaly.js";
import { type DrawdownInvestigationReceipt, drawdownInvestigationBrief } from "./drawdownTick.js";

/** The model an investigation runs on — rule 5 puts investigation on Opus. */
const INVESTIGATION_MODEL = "opus";

/**
 * The two effectful edges an investigation crosses: building the spawn dependencies (a cmux socket and an
 * event subscription) and opening the session over them. Real in production; a test passes fakes so neither
 * a socket nor a workspace is ever touched.
 */
export interface DrawdownInvestigationEdges {
  /** Build the dependencies the session is opened through; the caller closes them. */
  readonly makeDeps: typeof productionSpawnDeps;
  /** Open, boot and hand the pickup to one visible session, writing its ledger row. */
  readonly openSession: typeof openRecordedCmuxSession;
}

/** The real edges: production spawn dependencies and the seam's recording cmux opener. */
const PRODUCTION_DRAWDOWN_EDGES: DrawdownInvestigationEdges = {
  makeDeps: productionSpawnDeps,
  openSession: openRecordedCmuxSession,
};

/**
 * Open one investigation.
 *
 * @param incident the episode that fired
 * @param nowIso the instant to stamp the spawn with
 * @param repoRoot the checkout the session opens in — the current one, since nothing is forked
 * @param branch that checkout's branch, for the plan's own record
 * @param edges how the dependencies are built and the session opened; omitted, the real cmux edges
 * @returns where it came up, or why it did not
 */
export async function spawnDrawdownInvestigation({
  incident,
  nowIso,
  repoRoot,
  branch,
  edges = PRODUCTION_DRAWDOWN_EDGES,
}: {
  incident: DrawdownIncident;
  nowIso: string;
  repoRoot: string;
  branch: string;
  edges?: DrawdownInvestigationEdges;
}): Promise<Result<DrawdownInvestigationReceipt, ClaudeError>> {
  const deps = edges.makeDeps({});
  try {
    const outcome = await edges.openSession({
      deps,
      plan: planDrawdownInvestigation({
        branch,
        incidentId: incident.incidentId,
        effort: OPUS_SPAWN_EFFORT,
        model: INVESTIGATION_MODEL,
        pickupCommand: drawdownInvestigationBrief({ incident }),
        repoRoot,
        spawnedAt: nowIso,
      }),
    });
    if (outcome.isErr()) {
      // The workspace may have OPENED and then failed to boot or take its pickup, so the ref is carried into
      // the failure: a supervisor reading the journal afterwards needs to know there is a dead workspace to
      // close, not just that something went wrong.
      return err(
        ClaudeErrors.drawdownInvestigationFailed({
          reason: outcome.error.reason,
          workspaceRef: outcome.error.workspaceRef,
        }),
      );
    }
    return ok({ incidentId: incident.incidentId, workspaceRef: outcome.value.workspaceRef });
  } catch (error) {
    return err(ClaudeErrors.drawdownSpawnFailed({ detail: error instanceof Error ? error.message : "unknown" }));
  } finally {
    deps.close();
  }
}
