/**
 * The exact payload an answer goes out as, and whether the Slack send's wire guard would refuse it.
 *
 * Split out of `./posterAnswer.ts`, whose `offerAnswer` renders {@link answerPayload} ONCE and asks
 * {@link unsendableAnswerRefusal} of it FIRST — before an attachment is settled or the door is asked — then
 * sends that same object, so what was checked and what is sent cannot come apart. The one thing the send adds is
 * `../../outbound/slack/missingMedia.ts`'s note when an upload never attaches — a `mrkdwn` block, which the wire
 * guard skips by construction, so it cannot change the verdict.
 */
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import { renderAssistantAnswer } from "../../outbound/assistant/answerMessage.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import { typedRunsOnlyViolations } from "../../outbound/slack/typedRunsOnly.js";
import type { SlackAssistantAnswerPayloadV2, SlackCardChrome } from "../../outbound/slack/types.js";
import { type AskIdentity, exactRecordedAskIdentity } from "../ask/identity.js";
import { answerCarrying } from "./answerFreshnessNote.js";
import { type AnswerSendRefusal, AnswerSendRefusals } from "./runContract.js";

/** What renders an answer: the answer itself and everything the send packages it with. */
interface AnswerPackaging {
  answer: AnswerFormAnswer;
  askIdentity: AskIdentity;
  chrome: SlackCardChrome;
  freshnessNote: string | undefined;
  mentions: ResolvedMentions;
}

/**
 * The exact `chat.postMessage` payload an answer goes out as.
 *
 * The freshness note goes on here, which is still downstream of `answerGates`' digest: no gate is handed
 * this payload.
 *
 * @param answer the reviewed answer, exactly as the digest bound it
 * @param askIdentity the exact ask this answer belongs to
 * @param chrome the operator's full card chrome
 * @param freshnessNote the door's one-line observation, absent when it had nothing to say
 * @param mentions every mentioned person, already resolved to a Slack user id
 * @returns the payload, before the transport's wire guard reads it
 */
export function answerPayload({
  answer,
  askIdentity,
  chrome,
  freshnessNote,
  mentions,
}: AnswerPackaging): SlackAssistantAnswerPayloadV2 {
  return renderAssistantAnswer({
    answer: answerCarrying({ answer, freshnessNote }),
    askIdentity: exactRecordedAskIdentity({ askIdentity }),
    chrome,
    mentions,
  });
}

/**
 * The retryable refusal an answer earns when its rendered payload carries raw markup the wire guard
 * (`../../corpus/slack/writeGuardTypedRuns.ts`) would refuse, or `undefined` when it would send.
 *
 * A refusal VALUE, never a throw: a throw from the guard mid-send is what was read as a break and posted a
 * public failure card over a live worker — `./runContract.ts`'s `AnswerSendRefusal` carries the incident.
 *
 * @param payload what {@link answerPayload} rendered, and exactly what the send will be handed
 * @returns the refusal naming every span, or `undefined` when the payload is clean
 */
export function unsendableAnswerRefusal({
  payload,
}: {
  payload: SlackAssistantAnswerPayloadV2;
}): AnswerSendRefusal | undefined {
  const unsendable = typedRunsOnlyViolations({ payload });
  if (unsendable.length === 0) {
    return undefined;
  }
  return AnswerSendRefusals.formUnsendable({
    message:
      "the turn's answer was not sent: it renders raw markup the Slack send refuses, so correct the form " +
      `and offer it again — ${unsendable.join(" | ")}`,
  });
}
