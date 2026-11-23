/**
 * The door request one Gmail mutation makes. Split from `./modifyRun.ts`, which routes it.
 */
import type { throughDoor } from "../../../admit/effects.js";
import type { GmailModifyPlan } from "../../../live/gmail/modify.js";

/**
 * The door request one Gmail mutation makes.
 *
 * The artifact carries IDS AND LABELS ONLY — never a subject, a sender or a body. The artifact is the input
 * every gate reads, and a door record that stored it would inherit whatever is put here. Building it clean is
 * what makes both true at once, and a record of what changed does not need to know what the mail said.
 *
 * @param plan the planned label change for one id
 * @param home the state home the decision is journalled into
 * @returns the request the door judges
 */
export function modifyDoorRequest({
  plan,
  home,
}: {
  plan: GmailModifyPlan;
  home: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    // `split` always answers at least one element, so index 0 is present even for an empty intent.
    action: { kind: "verb", noun: "gmail", verb: plan.intent.split(" ")[0]! },
    artifact: {
      addLabelIds: plan.plan.addLabelIds,
      address: plan.address,
      messages: plan.before.length,
      removeLabelIds: plan.plan.removeLabelIds,
      scope: plan.scope,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
