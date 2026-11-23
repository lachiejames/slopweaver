/**
 * The steps every composite send in `./writeSend.ts` is built from — upload and admit the media, refuse when the
 * as-me lane's media never arrived, retract a message that could not be finished — and the error each one raises.
 * Split out under the file-size cap along the line between the STEPS and the four LANES that compose them;
 * `./writeSend.ts`'s header carries the transaction's contract. `uploadAll`, `refuseMissingMedia`, `retractAndFail`
 * and the error, `SlackCompositeSendError`, are exported from here only, and every caller imports them from here;
 * `./writeSend.ts` imports the three steps, and this module imports nothing from it.
 */
import type { MissingUpload } from "../../outbound/slack/missingMedia.js";
import { ImageAdmissionRefused, type ImageAdmit } from "../../visualEvidence/admitUploads.js";
import {
  type PostedMessage,
  readinessFailureReason,
  type SlackUpload,
  type SlackWriteTransport,
  type UploadReadiness,
} from "./writeTransport.js";

/** Raised when the composite could not be completed cleanly. Carries what WAS done, for audit. */
export class SlackCompositeSendError extends Error {
  /** Files uploaded before the failure. They may be orphaned and are worth reporting. */
  readonly uploadedFileIds: readonly string[];
  /** Whether a posted message was successfully retracted. `false` means one is still visible. */
  readonly deletedMessage: boolean;
  /** The message that was posted, when one was, so a human can find it if the delete also failed. */
  readonly posted: PostedMessage | undefined;
  /** The uploads that never became attachable, each carrying its file id and the phase it died in. */
  readonly missing: readonly MissingUpload[];

  constructor({
    message,
    uploadedFileIds,
    deletedMessage,
    posted,
    missing = [],
  }: {
    message: string;
    uploadedFileIds: readonly string[];
    deletedMessage: boolean;
    posted?: PostedMessage | undefined;
    missing?: readonly MissingUpload[];
  }) {
    super(message);
    this.name = "SlackCompositeSendError";
    this.uploadedFileIds = uploadedFileIds;
    this.deletedMessage = deletedMessage;
    this.posted = posted;
    this.missing = missing;
  }
}

/**
 * Upload every file privately, in the caller's order, and wait on each until Slack has processed it.
 *
 * It does NOT throw on a file that never became ready, and that is the change two lost answers bought.
 * A spent wait happens BEFORE anything is posted, so no message is yet half-built and no invariant of the
 * owner's — which is about media that fails to ATTACH to a live message — is in play. Reporting the loss
 * lets each lane apply its own policy: a bot lane states the absence and still answers, the as-me lane
 * refuses. Throwing here made that choice for both, and its choice cost a whole answer twice.
 *
 * ## Image admission runs TWICE, over the WHOLE batch
 *
 * **Before the first byte is offered to Slack.** Never per member: that would put a good first image in the
 * channel and then refuse the second, leaving a reader half an evidence set and no refusal at all.
 *
 * **Again after every upload, before the caller posts.** Admission consulted once
 * at T0 would let a failure another session recorded at T1, mid-upload, go out at T2. The re-check sits HERE and
 * not inside the upload loop because `uploadPrivatelyCall` OMITS `channel_id`: a private upload reaches no
 * reader until a message is posted carrying its id, so the POST is the publish. Refusing at this seam
 * therefore refuses the whole batch before anything is visible; the orphaned private files are the residue
 * `refuseMissingMedia` already cleans up.
 *
 * **The residual window, stated rather than discovered.** The second check is not atomic with the publish
 * and no check here can be: the post and attach that follow are network writes, so a failure ANOTHER session
 * records for these exact bytes during that round trip is not caught. It sits one step
 * after the first window; moving the check later only moves the gap, so it is a regress, not a defect a
 * placement fixes. Closing it needs a lease every recorder honours for the whole send, which nothing needs
 * yet — in every lane here the session that records an image is the one attaching it. Re-measure first.
 *
 * ## `documents` are uploaded beside the images and admitted by NOTHING
 *
 * The bot answer's DELIVERABLE lane (`../../outbound/assistant/answerArm.ts`'s `answerDocumentsSchema`)
 * rides the same transaction and is deliberately kept out of {@link ImageAdmit} entirely. Admission is the
 * visual-evidence store's question — has a human looked at this picture, and did they call it unfit — and a
 * markdown file has no answer to it.
 *
 * **Admission would no longer REFUSE one, and the lane is still right.** `../../visualEvidence/prepareUploads.ts`
 * now carries a file it positively identifies as a non-picture rather than failing its decode — it had to,
 * because `slack post --media` has ONE lane and must take both kinds. What this lane still buys is the
 * ORDERING a reader sees (images first, then deliverables) and the form's own contract, in which a composer
 * says which of the two a file is instead of the door inferring it. A deliverable left in the form's
 * `images` array is refused by `documentsAmongUploads` at the answer verbs, so that contract has teeth.
 *
 * What they are NOT is a second transaction. They join the one `fileIds` list, so the read-back count check
 * — the guard against a message that posts and silently loses its attachments — covers both lanes and
 * cannot disagree with itself. Images upload first, so the ordering a reader sees is the one the answer
 * composed.
 *
 * @returns the ids that became attachable, in upload order, and every upload that never did
 */
