/**
 * The last steps of `slopweaver github merge --admin` before its mutation: the recheck that must still hold at
 * the moment before the merge, and the dry run's answer in place of it. The ORDER they run in is
 * `./mergeAdminRun.ts`'s, whose header carries it; this module only holds the steps.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorDecisionWithoutRecording } from "../../../admit/effects.js";
import type { DoorAcknowledgement, DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AdminMergePr } from "../../../outbound/github/adminMerge.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { baselineBumpRefusal } from "./baselineBumpGate.js";
import { adminMergeDoorRefusalLines, adminMergeHeadOf } from "./mergeAdminCore.js";
import type { AdminMergeExecution, AdminMergeRequest, GithubAdminMergeDeps } from "./mergeAdminTypes.js";
import { judgeCodexPairingFloor } from "./mergeAdminVerdicts.js";
import { clearWalkthroughsBeforeLanding } from "./walkthroughStep.js";

/**
 * Print every line of a refusal and report the exit code, so each refusal site stays one statement.
 *
 * @param lines the refusal's lines, each printed after `refused: `
 * @returns the error exit code
 */
export function refuseAdminMerge({ deps, lines }: { deps: GithubAdminMergeDeps; lines: readonly string[] }): number {
  for (const line of lines) deps.out({ line: `refused: ${line}` });
  return EXIT_ERROR;
}

/**
 * Resolve the owner's own self-review notes before the merge, exactly as `github enqueue` does before its press
 * (`./walkthroughStep.ts`): every one is resolved before a pull request of the owner's merges. A dry run takes the
 * same step's read-only path — it validates the read and names what it WOULD resolve, and writes nothing.
 *
 * @returns whether the merge may go ahead
 */
async function clearBeforeMerge({
  deps,
  execution,
  home,
  owner,
  repo,
  pr,
}: {
  deps: GithubAdminMergeDeps;
  execution: AdminMergeExecution;
  home: string;
  owner: string;
  repo: string;
  pr: AdminMergePr;
}): Promise<boolean> {
  return clearWalkthroughsBeforeLanding({
    deps: deps.walkthrough,
    dryRun: execution === "dry-run",
    home,
    target: { headOid: pr.headSha, number: pr.number, owner, repo, url: pr.url },
    verb: "github merge --admin",
    write: (line) => {
      deps.out({ line });
    },
  });
}

/**
 * Everything that must still hold at the moment before the mutation: the Codex floor re-read, the ratchet-bump
 * witness (a hold: no acknowledgement reaches it, `./baselineBumpGate.ts`), then the owner's own self-review notes
 * cleared.
 *
 * @param repo the repository half of the slug, for the self-review step
 * @returns the floor's acknowledgement to record, or the exit code to stop on
 */
export async function recheckBeforeMerge({
  deps,
  home,
  owner,
  pr,
  repo,
  request,
}: {
  deps: GithubAdminMergeDeps;
  home: string;
  owner: string;
  pr: AdminMergePr;
  repo: string;
  request: AdminMergeRequest;
}): Promise<Result<DoorAcknowledgement | undefined, number>> {
  // Re-read the floor immediately before the mutation: `proceedToMerge` refused on it once already, BEFORE the
  // privileged reads, but those reads are AWAITED and a review finishing BROKEN in that window would otherwise
  // merge behind a floor that had since become unmet. Found by a Codex review. Narrowed, never closed — the
  // door admission still sits between this read and `api.merge`, and only GitHub's `sha` pin closes that.
  const recheck = await judgeCodexPairingFloor({ announce: true, deps, pr, request });
  if (recheck.kind === "standing") {
    return err(refuseAdminMerge({ deps, lines: recheck.lines }));
  }
  const head = adminMergeHeadOf({ pr, repo: request.repo });
  const bump = await baselineBumpRefusal({
    cwd: request.repoRoot,
    head,
    home,
    landingBranch: undefined,
    read: deps.readBumpWitness,
  });
  if (bump.length > 0) {
    return err(refuseAdminMerge({ deps, lines: bump }));
  }
  if (!(await clearBeforeMerge({ deps, execution: request.execution, home, owner, pr, repo }))) {
    return err(EXIT_ERROR);
  }
  return ok(recheck.acknowledgement);
}

/**
 * The dry run's answer where the merge would go through the door. Every check before it ran exactly as the merge
 * runs it, and the door is ASKED with the merge's own gates — a hold the merge would meet (an unloaded profile,
 * say) refuses here, found by a Codex review — but nothing is recorded. Only GitHub's own merge API stays unasked,
 * since only a write can ask it.
 *
 * @param doorRequest the exact request the real merge would send through the door
 * @returns the process exit code
 */
export function answerDryRun({
  deps,
  doorRequest,
  home,
  pr,
}: {
  deps: GithubAdminMergeDeps;
  doorRequest: DoorRequest;
  home: string;
  pr: AdminMergePr;
}): number {
  const decision = doorDecisionWithoutRecording({ env: process.env, gates: DEFAULT_GATES, home, request: doorRequest });
  if (decision.status !== "pass") {
    return refuseAdminMerge({
      deps,
      lines: adminMergeDoorRefusalLines({ through: { decision, kind: "door-refused", performed: false } }),
    });
  }
  deps.out({
    line:
      `would merge #${String(pr.number)} into ${pr.baseRef} as a squash through the administrator bypass; ` +
      "dry-run wrote nothing.",
  });
  return EXIT_OK;
}
