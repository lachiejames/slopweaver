/**
 * The answer-send path: the digest a review verdict binds to, the door offer itself, the live held-draft queue
 * sink, and thread naming. The gate list an answer passes through is `./answerGates.ts`'s.
 *
 * Split out of `./poster.ts` so that file stays under this repo's line cap.
 */

import { DEFAULT_GATES } from "../../admit/door.js";
import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import { throughDoor } from "../../admit/effects.js";
import { recordExactVoicePainPoints } from "../../admit/painPoint.js";
import { appendQueueEvent, mintQueueId } from "../../admit/queueStore.js";
import type { ReviewVerdict } from "../../admit/reviewVerdict.js";
import { voiceInputFor, voiceProfileGate } from "../../admit/voiceProfileGate.js";
import { type ReplyContext, type ReplyJudgement, WITHHOLD_CODE } from "../../admit/withhold.js";
import { runAssistantCompositeSend } from "../../corpus/slack/writeSend.js";
import type { SlackUpload, SlackWriteTransport, UploadReadiness } from "../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import { assistantTitleArgs } from "../../outbound/assistant/title.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import type { SlackAssistantAnswerPayloadV2, SlackCardChrome } from "../../outbound/slack/types.js";
import { authoredProseOf } from "../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../profileStore.js";
import { imageAdmitFor } from "../../visualEvidence/prepareUploads.js";
import type { AskIdentity } from "../ask/identity.js";
import { answerGates, verdictImageObservations } from "./answerGates.js";
import {
  attachedReviewImages,
  type BoundAnswerUpload,
  bindAnswerUploads,
  ownedUploads,
  persistUnfitImageObservations,
} from "./answerImageObservations.js";
import { answerVoiceInput } from "./answerPreflight.js";
import { answerPayload, unsendableAnswerRefusal } from "./answerSendable.js";
import { declinedAtlasReadings } from "./declinedAtlasReadings.js";
import { asRef, refusalDetail, turnDoorRequest } from "./posterDoor.js";
import {
  AnswerSendRefusals,
  DoorRecordingRefusedError,
  DoorRefusedError,
  type HoldSink,
  type PostAnswerOutcome,
} from "./run.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

// Defined in a leaf so the delivery ladder can stamp a posted first answer's digest without this module's
// import of `./run.ts`; re-exported here for every existing import site.
export { answerDigestOf } from "./answerDigest.js";

/**
 * Settle this send's attachments before the door is asked anything — which bytes they are, and what the
 * reviewer's verdict makes durable about them.
 *
 * Two acts, in this order and before the gates, and the order is the property. A reviewer's "I opened it and
 * it is unreadable" becomes a terminal `failed` record against the picture's own BYTES, so
 * `../../visualEvidence/admission.ts`'s no-hatch `known-bad` arm refuses them through every upload lane from
 * now on rather than only on this send — which is what the owner asked for: the
 * mistake made structurally impossible to repeat.
 *
 * Either failure throws rather than returning, because neither leaves anything sendable: an answer whose
 * images cannot be matched to its own paths has no coverage to check, and a store that could not be written
 * means nothing is durable — reporting the bytes terminally refused when nothing was written would be the
 * "a check that cannot fail reports clean" shape this whole domain exists to close.
 *
 * @param answer the composed answer, whose `images` name the attachments in order
 * @param home the resolved state home the records live under
 * @param uploads the bytes read for those paths, in the same order
 * @param verdict the reviewing session's verdict, or `undefined` when none arrived
 * @returns each attachment bound to its path and its digest, in attach order
 */
async function settledAttachments({
  answer,
  home,
  uploads,
  verdict,
}: {
  answer: AnswerFormAnswer;
  home: string;
  uploads: readonly SlackUpload[];
  verdict: ReviewVerdict | undefined;
}): Promise<readonly BoundAnswerUpload[]> {
  // Copy the bytes FIRST, then condemn, then bind — and that order is the fix for a defect a Codex review
  // found. Persisting used to need the path binding, so an answer whose `images` and uploads had come apart
  // was refused with the unreadable picture left unrecorded: the one case where the bytes are certainly
  // real and the paths certainly are not. Which bytes these are needs no path at all.
  const owned = ownedUploads({ uploads });
  const persisted = await persistUnfitImageObservations({
    attached: owned,
    home,
    nowIso: new Date().toISOString(),
    observations: verdictImageObservations({ verdict }),
    reviewerSession: verdict?.reviewerSession ?? "(no verdict)",
  });
  if (persisted.isErr()) {
    throw new DoorRefusedError(
      "the turn's answer was not sent: what its reviewer recorded about an image could not be written down — " +
        persisted.error.message,
    );
  }
  const bound = bindAnswerUploads({ owned, paths: answer.images });
  if (bound.isErr()) {
    throw new DoorRefusedError(`the turn's answer could not be matched to its own images — ${bound.error.message}`);
  }
  return bound.value;
}

