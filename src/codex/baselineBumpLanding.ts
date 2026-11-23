/**
 * What landing would produce, measured: choose a checkout holding both commits, build the merge commit the landing
 * verb would make, and compare main's baselines against it. The comparison runs HERE, in the landing verb's own
 * code, rather than trusting CI's gate: CI runs the pull request's own copy of that gate, which the same pull
 * request could neuter. The read that asks what records cover the result is `./baselineBumpWitnessRun.ts`.
 */

import { type BaselineComparison, compareAgainstBase } from "../devLint/baselineComparison.js";
import { type CandidateCheckoutRoots, candidateMerge, rootHoldingBoth } from "./baselineBumpCheckouts.js";
import type { PullRequestHead } from "./landingGate.js";

/** Why nothing could be measured, in the shape the landing read refuses with. */
interface LandingRefusal {
  readonly kind: "refused";
  readonly details: readonly string[];
}

/** The checkout chosen, the merge commit landing would produce and what it loosens against the base. */
interface MeasuredLanding {
  readonly kind: "measured";
  readonly root: string;
  readonly candidate: string;
  readonly comparison: BaselineComparison;
}

/**
 * Measure the tree landing would produce. IO edge.
 *
 * @param baseSha the pull request's base commit
 * @param candidates every checkout considered, of any repository, and the verb's own
 * @param head the pull request being landed
 * @returns the checkout, the candidate merge and what it loosens, or the refusal naming what could not be read
 */
export function measureLanding({
  baseSha,
  candidates,
  head,
}: {
  baseSha: string;
  candidates: CandidateCheckoutRoots;
  head: PullRequestHead;
}): LandingRefusal | MeasuredLanding {
  const chosen = rootHoldingBoth({
    commits: [baseSha, head.headSha],
    repository: head.repository,
    roots: candidates.roots,
  });
  if (chosen.kind === "missing") {
    return {
      details: [
        `none of the ${String(chosen.repositoryCheckouts)} checkout(s) of ${head.repository} here is a full-history ` +
          `checkout holding base ${baseSha} and head ${head.headSha}, and fetching them from origin did not supply both`,
      ],
      kind: "refused",
    };
  }
  const root = chosen.root;
  const candidate = candidateMerge({ base: baseSha, head: head.headSha, root });
  if (candidate === undefined) {
    return {
      details: [
        `the pull request does not merge cleanly onto base ${baseSha.slice(0, 12)}, so the tree it would land ` +
          "cannot be judged — rebase it",
      ],
      kind: "refused",
    };
  }
  const compared = compareAgainstBase({ base: baseSha, head: candidate, root });
  if (compared.isErr()) {
    return {
      details: [`the baselines could not be compared against the base: ${compared.error.message}`],
      kind: "refused",
    };
  }
  return { candidate, comparison: compared.value, kind: "measured", root };
}
