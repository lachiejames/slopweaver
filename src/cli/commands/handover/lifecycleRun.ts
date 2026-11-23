/**
 * The public entry point for the run-lifecycle verbs, and the `defineCommand` wiring the manifest loads by
 * name. Every decision lives in {@link ./lifecycle}; this reads flags, builds the seams, and prints.
 *
 * The actual verb bodies live in siblings, split out purely to keep any one file under the size ratchet —
 * none of them import each other, only the shared machinery in {@link ./lifecycleRunCore}:
 *
 *  - {@link ./lifecycleRunOwnership} — `claim` / `release`, the ownership-transfer verbs.
 *  - {@link ./lifecycleRunOrphan} — `abandon`, including the doc-free orphan path.
 *  - {@link ./lifecycleRunQuestions} — `ask` / `answer`.
 *  - {@link ./lifecycleRunCorrect} — `correct`, restating an open question on the journal.
 *  - {@link ./lifecycleRunVerbs} — `start` / `finish` / `resume` / `amend` / `sign-off`.
 *  - {@link ./offerRun} — `offer`, attaching a Slack draft to a question already waiting.
 *  - {@link ./reconfirmRun} — `reconfirm`, recording that a waiting question still stands, without re-asking it.
 *  - {@link ./withdrawRun} — `withdraw`, the holder taking back a question whose premise resolved itself.
 *
 * Every name this file exported before the split is re-exported here unchanged, so no importer's path or
 * behaviour changes.
 */

import { defineCommand } from "../../defineCommand.js";
import {
  HANDOVER_LIFECYCLE_FLAG_NAMES,
  lifecycleUsage,
  parseLifecycleArgs,
  routedValue,
  routingFlagSuffix,
} from "./lifecycleRunCore.js";
import { runHandoverCorrect } from "./lifecycleRunCorrect.js";
import { orphanAbandonVerdict, runHandoverAbandon } from "./lifecycleRunOrphan.js";
import { claimRefusal, runHandoverClaim, runHandoverRelease } from "./lifecycleRunOwnership.js";
import { runHandoverAnswer, runHandoverAsk } from "./lifecycleRunQuestions.js";
import {
  FINISH_OVERRIDE,
  runHandoverAmend,
  runHandoverFinish,
  runHandoverResume,
  runHandoverSignOff,
  runHandoverStart,
} from "./lifecycleRunVerbs.js";
import { runHandoverOffer } from "./offerRun.js";
import { runHandoverReconfirm } from "./reconfirmRun.js";
import { runHandoverWithdraw } from "./withdrawRun.js";

export const handoverSignOffCommand = defineCommand({ run: runHandoverSignOff });

export const handoverStartCommand = defineCommand({ run: runHandoverStart });
export const handoverFinishCommand = defineCommand({ run: runHandoverFinish });
export const handoverResumeCommand = defineCommand({ run: runHandoverResume });
export const handoverClaimCommand = defineCommand({ run: runHandoverClaim });
export const handoverReleaseCommand = defineCommand({ run: runHandoverRelease });
export const handoverAskCommand = defineCommand({ run: runHandoverAsk });
export const handoverOfferCommand = defineCommand({ run: runHandoverOffer });
export const handoverReconfirmCommand = defineCommand({ run: runHandoverReconfirm });
export const handoverWithdrawCommand = defineCommand({ run: runHandoverWithdraw });
export const handoverAnswerCommand = defineCommand({ run: runHandoverAnswer });
export const handoverCorrectCommand = defineCommand({ run: runHandoverCorrect });
export const handoverAmendCommand = defineCommand({ run: runHandoverAmend });
export const handoverAbandonCommand = defineCommand({ run: runHandoverAbandon });

// Re-exported unchanged from the siblings above — the whole public surface this file carried before the
// split, so every existing import of `handover/lifecycleRun.js` keeps resolving to the same name.
export {
  claimRefusal,
  FINISH_OVERRIDE,
  HANDOVER_LIFECYCLE_FLAG_NAMES,
  lifecycleUsage,
  orphanAbandonVerdict,
  parseLifecycleArgs,
  routedValue,
  routingFlagSuffix,
  runHandoverAbandon,
  runHandoverAmend,
  runHandoverAnswer,
  runHandoverAsk,
  runHandoverClaim,
  runHandoverCorrect,
  runHandoverFinish,
  runHandoverOffer,
  runHandoverRelease,
  runHandoverResume,
  runHandoverSignOff,
  runHandoverStart,
};
