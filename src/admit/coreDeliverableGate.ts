/**
 * The gate that refuses to send an answer missing the artifact its question asked for.
 *
 * ## Why a second gate rather than a rule in the reviewer's packet
 *
 * The reviewer's packet already leads with this check (`requestedDeliverables.ts`'s
 * `coreDeliverableReviewLines`), and that is where the JUDGEMENT belongs — only a reader can say whether the
 * link that IS there points at the thing that was deployed. But doctrine rule 7's shape is that a form
 * REFUSES a violation rather than a reviewer catching it, and the floor here is a checkable fact: an answer
 * to a deploy ask that carries no clickable link at all cannot have handed one back, whatever anyone judged.
 * The measured failure passed a review loop six times; a gate that reads the bytes would have fired once.
 *
 * ## `warn`, like every other gate on this path
 *
 * The house rule is block-by-default WITH a break-glass. A `hold` would make "I have looked at it, the link
 * is genuinely not the point here, send it" unrepresentable, and the door records every override it waives —
 * so releasing an answer that omits a requested artifact is itself in the audit trail, which is the property
 * that matters. Every finding names the deliverable and how to satisfy it, so it is self-correctable.
 */

import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import { missingDeliverables } from "./requestedDeliverables.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the docs and tests quote it rather than re-spelling it.
 */
export const CORE_DELIVERABLE_OVERRIDE = "answer.deliverable:v1";

/**
 * Every requested artifact this answer does not carry, as door findings.
 *
 * One finding PER missing deliverable rather than a single combined one: an answer that owes both a link and
 * screenshots should learn both in one refusal, not one per round trip — the same reason
 * `answerQualityFindings` returns a list.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked, tags already stripped
 * @returns every finding that stands; empty when the answer hands back everything the question asked for
 */
export function coreDeliverableFindings({
  answer,
  question,
}: {
  answer: AnswerFormAnswer;
  question: string;
}): readonly DoorFinding[] {
  return missingDeliverables({ answer, question }).map((deliverable): DoorFinding => {
    return {
      code: `ANSWER_MISSING_DELIVERABLE_${deliverable.id.toUpperCase().replaceAll("-", "_")}`,
      correction: `add ${deliverable.what}`,
      override: CORE_DELIVERABLE_OVERRIDE,
      severity: "warn",
      summary: `the question asks for this and the answer does not carry it: ${deliverable.why}`,
    };
  });
}

/**
 * The core-deliverable gate, ready to compose into the door's gate list.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked, tags already stripped
 * @returns a `DoorGate` that reports every requested artifact the answer omits
 */
export function coreDeliverableGate({ answer, question }: { answer: AnswerFormAnswer; question: string }): DoorGate {
  return () => coreDeliverableFindings({ answer, question });
}
