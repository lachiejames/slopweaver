/**
 * The production wiring of `github merge --admin`'s edges — the composition root, kept apart from
 * `./mergeAdminRun.ts` so the merge's order of operations reads without it. The shape lives in
 * `./mergeAdminTypes.ts`.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { productionBaselineBumpWitnessReader } from "../../../codex/baselineBumpWitnessRun.js";
import { productionLocalCodexLoopReader } from "../../../codex/landingGateRun.js";
import { githubToken } from "../../../config.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import { logger } from "../../../lib/logger.js";
import { makeGithubAdminMergeApi } from "../../../outbound/github/adminMerge.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { measureRequiredBaseFreshness, productionBaseFreshnessRunDeps } from "./baseFreshnessRun.js";
import { resolveCommitSha } from "./gitAncestry.js";
import { productionMergeHoldDeps } from "./holdDeps.js";
import { releaseHeldPullRequest } from "./holdRun.js";
import { productionProbePostMergeDocsBudget } from "./mergeAdminProbe.js";
import type { GithubAdminMergeDeps } from "./mergeAdminTypes.js";
import { productionGithubPushDeps } from "./pushRun.js";
import { productionWalkthroughStepDeps } from "./walkthroughStepDeps.js";

/**
 * The production edges.
 *
 * @returns the real credential, GitHub write client, Git measurement and output sink
 */
export function productionGithubAdminMergeDeps(): GithubAdminMergeDeps {
  return {
    doorLedger: doorLedgerPort(),
    localSha: ({ cwd, ref }) => resolveCommitSha({ cwd, ref }),
    makeApi: ({ home, token }) => makeGithubAdminMergeApi({ privacy: githubWritePrivacy({ home }), token }),
    measureBaseFreshness: ({ cwd, remote, baseBranch, headSha }) =>
      measureRequiredBaseFreshness({
        cwd,
        defaultBranch: baseBranch,
        deps: productionBaseFreshnessRunDeps({ git: productionGithubPushDeps() }),
        headSha,
        remote,
      }),
    nowIso: () => new Date().toISOString(),
    out: ({ line }) => {
      logger.out({ line });
    },
    probePostMergeDocsBudget: productionProbePostMergeDocsBudget,
    readBumpWitness: productionBaselineBumpWitnessReader(),
    readCodexLoop: productionLocalCodexLoopReader(),
    publishAlert: ({ event, home }) => {
      const failure = publishSupervisorEvent({ event, home });
      if (failure !== undefined) {
        logger.warn({ msg: `supervisor stream: ${failure}` });
      }
    },
    releaseOwnHold: ({ home, pr, repo, sha }) => {
      releaseHeldPullRequest({ deps: productionMergeHoldDeps(), home, pr, repo, sha });
    },
    token: ({ home }) => githubToken({ home }),
    walkthrough: productionWalkthroughStepDeps(),
  };
}
