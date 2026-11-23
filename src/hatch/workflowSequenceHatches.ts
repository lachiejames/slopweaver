/**
 * The escape-hatch rows for a step taken out of SEQUENCE — an automation run past its deadline, a review
 * round after a clean verdict, and review round 1 opened over a thread that moved past the draft's read.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly before
 * the Datadog monitor rows. Add a row for a new sequencing refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on a step taken out of sequence, in register order. */
export const WORKFLOW_SEQUENCE_HATCHES = [
  {
    caught:
      "a deadline would kill this firing mid-effect — run-due performs a verb-run row itself, in a verb child it awaits, and its destination takes no idempotency key, so a killed run dead-letters OUTCOME_UNKNOWN and nobody can say whether its effect landed; two store-backup-daily slots were lost this way, and three seated resyncs to the Bash tool's 30-minute background default",
    command: "slopweaver automation run-due",
    exceptions: [
      "you are exercising this gate or run-due's own signal handling on a throwaway home, and losing the firing is the point",
      "a one-off forensic reproduction of a killed run, where the owner accepts losing the selected firing",
    ],
    id: "run-due-deadline",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_RUN_DUE_DEADLINE" },
    lane: "ambient",
    reader: "src/admit/runDueDeadline.ts",
    standing: "proposed",
  },
  {
    caught:
      "the previous reviewer round on this ask came back CLEAN, its low-impact residue is advisory, and a second round to re-clear a tidied answer costs a median 12 minutes — post the answer that verdict cleared",
    command: "slopweaver turn review --answer",
    exceptions: [
      "a claim the clean verdict marked low-impact is materially WRONG, and fixing it is not polish",
      "the door refused the cleared answer on a finding that can only be fixed by changing it",
      "the thread moved after the clean round and the answer has to say something new",
    ],
    id: "review-after-clean",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_REVIEW_AFTER_CLEAN" },
    lane: "ambient",
    reader: "src/cli/commands/turn/reviewAfterClean.ts",
    standing: "proposed",
  },
  {
    caught:
      "a human wrote in the ask's thread after the point this draft read up to, and round 1 would spend a reviewer (a median 12 minutes) on a draft that thread may already have answered or contradicted; every first round on record came back broken, 7 of 7 — read each listed message first, and if one touches a claim, fix the draft and re-run with a newer --read-through instead",
    command: "slopweaver turn review --answer",
    exceptions: [
      "you read every listed message and none answers, contradicts, duplicates or pre-empts a claim the draft makes",
      "the listed messages are the thread moving on, a thanks, or chatter about something else",
    ],
    id: "review-thread-delta",
    key: { incantation: "slopweaver turn review --delta-cleared --answer <path>", kind: "command" },
    lane: "ambient",
    reader: "src/cli/commands/turn/reviewThreadPreflight.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
