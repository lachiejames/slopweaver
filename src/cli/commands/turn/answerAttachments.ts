/**
 * Reading `turn answer`'s two attachment arrays off disk, and keeping them in their own lanes.
 *
 * Split out of `./postAnswer.ts` (the file-size ratchet) on the seam that file's own header draws: that one
 * is the ORDER of the gates an answer passes, and this is the one step that touches the filesystem for the
 * attachments. A new gate lands there; a new fact about an attachment lands here.
 *
 * ## Two loaders, not one call over both arrays
 *
 * The lanes stay apart from here to the wire — `../../../corpus/slack/writeSend.ts`'s header says why —
 * and a single loaded array would have to be re-split to get them back, which is a guess where the form
 * already carries the answer.
 */
import { loadSlackUploads } from "../../../corpus/slack/uploadFiles.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { documentsAmongUploads } from "../../../visualEvidence/prepareUploads.js";
import { misplacedDocumentLine } from "../../../visualEvidence/refusals.js";

/**
 * Read every image the answer names, or refuse before anything is posted.
 *
 * @param answer the parsed answer form
 * @returns the loaded uploads, in order, or why one could not be read or does not belong in this lane
 */
export async function loadAnswerImages({
  answer,
}: {
  answer: AnswerFormAnswer;
}): Promise<Result<readonly SlackUpload[]>> {
  let uploads: readonly SlackUpload[];
  try {
    uploads = await loadSlackUploads({ paths: answer.images, what: "image" });
  } catch (error) {
    return err([error instanceof Error ? error.message : String(error)]);
  }
  // Image ADMISSION now CARRIES a document rather than refusing it, because `slack post --media` has one
  // lane and must take both kinds. This form has two, so a misplacement is refused by name here instead of
  // being downgraded to the waivable coverage warn it would otherwise become — see `documentsAmongUploads`.
  const misplaced = await documentsAmongUploads({ uploads });
  if (misplaced.length > 0) {
    return err([misplacedDocumentLine({ filenames: misplaced })]);
  }
  return ok(uploads);
}

/**
 * Read every DOCUMENT the answer names, or refuse before anything is posted.
 *
 * A sibling of {@link loadAnswerImages} rather than one call over both arrays; see this module's header.
 *
 * **The lane check is one-directional, and the residue is stated rather than left to be found.** A PICTURE
 * filed in `documents` is uploaded with nothing asked of it, because this lane has never been offered to
 * image admission at all (`../../../corpus/slack/writeSend.ts`). That predates the document arm and is
 * untouched by it; closing it means refusing a decodable image here, which would also refuse the
 * legitimate case of a picture attached as a FILE rather than as evidence. Not decided, not fixed.
 *
 * @param answer the parsed answer form
 * @returns the loaded documents, in order, or why one could not be read
 */
export async function loadAnswerDocuments({
  answer,
}: {
  answer: AnswerFormAnswer;
}): Promise<Result<readonly SlackUpload[]>> {
  try {
    return ok(await loadSlackUploads({ paths: answer.documents, what: "document" }));
  } catch (error) {
    return err([error instanceof Error ? error.message : String(error)]);
  }
}
