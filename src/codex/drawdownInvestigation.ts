/**
 * Opening the visible session that looks into a Codex burn anomaly.
 *
 * The effectful edge between `./drawdownTick.ts`, which decides, and `cmux/spawn.ts`, which opens a real
 * workspace. It is its own module so the tick stays testable with an injected function and never imports a
 * socket.
 *
 * **Rule 2, concretely.** The recording cmux launcher (`../sessionHarness/recordedSpawn.ts`) opens an INTERACTIVE workspace the owner can see in their sidebar
 * and interrupt while it runs. Nothing here detaches a model, nothing is resident, and the investigation is
 * pinned to Opus because it is an investigation rather than a mechanical leaf — rule 5's own division.
 *
 * **The investigating session is a CLAUDE session, not a Codex one, and that is deliberate.** The thing being
 * investigated is Codex spend; opening a Codex session to look into it would spend more of the budget that is
 * the subject of the enquiry, and it would fail outright whenever the cause is that the account is capped —
 * which is exactly when the answer matters most.
 */

import { err, ok, type Result } from "#lib/result.js";
import { OPUS_SPAWN_EFFORT } from "../cmux/modelPin.js";
import { planDrawdownInvestigation, type VisibleSessionPlan } from "../cmux/plan.js";
import { openRecordedCmuxSession, productionSpawnDeps } from "../sessionHarness/recordedSpawn.js";
import type { CodexDrawdownEpisode } from "./drawdownAnomaly.js";
import { type CodexDrawdownError, CodexDrawdownErrors } from "./drawdownErrors.js";
import { type CodexInvestigationReceipt, codexDrawdownBrief } from "./drawdownTick.js";

/** The model an investigation runs on — rule 5 puts investigation on Opus. */
const INVESTIGATION_MODEL = "opus";

/**
 * Open the visible session one plan describes: where it came up, or why it did not and which workspace may
 * still be standing. The seam a test replaces so no cmux socket is opened.
 */
export type InvestigationSessionOpener = (input: {
  plan: VisibleSessionPlan;
}) => Promise<Result<{ workspaceRef: string }, { reason: string; workspaceRef: string }>>;

/**
 * The production {@link InvestigationSessionOpener}: an `open` through the session harness's recording cmux launcher
 * on its own spawn deps, closed whatever happens — so the investigation gets its session-ledger row from what the
 * launch did, keyed by its workspace name.
 *
 * @param plan the session to open
 * @returns the workspace it came up in, or the failure reason with the workspace that may still be standing
 */
async function openProductionInvestigationSession({
  plan,
}: {
  plan: VisibleSessionPlan;
}): Promise<Result<{ workspaceRef: string }, { reason: string; workspaceRef: string }>> {
  const deps = productionSpawnDeps({});
  try {
    return await openRecordedCmuxSession({ deps, plan });
  } finally {
    deps.close();
  }
}

/**
 * Open one investigation.
 *
 * @param episode the episode that fired
 * @param nowIso the instant to stamp the spawn with
 * @param repoRoot the checkout the session opens in — the current one, since nothing is forked
 * @param branch that checkout's branch, for the plan's own record
 * @param openSession what opens the planned session; a real cmux spawn unless a test supplies a fake
 * @returns where it came up, or why it did not
 */
export async function spawnCodexDrawdownInvestigation({
  episode,
  nowIso,
  repoRoot,
  branch,
  openSession = openProductionInvestigationSession,
}: {
  episode: CodexDrawdownEpisode;
  nowIso: string;
  repoRoot: string;
  branch: string;
  openSession?: InvestigationSessionOpener;
}): Promise<Result<CodexInvestigationReceipt, CodexDrawdownError>> {
  try {
    const outcome = await openSession({
      plan: planDrawdownInvestigation({
        branch,
        incidentId: episode.episodeId,
        effort: OPUS_SPAWN_EFFORT,
        model: INVESTIGATION_MODEL,
        pickupCommand: codexDrawdownBrief({ episode }),
        repoRoot,
        spawnedAt: nowIso,
        subject: "Codex",
      }),
    });
    if (outcome.isErr()) {
      // The workspace may have OPENED and then failed to boot or take its pickup, so the ref is carried into
      // the failure text in the shape `./drawdownTick.ts` reads back. That is what turns this into an
      // AMBIGUOUS outcome rather than a failed one — there may be a live workspace somebody has to close.
      return err(
        CodexDrawdownErrors.spawnFailed({ cause: `${outcome.error.reason} (workspace ${outcome.error.workspaceRef})` }),
      );
    }
    return ok({ episodeId: episode.episodeId, workspaceRef: outcome.value.workspaceRef });
  } catch (error) {
    return err(
      CodexDrawdownErrors.spawnFailed({
        cause: `the investigation could not be spawned: ${error instanceof Error ? error.message : "unknown"}`,
      }),
    );
  }
}
