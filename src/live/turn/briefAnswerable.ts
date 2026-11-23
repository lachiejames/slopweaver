/**
 * The ANSWERABLE half of the brief contract: the projection `turn answer`/`turn resume` read, its decoder, and the
 * check that a composed answer's grounding agrees with the decision it was dispatched under.
 *
 * This module depends on `./brief.ts` ONE WAY. It projects the full brief, so it imports that file's one decoder
 * (`parseTurnRoutingBrief`) and its `TurnRoutingBrief` type rather than decoding a second, looser shape. `./brief.ts`
 * imports nothing from here and re-exports none of it, so the edge never closes into a cycle. Pure: no effect runs.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { SourceCapability } from "../../route/profile.js";
import type { StartedChecklist } from "../ask/checklist.js";
import type { AskIdentity } from "../ask/identity.js";
import { parseTurnRoutingBrief, type TurnRoutingBrief } from "./brief.js";
import { type BriefParseError, type GroundingValidationError, GroundingValidationErrors } from "./errors.js";
import type { RoutingDecision } from "./judgement.js";
import { classifyProposalAsk } from "./proposalAsk.js";

/**
 * The part of a {@link TurnRoutingBrief} `turn answer`/`turn resume` actually consume — everything except
 * the full routing input, which is `turn dispatch`'s concern alone. A strict projection, never a cast: this
 * is what {@link parseAnswerableBrief} builds it as.
 */
export interface AnswerableBrief extends AskIdentity {
  readonly question: string;
  readonly surface: "channel" | "dm";
  readonly userId: string;
  readonly unavailableCapabilities: readonly SourceCapability[];
  readonly started?: StartedChecklist | undefined;
}

/**
 * Parse an already-decoded value as the ANSWERABLE projection of a brief — `turn answer`/`turn resume`'s own
 * entrance. Built by parsing the FULL brief through {@link parseTurnRoutingBrief} and projecting it down,
 * never by re-decoding a second, looser shape: one decoder, one version check.
 *
 * @param raw the decoded JSON value
 * @returns the answerable projection, or every reason the full brief does not parse
 */
export function parseAnswerableBrief({ raw }: { raw: unknown }): Result<AnswerableBrief, BriefParseError> {
  const brief = parseTurnRoutingBrief({ raw });
  if (brief.isErr()) {
    return err(brief.error);
  }
  return ok(answerableProjectionOf({ brief: brief.value }));
}

/**
 * Project a full brief down to the fields `turn answer`/`turn resume` read.
 *
 * @param brief the full, already-validated brief
 * @returns the answerable projection
 */
export function answerableProjectionOf({ brief }: { brief: TurnRoutingBrief }): AnswerableBrief {
  return {
    channel: brief.channel,
    messageTs: brief.messageTs,
    question: brief.question,
    surface: brief.surface,
    threadTs: brief.threadTs,
    unavailableCapabilities: brief.unavailableCapabilities,
    userId: brief.userId,
    ...(brief.started === undefined ? {} : { started: brief.started }),
  };
}

/**
 * Whether a composed answer is consistent with the decision it was judged under and the brief it answers —
 * checked before any Slack effect, by both `turn resume` (before printing the ready marker) and
 * `turn answer` (before posting). Never re-derives the grounding; only checks it against what was actually
 * decided and what this context actually knows to be unavailable.
 *
 * - `conversation` grounding needs no check UNLESS the decision named a `required` need — a session cannot
 *   claim context alone was sufficient while the decision that dispatched it says a live capability was
 *   required to answer at all; that contradiction is refused rather than silently accepted.
 * - `verb` grounding's capability must be one of the decision's own `needs` — a session cannot claim it ran
 *   a live command the decision never asked for.
 * - `unreachable` grounding's surface must be named either by the brief's own unavailable set (a real,
 *   current-truth fact) or by the decision's `needs` (the session tried and it was unreachable) — never an
 *   unsubstantiated claim.
 *
 * Ahead of all three sits the PREMISE check, and it is checked first because it is the only one that can
 * invalidate an otherwise perfectly consistent answer. A proposal-shaped ask ("should we do X", "what would
 * standing X up cost") assumes X does not exist yet; an answer to one that records no present-state check of
 * that assumption is refused, whichever way it is grounded. That answers the third question the incident
 * left open — yes, the form refuses a proposal answer citing no present-state read — and it is deliberately
 * not softened to a warning: the measured answer was internally consistent, well-evidenced and wrong from
 * its first bullet, so consistency is exactly the property that was already satisfied when it failed.
 *
 * @param answer the parsed, schema-valid answer form
 * @param decision the `respond` decision this answer was dispatched under
 * @param brief the answerable brief this answer replies to
 * @returns `ok` when the answer's grounding is consistent, or the one reason it is not
 */
export function validateAnswerForDispatch({
  answer,
  decision,
  brief,
}: {
  answer: AnswerFormAnswer;
  decision: Extract<RoutingDecision, { readonly response: "respond" }>;
  brief: AnswerableBrief;
}): Result<void, GroundingValidationError> {
  const grounding = answer.grounding;
  const proposal = classifyProposalAsk({ text: brief.question });
  if (proposal !== undefined && grounding.evidence.premiseChecks.length === 0) {
    return err(GroundingValidationErrors.proposalPremiseUnchecked({ trigger: proposal.trigger }));
  }
  const neededIds = new Set(decision.needs.map((need) => need.capabilityId));
  if (grounding.kind === "conversation") {
    const requiredIds = decision.needs
      .filter((need) => need.requirement === "required")
      .map((need) => need.capabilityId);
    return requiredIds.length === 0
      ? ok(undefined)
      : err(GroundingValidationErrors.conversationGroundingInsufficient({ requiredIds }));
  }
  if (grounding.kind === "verb") {
    return neededIds.has(grounding.capability.id)
      ? ok(undefined)
      : err(
          GroundingValidationErrors.verbGroundingUnrequested({
            allowedIds: decision.needs.map((need) => need.capabilityId),
            capabilityId: grounding.capability.id,
          }),
        );
  }
  const unavailableIds = new Set(brief.unavailableCapabilities.map((capability) => capability.id));
  if (unavailableIds.has(grounding.surface.id) || neededIds.has(grounding.surface.id)) {
    return ok(undefined);
  }
  return err(GroundingValidationErrors.unreachableGroundingUnsubstantiated({ surfaceId: grounding.surface.id }));
}