export async function uploadAll({
  transport,
  readiness,
  uploads,
  documents = [],
  admit,
  command,
}: {
  transport: SlackWriteTransport;
  readiness: UploadReadiness;
  uploads: readonly SlackUpload[];
  /** The deliverable lane, uploaded after the images and never offered to `admit` — see the doc block. */
  documents?: readonly SlackUpload[];
  admit: ImageAdmit;
  command: string;
}): Promise<{ readonly fileIds: readonly string[]; readonly missing: readonly MissingUpload[] }> {
  // Admission 1 of 2, IMAGES only, whole batch, before any upload — see this function's doc block.
  const admitted = await admit({ uploads });
  if (admitted.isErr()) {
    throw new ImageAdmissionRefused({ command, error: admitted.error });
  }
  const uploaded: { fileId: string; filename: string }[] = [];
  for (const upload of [...uploads, ...documents]) {
    uploaded.push({ fileId: await transport.uploadPrivately({ upload }), filename: upload.filename });
  }
  const fileIds: string[] = [];
  const missing: MissingUpload[] = [];
  for (const { fileId, filename } of uploaded) {
    const outcome = await readiness.waitForFile({ fileId });
    if (outcome.kind === "ready") {
      fileIds.push(fileId);
    } else {
      missing.push({ fileId, filename, reason: readinessFailureReason({ outcome }) });
    }
  }
  // Admission 2 of 2, after the uploads and before the post; the residual window is in the doc block.
  const still = await admit({ uploads });
  if (still.isErr()) {
    throw new ImageAdmissionRefused({ command, error: still.error });
  }
  return { fileIds, missing };
}

/**
 * Refuse a send whose media never became attachable — the AS-ME lane's policy, and only its.
 *
 * The bot lanes degrade with a stated note instead, but the human lane carries no chrome the owner did not
 * type ("as-me lane carries no chrome"), so there is nothing it may add and nothing it may silently drop.
 * The message names every missing file id and the phase its wait died in, which is exactly what the old
 * one-line failure withheld.
 */
export function refuseMissingMedia({
  fileIds,
  missing,
  uploads,
}: {
  fileIds: readonly string[];
  missing: readonly MissingUpload[];
  uploads: readonly SlackUpload[];
}): never {
  const named = missing.map((item) => `${item.filename} (${item.fileId}): ${item.reason}`).join("; ");
  throw new SlackCompositeSendError({
    deletedMessage: false,
    message:
      `${String(missing.length)} of ${String(uploads.length)} upload(s) never became attachable — ` +
      `${named}; nothing was posted`,
    missing,
    uploadedFileIds: [...fileIds, ...missing.map((item) => item.fileId)],
  });
}

/**
 * Retract a message that could not be brought to a genuine finished state, then fail loudly.
 *
 * "Visibly incomplete" rather than "without its media" — this same retraction now also covers a stream that
 * would not finalize, which has nothing to do with attachments. The delete is best-effort and its outcome is
 * reported either way: a failed delete leaves a visibly wrong message up, and saying so is far better than
 * one that implies it was cleaned up.
 */
export async function retractAndFail({
  transport,
  posted,
  fileIds,
  reason,
}: {
  transport: SlackWriteTransport;
  posted: PostedMessage;
  fileIds: readonly string[];
  reason: string;
}): Promise<never> {
  const deleted = await transport.deleteMessage({ posted });
  throw new SlackCompositeSendError({
    deletedMessage: deleted,
    message: deleted
      ? `${reason}; the message was deleted rather than left visibly incomplete`
      : `${reason}; the message could ALSO not be deleted and is still visible at ts ${posted.ts}`,
    posted,
    uploadedFileIds: fileIds,
  });
}
