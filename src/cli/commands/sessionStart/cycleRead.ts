/**
 * The cycle leg's one effectful read: a whole `slopweaver cycle reconcile` pass, consumed rather than
 * rebuilt.
 *
 * ## A leg that cannot run does not take the list down with it
 *
 * The pass needs Linear bronze, a structures lane and an identity map, and a home missing any of them is an
 * ordinary state rather than a broken one. So a refusal is carried back as itself — the typed
 * {@link ../../../cycle/errors.CycleError} — and the verb prints the board's rows plus the reason this leg
 * is absent.
 *
 * That is deliberately NOT a quiet degrade. The defect class it is avoiding is the one `slopweaver audit
 * run` shipped: a read that refused, turned into an empty result by a `: []`, printed as `0 records` beside
 * a report that said 7.7 GB. The difference is that the reason travels with the empty answer and reaches
 * the reader, and that a test can assert the refusal without matching prose.
 */

import type { CycleError } from "../../../cycle/errors.js";
import { cycleLeg } from "../../../sessionStart/cycleLeg.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import type { IdentityRosterPort } from "../../../silver/identityRoster.js";
import { reconcilePass } from "../cycle/pass.js";

/**
 * What one cycle read produced, including why it produced nothing when it did.
 *
 * @internal the contract between this read and the verb's own shell.
 */
export interface CycleRead {
  /** The proposals, already mapped to ranker input. */
  readonly inputs: readonly RankInput[];
  /** How many proposals the pass made, so the verb can say what fraction became rows. */
  readonly proposalsRead: number;
  /** What the pass itself could not see, carried through verbatim. */
  readonly couldNotSee: readonly string[];
  /** The typed reason the leg produced nothing, present ONLY when the pass could not run at all. */
  readonly refusal?: CycleError;
}

/** How the reconcile pass is run — the real `cycle reconcile` pass in production, a fake in a test. */
export type CycleProposalReader = typeof reconcilePass;

/**
 * Run a reconcile pass and turn its proposals into ranker input.
 *
 * @param home the state home to read
 * @param identityRoster the store's identity roster, which the pass reads once for the owner check
 * @param nowIso the run's own instant, supplied rather than read
 * @param verify whether the pass re-reads its unresolved pull requests live through the door
 * @param readPass how the pass is run; omitted, the real reconcile pass
 * @returns the leg's input, or an empty leg carrying the typed reason it could not run
 */
export async function readCycleProposals({
  home,
  identityRoster,
  nowIso,
  verify,
  readPass = reconcilePass,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
  nowIso: string;
  verify: boolean;
  readPass?: CycleProposalReader;
}): Promise<CycleRead> {
  const pass = await readPass({ home, identityRoster, nowIso, verify });
  if (pass.isErr()) {
    return {
      couldNotSee: [`the cycle leg could not run, so nothing from your Linear cycle is here: ${pass.error.message}`],
      inputs: [],
      proposalsRead: 0,
      refusal: pass.error,
    };
  }
  const report = pass.value;
  return {
    couldNotSee: report.couldNotSee,
    inputs: cycleLeg({ nowIso, proposals: report.proposals, verified: verify }),
    proposalsRead: report.proposals.length,
  };
}
