/**
 * The composite send's ORCHESTRATION — every dangerous decision, in one testable pure-ish function.
 *
 * A media send is N private uploads, then a post, then an update that attaches the files, then a
 * read-back that proves they attached. Four steps, each of which can fail, and the failures are not
 * equally bad:
 *
 * | failure | what a human sees |
 * |---|---|
 * | an upload fails | nothing — no message exists yet |
 * | **the upload never becomes attachable** | **a bot answer that SAYS which image is missing; nothing at all in the as-me lane** |
 * | the post fails | nothing visible, but orphaned private files exist |
 * | **the update fails** | **a card that looks fine and is silently missing its media** |
 * | **the read-back disagrees** | **the same thing, with Slack having claimed success** |
 *
 * The last two are the dangerous ones, and by owner decision they are an INVARIANT VIOLATION rather
 * than a degraded success: media that fails to attach means something is wrong, so the message is deleted
 * and a partial failure fails loudly. So the message is
 * retracted and the whole operation throws, carrying what it did for audit.
 *
 * **The readiness row is deliberately NOT that invariant, and the distinction is where the line sits.** That
 * invariant is about media failing to attach to a message that is already live; a spent readiness wait
 * happens before anything is posted, so there is no half-built message to retract. Throwing there dropped
 * the WHOLE answer — twice in two days (the first was never recovered and drained as
 * no-response, the second only survived because a worker retried 27 minutes later — the asks themselves are
 * in the operator's loop-breakage ledger, never here), which is the quietest failure in this file, not the
 * loudest. So a BOT lane now posts and
 * states the absence in words (`../../outbound/slack/missingMedia.ts`), and the AS-ME lane still refuses,
 * because a note is chrome the owner did not type.
 *
 * Success means post AND update AND read-back all agree. `ok: true` is never trusted, because
 * `chat.postMessage` will happily return it while dropping files on the floor.
 *
 * The steps themselves live in `./writeSendSteps.ts`: this module imports `uploadAll`, `refuseMissingMedia` and
 * `retractAndFail` from there, and `SlackCompositeSendError` is exported from that module only.
 */
import { type MissingUpload, wrapperWithMissingMediaNote } from "../../outbound/slack/missingMedia.js";
import type { PlacementReport } from "../../outbound/slack/placement.js";
import type { SlackRecipeResponsePayload } from "../../outbound/slack/recipeResponse.js";
import type {
  SlackAssistantAnswerPayload,
  SlackCardPayload,
  SlackDripMessagePayload,
  SlackDripSendResult,
  SlackSendResult,
} from "../../outbound/slack/types.js";
import type { ImageAdmit } from "../../visualEvidence/admitUploads.js";
import { refuseMissingMedia, retractAndFail, uploadAll } from "./writeSendSteps.js";
import type { PostedMessage, SlackUpload, SlackWriteTransport, UploadReadiness } from "./writeTransport.js";

/**
 * The post's read-back report as a result field, or nothing when the transport did not read it back — so a
 * fake transport's result stays exactly the shape it always was.
 */
function placementOf({ posted }: { posted: PostedMessage }): { placement?: PlacementReport } {
  if (posted.placement === undefined) {
    return {};
  }
  return { placement: posted.placement };
}

/**
 * A composite send's success result, the same shape from every lane: the posted address, what attached, what never
 * could, and the read-back report when there was one.
 */
function sentResult({
  posted,
  fileIds,
  missing,
}: {
  posted: PostedMessage;
  fileIds: readonly string[];
  missing: readonly MissingUpload[];
}): SlackSendResult {
  return {
    channel: posted.channel,
    fileIds,
    missingMedia: missing,
    ok: true,
    ts: posted.ts,
    ...placementOf({ posted }),
  };
}

/**
 * Perform one composite send.
 *
 * @param transport the raw Slack mutations
 * @param readiness the bounded upload-readiness poll
 * @param channel the destination channel id
 * @param payload the rendered card
 * @param threadTs the parent timestamp when replying in a thread
 * @param uploads the files to attach, in the caller's order
 * @returns the created message's identity and the attached file ids — never void
 */