/**
 * Offer the answer to the door, and — only if the door admits it — render and send it, images and
 * documents and all, as one composite transaction.
 *
 * The two lanes are handled differently HERE and that asymmetry is the point: `uploads` goes through
 * {@link settledAttachments}, which condemns what a reviewer called unfit and binds each picture to the
 * path the answer names, while `documents` goes straight to the send. Neither step has a meaning for a
 * markdown file — there is no visual-evidence record to bind it to and no observation to condemn — and
 * inventing a document-shaped copy of both would be a lossy imitation of a mechanism that exists for
 * pictures. `../../corpus/slack/writeSend.ts`'s header carries the rest.
 *
 * It does NOT reuse `routed`, for the same reason `nameThreadThroughDoor` does not: `routed` turns any
 * non-pass into a throw, which is right for a write the turn cannot continue without and wrong here. A
 * withheld reply is a decision the mechanism made on purpose, and raising it as an error would mean the
 * caller learns about the feature working correctly by catching an exception.
 *
 * The two non-pass cases are told apart by the finding code rather than by the status, because they are
 * genuinely different events: a withhold is this feature, and anything else is a gate the operator has to see.
 *
 * The WHOLE upload → post → attach → verify → retract transaction happens INSIDE the admitted effect, so a
 * withheld decision uploads nothing — the door decides before a single byte reaches Slack.
 *
 * Sends through `runAssistantCompositeSend` (`chat.postMessage`/`chat.update`) rather than the stream
 * API: streaming buys the answer no incremental-reveal benefit — it always posted the whole reply as one
 * chunk — and `chat.startStream`'s payload cannot express the `attachments` wrapper the answer now carries.
 * The checklist also uses static messages now, so ownership metadata exists from its first frame.
 *
 * @param askIdentity the exact ask this answer belongs to
 * @param chrome the operator's full card chrome
 * @param documents the answer's deliverable files, already read off disk
 * @param doorLedger where the door's decision is recorded before anything is sent
 * @param home the resolved state home, for the door ledger
 * @param judge the withhold judgement the whitelist gate consults
 * @param mentions every mentioned person, already resolved to a Slack user id
 * @param readiness the bounded upload-readiness poll the answer's images go through
 * @param reply the context the withhold judgement reads
 * @param transport the Slack write transport
 * @param turnId the id correlating this write with its turn
 * @param uploads the answer's images, already read off disk
 * @param answer the composed answer about to be sent
 * @param verdict the reviewing session's verdict; `undefined` refuses the send
 * @returns the outcome — posted, or withheld with its reason
 */
// max-lines-exempt: 15 named-object-params fields, one line per field, over a 24-line body that is one door offer and one send. The only way to shorten it is to bundle parameters into an object the caller would have to assemble, which is the transposable shape named-object-params exists to prevent.
export async function offerAnswer({
  askIdentity,
  chrome,
  documents,
  doorLedger,
  home,
  judge,
  mentions,
  readiness,
  reply,
  transport,
  turnId,
  uploads,
  answer: offered,
  freshnessNote,
  verdict,
}: {
  askIdentity: AskIdentity;
  chrome: SlackCardChrome;
  documents: readonly SlackUpload[];
  doorLedger: DoorLedgerPort;
  home: string;
  judge: ReplyJudgement;
  mentions: ResolvedMentions;
  readiness: UploadReadiness;
  reply: ReplyContext;
  transport: SlackWriteTransport;
  turnId: string;
  uploads: readonly SlackUpload[];
  answer: AnswerFormAnswer;
  freshnessNote: string | undefined;
  verdict: ReviewVerdict | undefined;
}): Promise<PostAnswerOutcome> {
  // FIRST, before an attachment is settled or the door is asked: an answer whose rendered payload the wire
  // guard would refuse can never be sent, and finding that out mid-send is what threw, read as a break, and
  // posted a public failure card over a live worker — `./runContract.ts`'s `AnswerSendRefusal`. A private
  // copy, rendered ONCE: no caller can change what the gates read across the awaits below, and the payload
  // checked here is the very object sent.
  const answer = structuredClone(offered);
  const payload = answerPayload({ answer, askIdentity, chrome, freshnessNote, mentions });
  const unsendable = unsendableAnswerRefusal({ payload });
  if (unsendable !== undefined) {
    return { kind: "retryable-refusal", refusal: unsendable };
  }
  // Before an attachment is settled: a corrupt profile is fixed and the same dispatch offers again.
  const voice = answerVoiceInput({ answer, home });
  if (voice.isErr()) {
    return { kind: "retryable-refusal", refusal: AnswerSendRefusals.profileUnreadable({ error: voice.error }) };
  }
  const bound = await settledAttachments({ answer, home, uploads, verdict });
  const outcome = await throughDoor({
    gates: answerGates({
      answer,
      atlasReadings: await declinedAtlasReadings({ answer, home }),
      attached: attachedReviewImages({ bound }),
      home,
      judge,
      mentions,
      reply,
      verdict,
      voice: voice.value,
    }),
    home,
    ledger: doorLedger,
    perform: async () => sendAdmittedAnswer({ askIdentity, bound, documents, home, payload, readiness, transport }),
    // Both lanes: the ledger's question is how many files this send attached, and a deliverable the door
    // admitted is as much a file as a screenshot is.
    request: turnDoorRequest({
      askIdentity,
      home,
      mediaCount: uploads.length + documents.length,
      noPictureBecause: answer.noPictureBecause,
      reply,
      turnId,
      verb: "answer",
    }),
  });
  return answerOutcomeOf({ outcome });
}

