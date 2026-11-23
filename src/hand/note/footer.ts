/**
 * The note's footer line — what doing nothing costs the owner when the step says, else what waits on it.
 *
 * The line under a card says what happens if the owner does nothing, because that is how they rank it. The panel program draws
 * this text in the slot it has always drawn `unblocks` in, so the program — and every live note's build digest — is
 * unchanged.
 */
import type { HandStep } from "../step.js";

/** What the footer opens with when it carries the do-nothing line, so it never reads as what the step unblocks. */
const IF_IGNORED_LEAD = "If you do nothing: ";

/**
 * The footer line the note draws for one step.
 *
 * @param step the step the note is raised for
 * @returns the do-nothing line, led as one, or the step's `unblocks` when it carries none
 */
export function noteFooter({ step }: { step: Pick<HandStep, "ifIgnored" | "unblocks"> }): string {
  if (step.ifIgnored !== undefined) {
    return `${IF_IGNORED_LEAD}${step.ifIgnored}`;
  }
  return step.unblocks;
}
