/**
 * WHICH MONITOR A NOTE SPEAKS FOR, AND WHICH KIND ANSWERS IT OFFERS — the pure half of "Never for this kind" and
 * "When it gets worse" (`../hand/kindAnswers.ts`).
 *
 * A step is a monitor's card only when it carries the settling command every monitor card carries
 * ({@link MONITOR_WITNESS}) AND its id opens with that monitor's `mon-<prefix>-`. Both, because a `mon-` id alone is
 * a string any session could post, and a mute keyed off a guess would silence a kind the owner never pressed on.
 */
import type { KindAnswerOffer } from "../hand/kindAnswers.js";
import { type HandStep, MONITOR_WITNESS } from "../hand/step.js";

import { MONITOR_STEP_PREFIX, MONITORS, type MonitorDefinition, occurrenceBase } from "./registry.js";
import type { MonitorSubject } from "./types.js";

/**
 * The monitor whose card a step is, or `undefined` when it is no monitor's card. The longest matching prefix wins,
 * so one prefix that opens another (`sign` beside `signin`) can never claim the other's card.
 *
 * @param step the step a note is about to draw, or a kind answer was pressed on
 * @returns the monitor's declaration, or undefined
 */
export function monitorOfStep({ step }: { step: Pick<HandStep, "id" | "witness"> }): MonitorDefinition | undefined {
  if (step.witness !== MONITOR_WITNESS) {
    return undefined;
  }
  return monitorOfStepId({ id: step.id });
}

/**
 * The monitor a `mon-<prefix>-<key>` id names by its prefix alone — for a marker whose step the caller has already
 * checked is a monitor card, or for an id read off disk beside one. {@link monitorOfStep} is the gate.
 *
 * @param id a step id, any occurrence of its base
 * @returns the monitor's declaration, or undefined when no declared prefix opens it
 */
export function monitorOfStepId({ id }: { id: string }): MonitorDefinition | undefined {
  const base = occurrenceBase({ id });
  const matching = MONITORS.filter((monitor) => base.startsWith(`${MONITOR_STEP_PREFIX}${monitor.prefix}-`));
  return matching.toSorted((a, b) => b.prefix.length - a.prefix.length)[0];
}

/**
 * Which kind answers one step's note offers.
 *
 * "Never for this kind" is refused for a NOTICE kind: a notice appears on no list, so its note is its only delivery,
 * and muting it would lose the thing entirely rather than quiet it. "When it gets worse" is offered only where the
 * monitor declares `worsens`. A step no monitor speaks for offers neither.
 *
 * @param step the step the note draws
 * @returns the offer the note's More… page draws
 */
export function kindAnswerOffer({ step }: { step: Pick<HandStep, "id" | "witness"> }): KindAnswerOffer {
  const definition = monitorOfStep({ step });
  if (definition === undefined) {
    return { muteKind: false, whenWorse: false };
  }
  return { muteKind: definition.notice === undefined, whenWorse: definition.worsens !== undefined };
}

/**
 * One subject's measure under its monitor's `worsens`, or `undefined` when the monitor declares none or the subject
 * carries none.
 *
 * @param definition the monitor speaking
 * @param subject the subject read this pass
 * @returns the measure
 */
export function worsenMeasure({
  definition,
  subject,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
}): number | undefined {
  if (definition.worsens === undefined) {
    return undefined;
  }
  return definition.worsens.measure({ subject });
}

/**
 * Whether a measure is STRICTLY worse than the baseline it is held against. Equal is not worse: a reading that
 * merely stands still must never bring a note back the owner asked to keep down until it got worse.
 *
 * @param direction which way is worse for this monitor
 * @param baseline the measure recorded when the hold took effect
 * @param measure the measure read now
 * @returns true when the note should come back
 */
export function isWorse({
  direction,
  baseline,
  measure,
}: {
  direction: "higher" | "lower";
  baseline: number;
  measure: number;
}): boolean {
  if (direction === "higher") {
    return measure > baseline;
  }
  return measure < baseline;
}