export async function runCompositeSend({
  transport,
  readiness,
  channel,
  payload,
  threadTs,
  uploads,
  admit,
}: {
  transport: SlackWriteTransport;
  readiness: UploadReadiness;
  channel: string;
  payload: SlackCardPayload;
  threadTs?: string | undefined;
  uploads: readonly SlackUpload[];
  admit: ImageAdmit;
}): Promise<SlackSendResult> {
  const { fileIds, missing } = await uploadAll({
    admit,
    command: "posting an operator card to Slack",
    readiness,
    transport,
    uploads,
  });
  const noted: SlackCardPayload = {
    ...payload,
    attachments: [wrapperWithMissingMediaNote({ missing, wrapper: payload.attachments[0] })],
  };
  const posted = await transport.postCard({ channel, payload: noted, threadTs });
  if (fileIds.length === 0) {
    return sentResult({ fileIds: [], missing, posted });
  }
  try {
    await transport.attachMedia({ fileIds, payload: noted, posted });
  } catch (error) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `chat.update did not attach the media (${String(error)})`,
      transport,
    });
  }
  const attached = await transport.readBackFileCount({ posted });
  if (attached !== fileIds.length) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `read-back found ${String(attached)} files, expected ${String(fileIds.length)}`,
      transport,
    });
  }
  return sentResult({ fileIds, missing, posted });
}

/**
 * The answer's twin of {@link runCompositeSend} — same failure policy (upload → post → attach → read back →
 * retract on mismatch), same accent-only `attachments` wrapper, targeted at
 * {@link SlackAssistantAnswerPayload} instead of the card.
 *
 * A genuine typed twin rather than a `SlackCardPayload | SlackAssistantAnswerPayload` union on
 * {@link runCompositeSend}: `SlackWriteTransport`'s `postCard`/`attachMedia` and
 * `postAssistantMessage`/`attachAssistantMedia` keep the two payload shapes apart at the wire — via distinct
 * metadata/renderer ids, never a wrapper-presence difference now — so genericising the orchestration on top
 * would need a runtime branch exactly where the transport interface is deliberately decision-free. Only the
 * private upload/retract policy is shared, via {@link uploadAll} and {@link retractAndFail}.
 *
 * @param transport the raw Slack mutations
 * @param readiness the bounded upload-readiness poll
 * @param channel the destination channel id
 * @param payload the rendered answer
 * @param threadTs the parent timestamp when replying in a thread
 * @param uploads the IMAGES to attach, in the caller's order — the only lane image admission judges
 * @param documents the DELIVERABLE files to attach after them; see this module's header for why they are
 *   admitted by nothing and still share one `fileIds` list
 * @returns the created message's identity and the attached file ids — never void
 */
export async function runAssistantCompositeSend({
  transport,
  readiness,
  channel,
  payload,
  threadTs,
  uploads,
  documents,
  admit,
}: {
  transport: SlackWriteTransport;
  readiness: UploadReadiness;
  channel: string;
  payload: SlackAssistantAnswerPayload;
  threadTs?: string | undefined;
  uploads: readonly SlackUpload[];
  documents: readonly SlackUpload[];
  admit: ImageAdmit;
}): Promise<SlackSendResult> {
  const { fileIds, missing } = await uploadAll({
    admit,
    command: "posting a bot answer to Slack",
    documents,
    readiness,
    transport,
    uploads,
  });
  const noted: SlackAssistantAnswerPayload = {
    ...payload,
    attachments: [wrapperWithMissingMediaNote({ missing, wrapper: payload.attachments[0] })],
  };
  const posted = await transport.postAssistantMessage({ channel, payload: noted, threadTs });
  if (fileIds.length === 0) {
    return sentResult({ fileIds: [], missing, posted });
  }
  try {
    await transport.attachAssistantMedia({ fileIds, payload: noted, posted });
  } catch (error) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `chat.update did not attach the media (${String(error)})`,
      transport,
    });
  }
  const attached = await transport.readBackFileCount({ posted });
  if (attached !== fileIds.length) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `read-back found ${String(attached)} files, expected ${String(fileIds.length)}`,
      transport,
    });
  }
  return sentResult({ fileIds, missing, posted });
}

/**
 * The recipe response's twin of {@link runAssistantCompositeSend} — same failure policy (upload → post →
 * attach → read back → retract on mismatch), targeted at {@link SlackRecipeResponsePayload} instead of the
 * assistant answer. A genuine typed twin, for the same reason `runAssistantCompositeSend`'s own doc gives:
 * `SlackWriteTransport`'s `postRecipeResponse`/`attachRecipeResponseMedia` keep this payload shape apart at
 * the wire via a distinct metadata/renderer id.
 *
 * @param transport the raw Slack mutations
 * @param readiness the bounded upload-readiness poll
 * @param channel the destination channel id
 * @param payload the rendered recipe response
 * @param threadTs the parent timestamp when replying in a thread
 * @param uploads the files to attach, in the caller's order
 * @returns the created message's identity and the attached file ids — never void
 */
