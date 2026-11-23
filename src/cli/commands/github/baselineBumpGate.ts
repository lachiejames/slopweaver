/**
 * The ratchet-bump witness as both landing verbs' last check before their mutation (`github enqueue` and
 * `github merge --admin`), rendered once so the two can never word the hold differently.
 *
 * `baseline-bump-unwitnessed` is a HOLD, not a finding: no `--acknowledge` subject and no `--acknowledge-all`
 * reaches it, because the owner's rule is that loosening a ratchet against main needs an
 * independent Codex witness and never the implementing session's own word. So nothing here reads the
 * invocation's acknowledgements, and the last line says there is no override and what to do instead.
 */

import { BASELINE_BUMP_SUBJECT, baselineBumpHoldLine } from "../../../codex/baselineBumpWitness.js";
import type { BaselineBumpWitnessReader } from "../../../codex/baselineBumpWitnessRun.js";
import type { PullRequestHead } from "../../../codex/landingGate.js";

/**
 * Read the witness for one pull request and render its refusal.
 *
 * @param cwd the checkout the verb runs in
 * @param head the pull request being landed, its base commit included
 * @param home the state home holding the pass records
 * @param landingBranch the branch a native stack lands on when it is not this pull request's own base, so the
 *   read judges against that branch's tip; `undefined` judges against the pull request's own base
 * @param read the verb's witness seam
 * @returns the refusal lines, each for the verb to print behind its own `refused: ` prefix, or an empty list
 *   when every bump manifest is witnessed
 */
export async function baselineBumpRefusal({
  cwd,
  head,
  home,
  landingBranch,
  read,
}: {
  cwd: string;
  head: PullRequestHead;
  home: string;
  landingBranch: string | undefined;
  read: BaselineBumpWitnessReader;
}): Promise<readonly string[]> {
  const verdict = await read({ cwd, head, home, landingBranch });
  if (verdict.kind === "clear") {
    return [];
  }
  return [...verdict.details.map((detail) => `${BASELINE_BUMP_SUBJECT}: ${detail}`), baselineBumpHoldLine()];
}
