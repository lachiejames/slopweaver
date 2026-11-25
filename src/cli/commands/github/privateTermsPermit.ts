/**
 * Whether a landing may go ahead on its change set's private-terms verdict (`../../../hygiene/changeSetPrivateTerms.ts`),
 * and the lines that say so.
 *
 * A `hold` refuses whatever was acknowledged — a private term on a line about to be published is not a finding a
 * caller can accept. An `unchecked` verdict refuses unless the landing verb (`github merge --admin`, `github
 * enqueue`) names {@link PRIVATE_TERMS_UNCHECKED_ACK} itself WITH a `--reason` — `--acknowledge-all` never reaches
 * it, since a blanket flag must not pass a finding that means no scan ran — and that waiver is handed back for the
 * door ledger, so a machine with no terms file says so on every landing and lands only on a recorded
 * acknowledgement. A reason a loaded term matches waives nothing, since the ledger would keep it. `clean` proceeds. Every line, the refusal's included, is judged against the loaded terms.
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

/**
 * Why a named waiver did not count when its `--reason` matches a private term: the ledger would keep the word.
 *
 * @internal named by this module and its tests.
 */
export const REASON_NAMES_A_TERM_LINE =
  "private terms: the --reason given for private-terms-unchecked matches a private term, and the door ledger " +
  "records a reason verbatim, so this waiver does not count; reword the reason and land again";

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
  // By name only: `--acknowledge-all` waives findings the caller has read, and this one says no read happened.
  const named = acknowledgement.acknowledge.includes(PRIVATE_TERMS_UNCHECKED_ACK);
  const reason = acknowledgement.reason?.trim();
  // The door ledger keeps a reason verbatim, out of any line filter's reach: one a term matches waives nothing. Both
  // spellings are judged, since a pattern can match the typed reason and not its trimmed copy, or the reverse.
  const recordable = [acknowledgement.reason, reason].every(
    (text) => text === undefined || printableReportLines({ lines: [text], terms: verdict.terms })[0] === text,
  );
  if (named && reason !== undefined && reason.length > 0 && recordable) {
    lines.push(`ACKNOWLEDGED: ${PRIVATE_TERMS_UNCHECKED_ACK} by name — reason: ${reason}`);
    return {
      acknowledgement: { reason, subject: PRIVATE_TERMS_UNCHECKED_ACK },
      lines: printableReportLines({ lines, terms: verdict.terms }),
      refused: false,
    };
  }
  if (named && !recordable) {
    lines.push(REASON_NAMES_A_TERM_LINE);
  }
  const refusal = hatchRefusalLines({ detail: verdict.detail, hatch: hatchFor({ id: PRIVATE_TERMS_UNCHECKED_ACK }) });
  return {
    acknowledgement: undefined,
    lines: printableReportLines({ lines: [...lines, ...refusal], terms: verdict.terms }),
    refused: true,
  };
}
