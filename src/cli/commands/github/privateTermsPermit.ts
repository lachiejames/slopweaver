/**
 * Whether a landing may go ahead on its change set's private-terms verdict (`../../../hygiene/changeSetPrivateTerms.ts`),
 * and the lines that say so.
 *
 * A `hold` refuses whatever was acknowledged — a private term on a line about to be published is not a finding a
 * caller can accept. An `unchecked` verdict refuses unless `github merge --admin` names
 * {@link PRIVATE_TERMS_UNCHECKED_ACK} (or passes `--acknowledge-all`) WITH a `--reason`, and that waiver is handed
 * back for the door ledger, so a machine with no terms file says so on every landing and lands only on a recorded
 * acknowledgement. `clean` proceeds. Every line, the refusal's included, is judged against the loaded terms.
 */

import type { DoorAcknowledgement } from "../../../admit/types.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import {
  type ChangeSetPrivateTermsVerdict,
  changeSetPrivateTermsLines,
  type LandingBase,
} from "../../../hygiene/changeSetPrivateTerms.js";
import { printableReportLines } from "../../../hygiene/repositoryPrivateTerms.js";
import type { BaseFreshness, BaseFreshnessAcknowledgement } from "./baseFreshnessCore.js";
import type { GithubVerbResult } from "./errors.js";

/** The acknowledgement subject naming a landing whose change set the private terms did not check. */
export const PRIVATE_TERMS_UNCHECKED_ACK = "private-terms-unchecked";

/** What the landing prints for its change set, whether it stops, and the waiver the door records when one stood. */
export interface PrivateTermsPermit {
  readonly acknowledgement: DoorAcknowledgement | undefined;
  readonly lines: readonly string[];
  readonly refused: boolean;
}

/**
 * Pure: the base the change set is swept against — the tip the landing just FETCHED, never whatever the local
 * checkout knew, so a base that moved since the branch was pushed is the base the terms read against.
 *
 * A measurement that failed or was skipped names no fetched base; the sweep still loads the terms for it, so the
 * verdict is a hold on an unreadable terms file and `unchecked` otherwise, and every line is judged against them.
 *
 * @param measurement the landing's own base-freshness measurement
 * @returns the fetched base commit, or why there is none
 */
export function landingBaseOf({ measurement }: { measurement: GithubVerbResult<BaseFreshness> }): LandingBase {
  if (measurement.isErr()) {
    return { detail: "the base was not measured, so no merged change set exists to read", kind: "unfetched" };
  }
  if (measurement.value.kind === "skipped") {
    return {
      detail: `the base was not fetched (${measurement.value.why}), so no merged change set exists to read`,
      kind: "unfetched",
    };
  }
  return { kind: "fetched", sha: measurement.value.baseSha };
}

/**
 * Pure: decide whether the landing may proceed on this verdict, and render every line it prints.
 *
 * @param verdict the change set's private-terms verdict
 * @param acknowledgement what the caller accepted on the command line
 * @returns the lines, each judged against the loaded terms, and whether the landing is refused
 */
export function privateTermsPermit({
  verdict,
  acknowledgement,
}: {
  verdict: ChangeSetPrivateTermsVerdict;
  acknowledgement: BaseFreshnessAcknowledgement;
}): PrivateTermsPermit {
  const lines = [...changeSetPrivateTermsLines({ verdict })];
  if (verdict.kind === "clean") {
    return { acknowledgement: undefined, lines, refused: false };
  }
  if (verdict.kind === "hold") {
    return { acknowledgement: undefined, lines, refused: true };
  }
  const named = acknowledgement.acknowledge.includes(PRIVATE_TERMS_UNCHECKED_ACK);
  const reason = acknowledgement.reason?.trim();
  if ((named || acknowledgement.acknowledgeAll) && reason !== undefined && reason.length > 0) {
    const how = named ? "by name" : "with --acknowledge-all";
    lines.push(`ACKNOWLEDGED: ${PRIVATE_TERMS_UNCHECKED_ACK} ${how} — reason: ${reason}`);
    return {
      acknowledgement: { reason, subject: PRIVATE_TERMS_UNCHECKED_ACK },
      lines: printableReportLines({ lines, terms: verdict.terms }),
      refused: false,
    };
  }
  const refusal = hatchRefusalLines({ detail: verdict.detail, hatch: hatchFor({ id: PRIVATE_TERMS_UNCHECKED_ACK }) });
  return {
    acknowledgement: undefined,
    lines: printableReportLines({ lines: [...lines, ...refusal], terms: verdict.terms }),
    refused: true,
  };
}
