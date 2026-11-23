/**
 * Building one turn's {@link RoutingJudgementInput} — the trust-labelled input a routing judgement reasons
 * over, assembled from the addressing message alone. Preserves H5's own control/evidence split: only the
 * owner's own addressing text becomes `controlPlane.ownerAddressingText`; everything structural about the
 * message becomes a plain `StructuralFact` (`judgement.ts`), never free text a judgement could mistake for content to
 * weigh; `quotedEvidence` starts empty because nothing has been read yet at brief time.
 */

import type { OwnerDirective } from "../../judgement/ownerDirective.js";
import type { RoutingCapabilities } from "../../route/routingCapabilities.js";
import type { AskIdentity } from "../ask/identity.js";
import type { RoutingExecutionContext, RoutingJudgementInput } from "./judgement.js";
import type { JudgementProfile } from "./judgementProfile.js";

/** The addressing message facts a brief is built from — the same shape `turnBrief`'s own target carries. */
export type BriefTarget = AskIdentity & {
  readonly question: string;
  readonly surface: "channel" | "dm";
  readonly userId: string;
};

/**
 * Assemble one turn's routing-judgement input.
 *
 * @param briefTarget the addressing message this turn is for
 * @param capabilities the capability inventory built for this turn — both selectable partitions are carried
 *   through, current truth and history alike
 * @param profile the mined judgement/voice profile, when one has been accepted
 * @param ownerDirectives explicit current owner rulings, when any have been recorded
 * @param execution which invocation mode and host this judgement is being made under
 * @returns the trust-labelled input a routing judgement reasons over
 */
export function routingInputForTurn({
  briefTarget,
  capabilities,
  ownerDirectives,
  profile,
  execution,
}: {
  briefTarget: BriefTarget;
  capabilities: RoutingCapabilities;
  ownerDirectives?: readonly OwnerDirective[] | undefined;
  profile?: JudgementProfile | undefined;
  execution: RoutingExecutionContext;
}): RoutingJudgementInput {
  return {
    availableCapabilities: capabilities.available,
    // Always written, including when it is empty: an absent field reads as "this build does not carry
    // history" to a reader of the persisted brief, and that is exactly the wrong inference. The defect this
    // closes was a producer that dropped `capabilities.historical` on the floor while the judge it fed had
    // validated that field for three weeks — see `../../route/routingCapabilities.ts`'s own header.
    historicalCapabilities: capabilities.historical,
    context: {
      controlPlane: {
        ownerAddressingText: briefTarget.question,
        structuralMetadata: [
          { key: "channel", value: briefTarget.channel },
          { key: "messageTs", value: briefTarget.messageTs },
          { key: "threadTs", value: briefTarget.threadTs },
          { key: "surface", value: briefTarget.surface },
          { key: "userId", value: briefTarget.userId },
        ],
      },
      quotedEvidence: [],
    },
    execution,
    ...(ownerDirectives === undefined ? {} : { ownerDirectives }),
    ...(profile === undefined ? {} : { profile }),
  };
}
