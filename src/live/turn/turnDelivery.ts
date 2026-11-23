/**
 * The answering ending: post the answer, then delete the working message.
 *
 * **Ordering 3** of the list in {@link ./run}: a real answer REPLACES the working message, it never ticks
 * it done. The answer is posted first and the working message deleted after, so the thread carries one
 * reply rather than a stuck checklist sitting above a second message. A new message notifies and an
 * in-place edit does not, which is why the order is this way round and not the other.
 *
 * If the delete itself fails, the fallback is to finish the checklist fully done in place. What it must
 * never do is leave the checklist claiming a step is still running after the answer already exists, which
 * is a claim the code cannot support.
 */

import type { SlackUpload } from "../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type MissingUpload, missingMediaSentence } from "../../outbound/slack/missingMedia.js";
import { askIdentityOf } from "../ask/identity.js";
import type { Mention } from "../listen/mention.js";
import { answerDigestOf } from "./answerDigest.js";
import type { TurnProvenance } from "./envelope.js";
import type {
  AnswerSendRefusal,
  DeliveredTurn,
  HoldSink,
  PostAnswerOutcome,
  TurnPoster,
  TurnQueryOutcome,
} from "./runContract.js";
import { reportWithheld } from "./turnWithheld.js";

/**
 * The answered ending, with the degradation sentence folded into the detail when media never attached.
 *
 * An answer whose form declared `followThrough` is a FIRST answer, and the outcome carries that — with the
 * posted form's digest — so `./turnSettle.ts` leaves the turn running instead of finalising it.
 */
function postedDelivery({
  answer,
  detail,
  missing,
  ts,
}: {
  answer: TurnQueryOutcome["answer"];
  detail: string;
  missing: readonly MissingUpload[];
  ts: string;
}): DeliveredTurn {
  const completionDetail = missing.length === 0 ? detail : `${detail} — DEGRADED: ${missingMediaSentence({ missing })}`;
  const followThrough = answer.followThrough;
  const firstAnswer =
    followThrough === undefined ? {} : { firstAnswer: { answerDigest: answerDigestOf({ answer }), followThrough } };
  return {
    outcome: { answered: true, answerTs: ts, ...firstAnswer },
    state: { kind: "answered", readerReason: completionDetail, reason: completionDetail },
  };
}

/**
 * Hand the answer and its reply context to the poster, which offers it to the door — split out of
 * {@link deliverAnswer} to keep that function under the line cap.
 *
 * @returns what the poster did with the answer: posted, withheld or refused retryably
 */
async function offerToDoor({
  documents,
  mention,
  outcome,
  poster,
  question,
  uploads,
}: {
  documents: readonly SlackUpload[];
  mention: Mention;
  outcome: TurnQueryOutcome;
  poster: TurnPoster;
  question: string;
  uploads: readonly SlackUpload[];
}): Promise<PostAnswerOutcome> {
  return poster.postAnswer({
    answer: outcome.answer,
    askIdentity: askIdentityOf({ source: mention }),
    documents,
    reply: {
      askedBy: mention.userId,
      channel: mention.channel,
      draftTldr: outcome.answer.lead,
      question,
      surface: mention.surface,
    },
    uploads,
  });
}

/**
 * Offer the answer to the door, post whatever the door allowed, and NAME how the turn ended.
 *
 * It no longer resolves the working message itself, and that split is the point: this function decides the
 * OUTCOME, {@link finaliseIndicators} applies it to every indicator. Two call sites each deciding half of
 * "the turn is over" is exactly how the refused path came to clear none of them.
 *
 * **A real answer still REPLACES the working message rather than ticking it.** V1 deleted the checklist and
 * let the answer land as its own new message on purpose — the owner's own words: it "kept the thread lean"
 * and "people are notified when it responds as a new message," which an in-place edit does not do. That
 * delete-first-then-fall-back-to-a-finished-frame ordering now lives in {@link turnIndicatorSeams}'s
 * `settleChecklist`, where every terminal path shares it.
 *
 * **A withheld reply keeps the checklist**, because nothing replaced it — the answer never reached the
 * thread, so there is nothing for the working message to be redundant WITH. It resolves to a card that says
 * the draft is held and why, rather than to an unreachable half-ticked one.
 *
 * @param hold where a withheld draft is filed
 * @param mention the mention being answered
 * @param outcome what the query produced
 * @param poster what the turn may post
 * @param provenance the session link and model id stamped on every message
 * @param question the question being answered
 * @param uploads the answer's images, already read off disk
 * @param documents the answer's deliverable files, already read off disk
 * @returns the delivered ending, or the warn-tier refusal that means this turn has not ended at all
 */
export async function deliverAnswer({
  documents,
  hold,
  mention,
  outcome,
  poster,
  provenance,
  question,
  uploads,
}: {
  documents: readonly SlackUpload[];
  hold: HoldSink;
  mention: Mention;
  outcome: TurnQueryOutcome;
  poster: TurnPoster;
  provenance: TurnProvenance;
  question: string;
  uploads: readonly SlackUpload[];
}): Promise<Result<DeliveredTurn, AnswerSendRefusal>> {
  const offered = await offerToDoor({ documents, mention, outcome, poster, question, uploads });
  if (offered.kind === "posted") {
    return ok(
      postedDelivery({
        answer: outcome.answer,
        detail: outcome.completionDetail,
        missing: offered.missingMedia,
        ts: offered.ref.ts,
      }),
    );
  }
  // BEFORE the withheld path, and returning rather than settling anything: no queue entry, no notice and no
  // terminal event, because none of those are true of an answer the same worker is about to correct and
  // offer again — `./runContract.ts`'s `AnswerSendRefusal` carries the measured incident.
  if (offered.kind === "retryable-refusal") {
    return err(offered.refusal);
  }
  const result = await reportWithheld({
    answer: outcome.answer,
    documents,
    hold,
    mention,
    offered,
    poster,
    provenance,
    question,
    uploads,
  });
  // The withhold's own reason is already written for a human to read — see `../../admit/withhold.js`'s
  // header — so it stays the same clause on both fields.
  return ok({ outcome: result, state: { kind: "withheld", readerReason: offered.reason, reason: offered.reason } });
}
