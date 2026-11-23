/**
 * One button, chosen by a fixed order. When several refusals stand at once the page offers ONE action: Automation
 * consent, then opening cmux, then a sign-in, then a policy override. Every other refusal stays visible as detail
 * without a competing button. The reasons themselves are mapped in `./refusals.ts`.
 *
 * Pure: values in, values out.
 */
import type { FleetHandStep, FleetReason } from "./types.js";

/** Which hand-step kind wins when several refusals offer one — the order in this module's header. */
const HAND_STEP_ORDER: readonly FleetHandStep["action"]["kind"][] = [
  "automation-consent",
  "open-cmux",
  "claude-signin",
  "policy-override",
];

/**
 * The headline reason among several: the one whose button wins the fixed order, else the first.
 *
 * @param reasons every mapped reason, in the order recovery recorded them
 * @returns the headline, or `undefined` when there are none
 */
export function headlineReason({ reasons }: { reasons: readonly FleetReason[] }): FleetReason | undefined {
  for (const kind of HAND_STEP_ORDER) {
    const found = reasons.find((reason) => reason.handStep?.action.kind === kind);
    if (found !== undefined) {
      return found;
    }
  }
  return reasons[0];
}
