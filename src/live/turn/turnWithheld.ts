/**
 * The withheld ending: file the draft, then say so.
 *
 * **Ordering 5** of the list in {@link ./run}, and the order inside it is the point. Somebody asked, so
 * somebody is waiting, and silence reads as broken. The draft is filed BEFORE the notice goes out, so the
 * id in the notice always names an entry that exists.
 *
 * A queue write that FAILS still produces a notice, one saying the draft could not be filed rather than an
 * id nobody can release. A notice carrying an unreleasable id would be worse than the silence it replaced.
 */

import type { SlackUpload } from "../../corpus/slack/writeTransport.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { Mention } from "../listen/mention.js";
import { type QueuedOutcome, turnHeldForm } from "./answer.js";
import type { TurnHandlerOutcome, TurnProvenance } from "./envelope.js";
import { HELD_DOCUMENTS_KEY, HELD_UPLOADS_KEY, lockUploads } from "./heldUploads.js";
import { slackUserIdsIn } from "./quotedQuestion.js";
import type { HoldSink, TurnPoster } from "./runContract.js";
import { reasonOf } from "./turnCursor.js";

/** File the draft, turning a store failure into a value the notice can state rather than an escaping throw. */
async function file({
  answer,
  documents,
  hold,
  mention,
  offered,
  question,
  uploads,
}: {
  answer: AnswerFormAnswer;
  documents: readonly SlackUpload[];
  hold: HoldSink;
  mention: Mention;
  offered: { readonly code: string; readonly reason: string };
  question: string;
  uploads: readonly SlackUpload[];
}): Promise<QueuedOutcome> {
  try {
    return await hold({
      held: {
        askedBy: mention.userId,
        channel: mention.channel,
        code: offered.code,
        // Spread rather than passed by reference: the queue's `draft` is opaque JSON, and an interface has no
        // index signature to satisfy that with. The spread is also the honest operation — what is filed is a
        // snapshot of the form as composed, not a live handle on it. The image BYTES are locked in alongside
        // it under two reserved keys — see `lockUploads`'s own header for why a path alone is not a proof,
        // and `heldUploads.ts`'s for why the two lanes stay apart through the queue.
        draft: {
          ...answer,
          [HELD_DOCUMENTS_KEY]: lockUploads({ uploads: documents }),
          [HELD_UPLOADS_KEY]: lockUploads({ uploads }),
        },
        messageTs: mention.messageTs,
        question,
        reason: offered.reason,
        surface: mention.surface,
        threadTs: mention.threadTs,
      },
    });
  } catch (error) {
    return { failure: reasonOf({ error }) };
  }
}

/**
 * File a withheld draft and say so in the thread.
 *
 * The queue write happens FIRST, so the id in the notice always names an entry that exists. It is also
 * CAUGHT, and that is the point of the ordering being visible here: a failed queue write used to propagate
 * out of `runTurn` past the try/catch, which left the person who asked staring at a half-ticked checklist
 * and no message at all — the exact silence this whole mechanism exists to prevent. Now they are told the
 * reply was held AND that it could not be filed, which is the truth and is actionable.
 *
 * @returns the outcome to fold, carrying the draft's queue id when the filing succeeded
 */
export async function reportWithheld({
  answer,
  documents,
  mention,
  offered,
  hold,
  poster,
  provenance,
  question,
  uploads,
}: {
  answer: AnswerFormAnswer;
  documents: readonly SlackUpload[];
  mention: Mention;
  offered: { readonly code: string; readonly reason: string };
  hold: HoldSink;
  poster: TurnPoster;
  provenance: TurnProvenance;
  question: string;
  uploads: readonly SlackUpload[];
}): Promise<TurnHandlerOutcome> {
  const queued = await file({ answer, documents, hold, mention, offered, question, uploads });
  const notice = await poster.postNotice({
    card: turnHeldForm({
      modelId: provenance.modelId,
      // Resolved through the poster's door before the `tldr` quotes the question — see `./turnSettle.ts`'s
      // own copy of this line, and `./quotedQuestion.ts` for why a raw tag here refused the whole card.
      names: poster.displayNames({ slackIds: slackUserIdsIn({ question }) }),
      question,
      queued,
      reason: offered.reason,
    }),
  });
  if (!("id" in queued)) {
    return { answered: false, answerTs: notice.ts, failure: `the draft was held but not filed: ${queued.failure}` };
  }
  return {
    answered: false,
    answerTs: notice.ts,
    withheld: { code: offered.code, id: queued.id, reason: offered.reason },
  };
}
