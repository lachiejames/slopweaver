/**
 * The EXPLICIT STEER half of `handover rule`: reading `--explicit-steer` / `--deliver-by` into the shape a ruling
 * carries, and what the verb says and fires once one is recorded.
 *
 * An explicit steer from the owner overrides every standing rule and memory for that instance, and a steered
 * deliverable at risk reaches the owner early, never at the deadline
 * (`docs/doctrine-rationale/explicit-steer.md`). Its own module so `./ruleRun.ts` stays one ruling's verb.
 */
import type { ExplicitSteer } from "../../../handover/explicitSteerTypes.js";
import { isCanonicalInstant } from "../../../handover/ruling.js";
import { logger } from "../../../lib/logger.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { fireSteerAtRiskIfSteered } from "./steerRiskCard.js";

/**
 * The explicit steer one invocation declares, `undefined` when it declares none, or the refusal to print.
 *
 * @param values the parsed flags, read for `explicit-steer` and `deliver-by`
 * @returns the steer, `undefined` for an ordinary ruling, or why the flags are refused
 */
export function explicitSteerPlan({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | { readonly explicitSteer: ExplicitSteer | undefined } {
  const deliverBy = typeof values["deliver-by"] === "string" ? values["deliver-by"].trim() : "";
  if (values["explicit-steer"] !== true) {
    if (deliverBy.length > 0) {
      return { refusal: "--deliver-by names when an EXPLICIT STEER is due — pass --explicit-steer with it" };
    }
    return { explicitSteer: undefined };
  }
  if (deliverBy.length === 0) {
    return { explicitSteer: {} };
  }
  if (!isCanonicalInstant({ iso: deliverBy })) {
    return {
      refusal:
        `--deliver-by "${deliverBy}" is not a canonical UTC instant (YYYY-MM-DDTHH:MM:SS.sssZ, as toISOString() ` +
        "writes it) — the steer-at-risk monitor compares it exactly",
    };
  }
  return { explicitSteer: { deliverByIso: deliverBy } };
}

/**
 * Fire `steer-at-risk` for a row the owner's explicit steer was just recorded on: a steer given over a row already at risk —
 * parked, waiting on the owner — is at risk the moment it is recorded. The verb calls this straight after the append and
 * before any receipt line, so an output channel that fails cannot stop the note it owes the owner.
 *
 * @param home the state home the row's journal and the hand register live under
 * @param slug the steered row
 */
export async function escalateExplicitSteer({ home, slug }: { home: string; slug: string }): Promise<void> {
  await fireSteerAtRiskIfSteered({ deps: productionMonitorDeps(), home, slug, verb: "handover rule" });
}

/**
 * Say a recorded ruling is the owner's explicit steer, and what now watches it.
 *
 * @param explicitSteer the steer just recorded
 */
export function announceExplicitSteer({ explicitSteer }: { explicitSteer: ExplicitSteer }): void {
  const due = explicitSteer.deliverByIso;
  logger.out({
    line:
      `  it is the owner's EXPLICIT STEER${due === undefined ? "" : `, due ${due}`}: the standing rules yield for this ` +
      "row's instance, and `steer-at-risk` watches it — the seat names any risk at once with `handover risk`",
  });
}