/**
 * The send itself, once the door has admitted it — of the payload {@link offerAnswer} rendered and checked.
 *
 * Split out of {@link offerAnswer} because of what it is downstream OF, not merely for length.
 * `answerGates` hashes `answer` for `answerQualityGate`'s digest check, and that digest must stay the bytes
 * the reviewer read. The freshness note is the door's own observation about THIS send rather than part of the
 * answer anybody reviewed, so it rides only the rendered payload, which no gate reads — see
 * `./answerFreshnessNote.ts` for the measured defect that comes of getting the order wrong.
 *
 * The two ATTACHMENT lanes part here too, and stay apart to the wire: `bound` is the pictures, already
 * matched to the answer's own image paths and judged by image admission, while `documents` is the
 * deliverable the ask wanted and is judged by neither. `../../corpus/slack/writeSend.ts`'s header carries
 * why a markdown file has no answer to admission's question.
 *
 * @param askIdentity the exact ask this answer belongs to, which decides channel and thread
 * @param bound the attachments, already matched to the answer's own image paths
 * @param documents the deliverable files, admitted by nothing
 * @param home the resolved state home, which image admission reads its records from
 * @param payload the rendered answer, freshness note included, that passed the wire-guard check
 * @param readiness the bounded upload-readiness poll
 * @param transport the Slack write transport
 * @returns what the transport reported about the composite send
 */
async function sendAdmittedAnswer({
  askIdentity,
  bound,
  documents,
  home,
  payload,
  readiness,
  transport,
}: {
  askIdentity: AskIdentity;
  bound: readonly BoundAnswerUpload[];
  documents: readonly SlackUpload[];
  home: string;
  payload: SlackAssistantAnswerPayloadV2;
  readiness: UploadReadiness;
  transport: SlackWriteTransport;
}): Promise<Awaited<ReturnType<typeof runAssistantCompositeSend>>> {
  return runAssistantCompositeSend({
    admit: imageAdmitFor({ env: process.env, home, nowIso: new Date().toISOString() }),
    channel: askIdentity.channel,
    documents,
    payload,
    readiness,
    threadTs: askIdentity.threadTs,
    transport,
    // The bound copies, not the caller's array: these are the exact bytes every digest above was
    // computed over, so what was judged and what is sent cannot come apart.
    uploads: bound.map((attachment) => attachment.upload),
  });
}

/**
 * Read the door's result: posted, deliberately withheld, refused by a warn-tier bar this attempt can still
 * clear, or refused by a `hold` the operator has to see.
 *
 * **The order of the three non-pass branches is the contract.** A withhold is ITSELF warn-tier, so it must be
 * recognised by its finding CODE before the severity question is asked — a withheld draft is this feature
 * working, filed and announced, and reclassifying it as a retryable refusal would leave the person waiting in
 * silence. What is left after it is told apart by severity rather than by code: `status: "warn"` is the door's
 * own statement that every SURVIVING finding is warn-tier (`../../admit/door.ts`), each with an override token
 * and a correction, so the answer can be fixed and offered again inside the same dispatch — see
 * {@link AnswerSendRefusal} for the turn where treating that as terminal cost the answer its dispatch record.
 * A `hold` still throws, unchanged, because nothing about it gets better on a second attempt.
 *
 * @param outcome what `throughDoor` returned
 * @returns the posted, withheld or retryable-refusal outcome
 */
