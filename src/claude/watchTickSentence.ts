/**
 * What one watch tick SAYS: the plan it would move to, and the one sentence the tick line and the JSON record both
 * carry. Pure and separate from `./watchTick.ts`, which decides; this module only words what was decided.
 */
import type { TriggerOutcome } from "./trigger.js";
import type { ActiveFrom } from "./watchTickActiveSlot.js";

/**
 * The plan the trigger would move to, when it named one.
 *
 * A `rotate` outcome does NOT guarantee a target: selection answers `all-exhausted` when every plan is
 * spent, and flattening that into "no rotation" would lose the one fact the owner needs, which is when the
 * fleet comes back.
 *
 * @param outcome what the trigger concluded
 * @returns the alias to move to, or undefined
 */
export function rotateTarget({ outcome }: { outcome: TriggerOutcome }): string | undefined {
  if (outcome.act !== "rotate" || outcome.decision.kind !== "rotate") {
    return undefined;
  }
  return outcome.decision.to;
}

/**
 * The one sentence a tick prints.
 *
 * @param active the plan the fleet is on, when either source answered
 * @param activeFrom which source answered, since not naming a plan has two different causes to report
 * @param activeSlotExpiryIso when the active slot's credential expired, so a dead-slot tick names the
 *   instant rather than leaving a reader to go and find it
 * @param outcome what the trigger concluded
 * @param target the plan it would move to, when it named one
 * @returns the sentence naming what the tick concluded
 */
export function tickSentence({
  active,
  activeFrom,
  activeSlotExpiryIso,
  outcome,
  target,
}: {
  active?: string;
  activeFrom: ActiveFrom;
  activeSlotExpiryIso?: string;
  outcome: TriggerOutcome;
  target?: string;
}): string {
  if (target !== undefined) {
    // "RECOMMENDING", not "rotating". The credential copy is retired, so a tick performs no rotation at all and
    // this sentence reaches both the human report and the JSON record. A review found it still
    // claiming the act: a field nothing reads can quietly stop being true, and a sentence everything reads is
    // worse, because it is the line a reader believes.
    return `RECOMMENDING ${target} as the plan to boot against — ${outcome.why}`;
  }
  if (outcome.act === "rotate") {
    return `every plan is spent, so there is nothing to rotate onto — ${outcome.why}`;
  }
  if (outcome.act === "downgrade-model") {
    return `the plan is healthy and one model on it is spent — ${outcome.why}`;
  }
  if (activeFrom === "none") {
    return deadSlotSentence({ activeSlotExpiryIso });
  }
  if (active === undefined) {
    return "no plan could be identified as active, so there is nothing to hold or move";
  }
  return outcome.why;
}

/**
 * The sentence a tick prints when the ACTIVE slot holds nothing a session could present.
 *
 * It says the CAUSE, not just the effect, because seven days of "no plan could be identified as active"
 * told a reader only that the loop was stuck — never that a credential had expired on a nameable date, and
 * never that this is the harmless case rather than the dangerous one. No remedy is named on purpose: the
 * credential copy is retired and a session spends a plan by being booted against its STORE, so a dead
 * default slot costs the fleet nothing and there is nothing here for the owner to go and do.
 *
 * @param activeSlotExpiryIso when it expired, undefined when the slot held no readable credential at all
 * @returns the sentence
 */
function deadSlotSentence({ activeSlotExpiryIso }: { activeSlotExpiryIso: string | undefined }): string {
  const held =
    activeSlotExpiryIso === undefined
      ? "the active slot holds no usable credential"
      : `the active slot's credential expired ${activeSlotExpiryIso}`;
  // "not held back on that account" rather than "every store is free to refresh": the byte-comparison guard
  // survives a dead slot (review pass r1), so a store sharing its credential is still skipped and prints its
  // own reason. A sentence claiming the stronger thing would be false exactly when that guard fires.
  return (
    `${held}, so no session is authenticating with it and there is no active plan to hold or move — ` +
    `keep-alive is not held back on that account`
  );
}
