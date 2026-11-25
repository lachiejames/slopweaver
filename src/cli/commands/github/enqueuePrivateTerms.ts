/**
 * `github enqueue`'s private-terms preflight: the same change-set sweep `github merge --admin` runs, over the
 * PROSPECTIVE tree — the pinned head merged into the landing branch as this invocation just fetched it.
 *
 * Prospective, and the output says so on every run, because the queue lands a different tree: GitHub builds the
 * merge group later, on top of whatever is queued ahead, and nothing here reads it. Three residues follow, and
 * `docs/security/private-terms.md` § The landing sweep names them: the base can move after the fetch, entries
 * ahead change the merge group, and GitHub's merge is not this machine's `git merge-tree`.
 *
 * The semantics are merge --admin's, through the same {@link privateTermsPermit}: a hold refuses and nothing
 * acknowledges it; `unchecked` lands only on `--acknowledge private-terms-unchecked` named with a `--reason`; every
 * line passes the loaded terms' print filter. Every way the base is not fetched — a fork head, no checkout of this
 * repository, no local branch for the head, a failed fetch, a fetched branch that is not the landing branch — is
 * `unfetched`, which the sweep can only answer `unchecked` or `hold`, never clean.
 */

import type { DoorAcknowledgement } from "../../../admit/types.js";
import type { ChangeSetPrivateTermsVerdict, LandingBase } from "../../../hygiene/changeSetPrivateTerms.js";
import { printableReportLines } from "../../../hygiene/repositoryPrivateTerms.js";
import type { MergeQueuePrState } from "../../../live/github/mergeQueue.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import type { BaseFreshness, BaseFreshnessAcknowledgement } from "./baseFreshnessCore.js";
import type { GithubEnqueueArgs } from "./enqueueArgs.js";
import type { EnqueueTarget } from "./enqueueTarget.js";
import type { GithubVerbResult } from "./errors.js";
import { landingBaseOf, privateTermsPermit } from "./privateTermsPermit.js";

/** The remote the preflight fetches the landing branch from, as every other landing measurement does. */
const LANDING_REMOTE = "origin";

/** The edges the preflight reaches git through. */
export interface EnqueuePrivateTermsDeps {
  /** Where the verb runs from: the checkout the base is fetched into and the merged tree read from. */
  readonly cwd: () => string;
  /** Fetch the landing branch's live tip, or say why it was not (`./baseFreshnessRun.ts`). */
  readonly measureBaseFreshness: (args: {
    cwd: string;
    remote: string;
    target: PrTarget;
  }) => GithubVerbResult<BaseFreshness>;
  /** Sweep the merged change set of `headSha` into `base` (`../../../outbound/github/privateTermsSweep.ts`). */
  readonly sweepPrivateTerms: (args: {
    repoRoot: string;
    base: LandingBase;
    headSha: string;
    home: string;
  }) => ChangeSetPrivateTermsVerdict;
}

/**
 * Pure: the base the prospective tree is swept against — {@link landingBaseOf}, plus one refusal of its own: a
 * fetched branch that is not the landing branch (the measurement fetches the remote's default) names no base.
 *
 * @param measurement the preflight's base-freshness measurement
 * @param landingBranch the branch the queue lands on
 * @returns the fetched landing-branch tip, or why there is none
 * @internal exported for its unit test.
 */
export function enqueueLandingBase({
  measurement,
  landingBranch,
}: {
  measurement: GithubVerbResult<BaseFreshness>;
  landingBranch: string;
}): LandingBase {
  const base = landingBaseOf({ measurement });
  if (base.kind === "fetched" && measurement.isOk() && measurement.value.kind !== "skipped") {
    const fetched = measurement.value.baseBranch;
    if (fetched !== landingBranch) {
      return {
        detail: `the fetched branch ${fetched} is not the landing branch ${landingBranch}, so no merged change set exists to read`,
        kind: "unfetched",
      };
    }
  }
  return base;
}

/**
 * Pure: the line every preflight prints first, saying which tree it read and which it did not.
 *
 * @param landingBranch the branch the queue lands on
 * @returns the line
 * @internal exported for the verb's tests.
 */
export function prospectiveTreeLine({ landingBranch }: { landingBranch: string }): string {
  return (
    `private terms: prospective tree only — the pinned head merged into ${landingBranch} as just fetched; ` +
    "the merge group the queue builds later is not checked"
  );
}

/** What the preflight printed, whether it refuses the press, and the waiver rows it adds to the door's. */
interface EnqueuePrivateTermsStep {
  readonly acknowledgements: readonly DoorAcknowledgement[];
  readonly lines: readonly string[];
  readonly refused: boolean;
}

/**
 * Fetch the landing branch, sweep the prospective tree and decide whether the enqueue may go ahead — on a press the
 * verdict lets proceed, a dry run included. `--dequeue`, a refused verdict and an already-queued pull request read
 * nothing: none of them puts a tree in the queue.
 *
 * @param args the parsed invocation, for the repository and what it acknowledged
 * @param home the state home holding the private terms
 * @param pr the pull request as GitHub just answered it, for its head branch and pinned head commit
 * @param proceeds whether the queue verdict lets this invocation go ahead
 * @param target the landing branch the queue lives on (`./enqueueTarget.ts`)
 * @returns the lines (each judged against the loaded terms), whether the press is refused, and its waiver rows
 */
export function enqueuePrivateTermsStep({
  args,
  deps,
  home,
  pr,
  proceeds,
  target,
}: {
  args: GithubEnqueueArgs;
  deps: EnqueuePrivateTermsDeps;
  home: string;
  pr: MergeQueuePrState;
  proceeds: boolean;
  target: EnqueueTarget;
}): EnqueuePrivateTermsStep {
  if (args.dequeue || !proceeds) {
    return { acknowledgements: [], lines: [], refused: false };
  }
  const landingBranch = target.branch;
  const cwd = deps.cwd();
  const measurement = deps.measureBaseFreshness({
    cwd,
    remote: LANDING_REMOTE,
    target: { base: landingBranch, head: pr.headRefName, owner: args.owner, repo: args.repo },
  });
  const verdict = deps.sweepPrivateTerms({
    base: enqueueLandingBase({ landingBranch, measurement }),
    headSha: pr.headOid,
    home,
    repoRoot: cwd,
  });
  const acknowledgement: BaseFreshnessAcknowledgement = {
    acknowledge: args.acknowledge,
    acknowledgeAll: args.acknowledgeAll,
    reason: args.reason,
  };
  const permit = privateTermsPermit({ acknowledgement, verdict });
  return {
    acknowledgements: permit.acknowledgement === undefined ? [] : [permit.acknowledgement],
    lines: printableReportLines({
      lines: [prospectiveTreeLine({ landingBranch }), ...permit.lines],
      terms: verdict.terms,
    }),
    refused: permit.refused,
  };
}
