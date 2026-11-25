/**
 * The edges `slopweaver github enqueue` reaches the world through, and their production wiring — kept apart from
 * `./enqueueRun.ts` so the verb's order of operations reads without the composition root beside it, and so a
 * test builds the same shape the verb runs on.
 */

import { setTimeout } from "node:timers/promises";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import {
  type BaselineBumpWitnessReader,
  productionBaselineBumpWitnessReader,
} from "../../../codex/baselineBumpWitnessRun.js";
import { type LocalCodexLoopReader, productionLocalCodexLoopReader } from "../../../codex/landingGateRun.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { withholdingCredentialWriter } from "../../../outbound/github/descriptionWords.js";
import { type GithubMergeQueueApi, makeGithubMergeQueueApi } from "../../../outbound/github/mergeQueue.js";
import { sweepMergePrivateTerms } from "../../../outbound/github/privateTermsSweep.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { measureAvailableBaseFreshness, productionBaseFreshnessRunDeps } from "./baseFreshnessRun.js";
import type { EnqueuePrivateTermsDeps } from "./enqueuePrivateTerms.js";
import { type MergeHoldDeps, productionMergeHoldDeps } from "./holdDeps.js";
import { productionGithubPushDeps } from "./pushRun.js";
import type { WalkthroughStepDeps } from "./walkthroughStep.js";
import { productionWalkthroughStepDeps } from "./walkthroughStepDeps.js";

/** Injectable edges for a no-network unit test; the private-terms preflight's git edges among them. */
export interface GithubEnqueueDeps extends EnqueuePrivateTermsDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubMergeQueueApi;
  /** The merge hold's own edges — the document, the clock, the journal and the supervisor stream. */
  readonly hold: MergeHoldDeps;
  /** Where the verb is being run from — one of the checkouts the pairing-floor read considers, not a privileged one. */
  readonly cwd: () => string;
  /** Read this PULL REQUEST's pairing-floor evidence. A seam so the wiring is testable with a plain function. */
  readonly readCodexLoop: LocalCodexLoopReader;
  /**
   * Read whether every ratchet bump the pull request adds has its Codex witness (`./baselineBumpGate.ts`), judged
   * against the branch the press lands on — a native stack's own base for a member above the bottom.
   */
  readonly readBumpWitness: BaselineBumpWitnessReader;
  /**
   * Sleep between rounds of the asynchronous stack path's confirmation loop. A seam so a unit test runs the
   * whole loop instantly — the delays it would have taken are what the test asserts on.
   */
  readonly wait: (args: { ms: number }) => Promise<void>;
  /** The author's own open walkthrough threads, resolved immediately before the mutation (`./walkthroughStep.ts`). */
  readonly walkthrough: WalkthroughStepDeps;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned client and output edges for the enqueue command
 */
export function productionGithubEnqueueDeps(): GithubEnqueueDeps {
  return {
    hold: productionMergeHoldDeps(),
    cwd: () => process.cwd(),
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    readCodexLoop: productionLocalCodexLoopReader(),
    readBumpWitness: productionBaselineBumpWitnessReader(),
    makeApi: ({ home, token }) => makeGithubMergeQueueApi({ privacy: githubWritePrivacy({ home }), token }),
    // Git's own warnings go to stderr, credential-shaped ones withheld: `--json` answers with one stdout document.
    measureBaseFreshness: ({ cwd, remote, target }) =>
      measureAvailableBaseFreshness({
        cwd,
        deps: productionBaseFreshnessRunDeps({
          git: {
            ...productionGithubPushDeps(),
            out: withholdingCredentialWriter({ write: ({ line }) => logger.warn({ msg: line }) }),
          },
        }),
        remote,
        target,
      }),
    sweepPrivateTerms: ({ repoRoot, base, headSha, home }) =>
      sweepMergePrivateTerms({ base, headRef: headSha, home, repo: repoRoot }),
    out: (line) => {
      logger.out({ line });
    },
    wait: ({ ms }) => setTimeout(ms),
    walkthrough: productionWalkthroughStepDeps(),
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}
