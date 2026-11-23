/**
 * The small line above a floating note's sentence. A check-in says it is one, so a note the fleet raised to
 * ask "was this right?" never reads as work stopped on the owner — the note states what the one ranking of what
 * waits on the owner (`../../waiting/rank.ts`) already decided.
 */

import type { HandStep } from "../step.js";

/**
 * The line above a note's sentence — ONE STEP for work stopped on the owner, CHECK-IN for a step its poster said is
 * an evaluation.
 *
 * @param step the validated step to draw
 * @returns the eyebrow text
 */
export function noteEyebrow({ step }: { step: HandStep }): string {
  if (step.checkIn === true) {
    return "SLOPWEAVER · CHECK-IN";
  }
  return "SLOPWEAVER · ONE STEP";
}
