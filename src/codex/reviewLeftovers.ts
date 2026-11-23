/**
 * Review leftovers — how a change past its second Codex review pass lands with a finding still standing.
 *
 * The owner's ruling: at most two review passes (`./reviewPassCap.ts` says what a pass is). A CURRENT `BROKEN`
 * review past the second pass is a {@link ReviewLeftover}, and it stays a `codex-loop-incomplete` finding on both
 * landing verbs (`./landingGate.ts`): the change lands only once the operator acknowledges that subject with a
 * `--reason` saying why it lands anyway, and that reason is written to the door ledger.
 *
 * A pull-request description never carries a leftover. The C3 form publishes none, so nothing here reads a body:
 * the ledger row is the record, and the acknowledgement is the decision.
 *
 * Pure.
 */

import type { LedgerEntry } from "./ledger.js";

/** One CURRENT `BROKEN` review the change is landing with. */
export interface ReviewLeftover {
  readonly artifactId: string;
  readonly pass: string;
  /** The property the review attacked — `unknown` only for a row that recorded none, which a review never does. */
  readonly propertyId: string;
  /** The review's own summary of what broke, when it answered with one. */
  readonly summary: string | undefined;
}

/**
 * A ledger row as the leftover it is.
 *
 * @param entry a CURRENT `BROKEN` review row
 * @returns the leftover a landing verb reports
 */
export function leftoverOf({ entry }: { entry: LedgerEntry }): ReviewLeftover {
  return {
    artifactId: entry.artifactId,
    pass: entry.pass,
    propertyId: namedProperty({ propertyId: entry.propertyId }),
    summary: entry.reviewSummary,
  };
}

/**
 * The property a leftover names: a row recorded before property ids were kept carries none, and its line reads
 * `unknown` rather than omitting the field.
 *
 * @param propertyId the row's property id, absent on a row that predates them
 * @returns the id, or `unknown` when the row carries none
 */
function namedProperty({ propertyId }: { propertyId: string | undefined }): string {
  if (propertyId === undefined) {
    return "unknown";
  }
  return propertyId;
}

/**
 * The one line naming a leftover: which row, which pass and property, and the review's own summary.
 *
 * @param leftover the leftover to name
 * @returns the line, plain text
 */
export function leftoverLine({ leftover }: { leftover: ReviewLeftover }): string {
  const summary =
    leftover.summary === undefined ? "the review recorded no summary" : leftover.summary.replace(/\s+/g, " ").trim();
  return `${leftover.pass}/${leftover.propertyId} (${leftover.artifactId}): ${summary}`;
}

/**
 * The finding detail for each leftover: it is still standing, and the acknowledgement that lands it.
 *
 * @param leftovers what the floor says the change is landing with
 * @returns one detail line per leftover; empty when there are none
 */
export function leftoverFailures({ leftovers }: { leftovers: readonly ReviewLeftover[] }): readonly string[] {
  return leftovers.map(
    (leftover) =>
      `${leftoverLine({ leftover })} is CURRENT and BROKEN after the second and last review pass — land it with ` +
      `--acknowledge codex-loop-incomplete --reason "<why it lands with this standing>"`,
  );
}