export async function runRecipeResponseCompositeSend({
  transport,
  readiness,
  channel,
  payload,
  threadTs,
  uploads,
  admit,
}: {
  transport: SlackWriteTransport;
  readiness: UploadReadiness;
  channel: string;
  payload: SlackRecipeResponsePayload;
  threadTs?: string | undefined;
  uploads: readonly SlackUpload[];
  admit: ImageAdmit;
}): Promise<SlackSendResult> {
  const { fileIds, missing } = await uploadAll({
    admit,
    command: "posting a recipe response to Slack",
    readiness,
    transport,
    uploads,
  });
  const noted: SlackRecipeResponsePayload = {
    ...payload,
    attachments: [wrapperWithMissingMediaNote({ missing, wrapper: payload.attachments[0] })],
  };
  const posted = await transport.postRecipeResponse({ channel, payload: noted, threadTs });
  if (fileIds.length === 0) {
    return sentResult({ fileIds: [], missing, posted });
  }
  try {
    await transport.attachRecipeResponseMedia({ fileIds, payload: noted, posted });
  } catch (error) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `chat.update did not attach the media (${String(error)})`,
      transport,
    });
  }
  const attached = await transport.readBackFileCount({ posted });
  if (attached !== fileIds.length) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `read-back found ${String(attached)} files, expected ${String(fileIds.length)}`,
      transport,
    });
  }
  return sentResult({ fileIds, missing, posted });
}

/**
 * The AS-ME lane's twin of {@link runCompositeSend} — the same four steps and the same failure policy,
 * targeted at one drip message instead of a card.
 *
 * **The mechanism, stated because the alternative was the obvious guess.** Media attaches by
 * `files.uploadV2` with `channel_id` omitted (a PRIVATE upload) and then `chat.update` with `file_ids`, on
 * the USER token — measured working end to end, read-back 2 of 2, in the owner's own DM. It
 * is NOT `files.completeUploadExternal` with `channel_id` + `initial_comment`, which would post the words
 * as an upload comment and lose the rendered `rich_text` block the whole as-me lane is built on, and it is
 * not a follow-up thread reply either. The images land under the text of the SAME message, which is what
 * "attach its own evidence" has to mean for a claim and its proof to travel together.
 *
 * **The cost, measured in the same run and accepted:** because the attach is an EDIT, Slack marks the
 * message `(edited)` — visible in the live proof, seconds after it posted. That is Slack's own chrome on a
 * message that genuinely was edited, not text put into the owner's mouth, and it is the price of keeping the
 * rendering identical whether or not the message carries files. `initial_comment` would avoid the label and
 * would render the one message with media differently from every other message of the drip.
 *
 * A genuine typed twin rather than a widened {@link runCompositeSend}, for the reason
 * {@link runAssistantCompositeSend}'s own doc gives: `postDripMessage`/`updateDripMessage` take a
 * different payload shape at the wire (no `attachments`, no `metadata`, and `blocks` sent explicitly), so
 * genericising would put a runtime branch inside a transport interface that holds no decisions.
 *
 * @param transport the raw Slack mutations
 * @param readiness the bounded upload-readiness poll
 * @param channel the destination channel id
 * @param payload the rendered drip message, rich or plain
 * @param threadTs the parent timestamp when the message goes into a thread
 * @param uploads the files to attach, in the caller's order
 * @returns the created message's identity and the attached file ids — never void
 */
export async function runDripCompositeSend({
  transport,
  readiness,
  channel,
  payload,
  threadTs,
  uploads,
  admit,
}: {
  transport: SlackWriteTransport;
  readiness: UploadReadiness;
  channel: string;
  payload: SlackDripMessagePayload;
  threadTs?: string | undefined;
  uploads: readonly SlackUpload[];
  admit: ImageAdmit;
}): Promise<SlackDripSendResult> {
  const { fileIds, missing } = await uploadAll({
    admit,
    command: "posting a drip message to Slack",
    readiness,
    transport,
    uploads,
  });
  if (missing.length > 0) {
    refuseMissingMedia({ fileIds, missing, uploads });
  }
  const posted = await transport.postDripMessage({ channel, payload, threadTs });
  if (fileIds.length === 0) {
    return { channel: posted.channel, fileIds: [], ts: posted.ts, ...placementOf({ posted }) };
  }
  try {
    await transport.updateDripMessage({ fileIds, payload, posted });
  } catch (error) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `chat.update did not attach the media (${String(error)})`,
      transport,
    });
  }
  const attached = await transport.readBackFileCount({ posted });
  if (attached !== fileIds.length) {
    return retractAndFail({
      fileIds,
      posted,
      reason: `read-back found ${String(attached)} files, expected ${String(fileIds.length)}`,
      transport,
    });
  }
  return { channel: posted.channel, fileIds, ts: posted.ts, ...placementOf({ posted }) };
}