function answerOutcomeOf({
  outcome,
}: {
  outcome: Awaited<ReturnType<typeof throughDoor<Awaited<ReturnType<typeof runAssistantCompositeSend>>>>>;
}): PostAnswerOutcome {
  if (outcome.kind === "performed") {
    // The reaction is settled by `runTurn` through `./indicators.ts`, on EVERY terminal path — not here.
    return { kind: "posted", missingMedia: outcome.result.missingMedia, ref: asRef({ posted: outcome.result }) };
  }
  if (outcome.kind === "recording-refused") {
    // Not a gate's verdict, so neither a withhold nor a retryable refusal: the record of this send could not be
    // written and nothing was sent. Thrown as its own error so it is never read as the bar not being met.
    throw new DoorRecordingRefusedError(
      `the door's decision to post the turn's answer could not be recorded, so nothing was sent — ${outcome.error.message}`,
    );
  }
  const withheld = outcome.decision.findings.find((finding) => finding.code === WITHHOLD_CODE);
  if (withheld !== undefined) {
    return { code: withheld.code, kind: "withheld", reason: withheld.summary };
  }
  const detail = `the admit door refused to post the turn's answer — ${refusalDetail({ decision: outcome.decision })}`;
  if (outcome.decision.status === "warn") {
    return { kind: "retryable-refusal", refusal: AnswerSendRefusals.warnRefused({ message: detail }) };
  }
  throw new DoorRefusedError(detail);
}

/**
 * The live queue sink: file a withheld draft under a fresh id and hand the id back.
 *
 * @param home the resolved state home
 * @param nowIso the clock, injected so an entry's instant is assertable
 * @param mintId mints the entry id; injected so a test can pin it
 * @returns the sink `HoldSink` the turn files through
 */
export function liveHoldSink({
  home,
  nowIso = () => new Date().toISOString(),
  mintId = mintQueueId,
}: {
  home: string;
  nowIso?: () => string;
  mintId?: () => string;
}): HoldSink {
  return async ({ held }) => {
    const id = mintId();
    appendQueueEvent({ event: { held, id, kind: "held", tsIso: nowIso() }, home });
    return { id };
  };
}

/**
 * Name one thread, through the door.
 *
 * Through the door like every other outbound write: naming somebody's thread is a workspace mutation, and the
 * ledger should be able to answer "what did the bot change?" without an exception for the cosmetic ones.
 *
 * It does NOT reuse `routed`, and that is the point of it being its own function: `routed` turns a
 * refusal into a throw, which is right for a post the turn cannot continue without, and wrong for a title the
 * turn survives. Both refusals — the door's and Slack's — come back in the SAME shape, so the caller has one
 * thing to narrate rather than two.
 *
 * @param askIdentity the exact ask whose thread this names
 * @param doorLedger where the door's decision is recorded
 * @param home the resolved state home
 * @param title the thread title
 * @param transport the Slack write transport
 * @param turnId the id correlating this write with its turn
 * @returns ok, or the reason the title could not be set
 */
export async function nameThreadThroughDoor({
  askIdentity,
  doorLedger,
  home,
  title,
  transport,
  turnId,
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  home: string;
  title: string;
  transport: SlackWriteTransport;
  turnId: string;
}): Promise<Result<void, TurnError>> {
  // A thread title is composed per turn and is the FIRST thing a reader meets, which makes it the exact
  // shape a harvest measured leaking: `the bot — live board` is a real title from that
  // set. It reached Slack through this function with no rule ever reading it.
  const rules = readExactVoiceRules({ home });
  if (rules.isErr()) {
    return err(TurnErrors.threadNameUnreadableProfile({ error: rules.error }));
  }
  const voice = voiceInputFor({
    actor: "bot",
    allowVoiceRules: false,
    prose: authoredProseOf({ path: "title", text: title }),
    rules: rules.value,
  });
  if (voice.findings.length > 0) {
    recordExactVoicePainPoints({ findings: voice.findings, home, lane: "as-bot", tsIso: new Date().toISOString() });
  }
  const outcome = await throughDoor({
    gates: [...DEFAULT_GATES, voiceProfileGate(voice.gate)],
    home,
    ledger: doorLedger,
    perform: async () =>
      transport.setThreadTitle({
        args: assistantTitleArgs({ channelId: askIdentity.channel, threadTs: askIdentity.threadTs, title }),
      }),
    request: turnDoorRequest({ askIdentity, home, targetTs: askIdentity.threadTs, turnId, verb: "title" }),
  });
  if (!outcome.performed) {
    return err(TurnErrors.threadNameRefused({ through: outcome }));
  }
  return outcome.result.isOk()
    ? ok(undefined)
    : err(TurnErrors.threadNameFailed({ reason: outcome.result.error.reason }));
}
