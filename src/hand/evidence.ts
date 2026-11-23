/**
 * A HAND STEP LEAVES WHEN ITS WORK IS DONE — the pure verdict evidence retraction runs on.
 *
 * A card stood first on the owner's queue for three hours after the row it waited on had closed, and the owner met it again
 * after already acting on it, which wasted their time. Nothing read whether what a card was waiting on had finished. A step that names its row
 * (`hand post --row <slug>`) now settles the moment that row derives one of the board's own terminal statuses,
 * written as a settling no hand touched.
 *
 * The board's vocabulary and no other: `isTerminalDocStatus` — `done`, `cancelled`, `rejected`. An archived doc
 * is a location, a settled ask is already one of those three, and a row that did not read whole never reaches
 * this function (`../handover/rowState.ts`).
 */
import { type DocStatus, isTerminalDocStatus } from "../handover/doc.js";

import type { HandStep } from "./step.js";

/** What evidence does to one open step: nothing, or settle it with this account. */
export type EvidenceRetractionVerdict = { readonly kind: "keep" } | { readonly kind: "settle"; readonly did: string };

/**
 * Whether one open step's named row has finished, and what the settling says if it has.
 *
 * @param step the open step
 * @param status the status the board derives for the row it names
 * @returns `settle` with the account when the step names a row now terminal, `keep` otherwise
 */
export function evidenceRetractionVerdict({
  step,
  status,
}: {
  step: HandStep;
  status: DocStatus;
}): EvidenceRetractionVerdict {
  if (step.row === undefined || !isTerminalDocStatus(status)) {
    return { kind: "keep" };
  }
  return { did: `retracted by evidence — row ${step.row} is ${status}, no hand touched it`, kind: "settle" };
}
