/**
 * Decoding the planning loop's lines of a turn's progress log — a stage's step and writer, a declared plan, a
 * review round. Split from `./progressLog.ts`, which owns the file and the fold, so that module stays one a
 * reader can hold; the event SHAPES stay there beside every other kind.
 */

import type { ProgressPlanEvent, ProgressReviewEvent, ProgressStageEvent } from "./progressLog.js";

/**
 * Decode a `stage` line, keeping its optional step and writer only when each is well-formed. A malformed
 * optional field is DROPPED rather than failing the line: the stage's text is still what the reader saw, and
 * losing a finding over a bad annotation would be the worse failure.
 *
 * @param record the decoded JSON object
 * @param text its already-validated text
 * @param tsIso its already-validated instant
 * @returns the stage
 */
export function decodeStageRecord({
  record,
  text,
  tsIso,
}: {
  record: Record<string, unknown>;
  text: string;
  tsIso: string;
}): ProgressStageEvent {
  const { step, worker } = record;
  const validStep = typeof step === "number" && Number.isInteger(step) && step >= 1;
  const validWorker = typeof worker === "string" && worker.length > 0;
  return {
    kind: "stage",
    text,
    tsIso,
    ...(validStep ? { step } : {}),
    ...(validWorker ? { worker } : {}),
  };
}

/**
 * Decode a `plan` or `review` line. A plan with no readable step, or a round that is not a positive integer,
 * is unreadable rather than a guess: an outline drawn from half a plan would show a fraction that is false.
 *
 * @param record the decoded JSON object
 * @param tsIso its already-validated instant
 * @returns the event, or `undefined` when the line is not a well-formed one
 */
export function decodeLoopRecord({
  record,
  tsIso,
}: {
  record: Record<string, unknown>;
  tsIso: string;
}): ProgressPlanEvent | ProgressReviewEvent | undefined {
  const { round, steps } = record;
  if (record["kind"] === "review") {
    return typeof round === "number" && Number.isInteger(round) && round >= 1
      ? { kind: "review", round, tsIso }
      : undefined;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return undefined;
  }
  const texts = steps.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return texts.length === steps.length ? { kind: "plan", steps: texts, tsIso } : undefined;
}
