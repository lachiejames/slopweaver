/**
 * A withheld answer's attachments — both lanes — locked to the BYTES the turn had when it was held.
 *
 * Split from `./run.ts` on size alone. The turn writes these into a held draft and
 * `../../cli/commands/queue/run.ts` reads them back on release, so the keys and the encoding are the whole
 * contract between the two and live here, where neither side owns the other.
 *
 * TWO keys, because the answer form has two attachment lanes and they are not interchangeable at the wire
 * (`../../corpus/slack/writeSend.ts`'s header). One key holding both would release a deliverable into
 * image admission, which refuses every byte that is not a picture — a held answer that could never be
 * released is a worse failure than one that was never held.
 */

import type { SlackUpload } from "../../corpus/slack/writeTransport.js";

/**
 * The key a held draft's locked image bytes are stored under.
 *
 * Double-underscore-prefixed and named apart from `AnswerFormAnswer`'s own fields on purpose: the queue's
 * `draft` is opaque JSON holding a spread `AnswerFormAnswer` (written by `./run.ts`), and this key must never
 * collide with a real answer-form field, now or after a future schema change.
 */
export const HELD_UPLOADS_KEY = "__heldUploads";

/** The key a held draft's locked DOCUMENT bytes are stored under — {@link HELD_UPLOADS_KEY}'s twin. */
export const HELD_DOCUMENTS_KEY = "__heldDocuments";

/** One held upload, base64-encoded so it survives a JSON round trip through the queue log. */
export interface HeldUpload {
  readonly filename: string;
  readonly bytesBase64: string;
}

/**
 * Lock the answer's images to the BYTES it had at hold time, not the paths.
 *
 * A path is not a proof: the file it names can be replaced or deleted between now and release, and a
 * release that re-read the path would then send different bytes than whatever was reviewed under the same
 * id. Encoding the bytes the turn already loaded is what makes "what you approve is what gets sent" true
 * rather than merely likely.
 *
 * @param uploads the images the turn already read off disk
 * @returns the same uploads, JSON-safe
 */
export function lockUploads({ uploads }: { uploads: readonly SlackUpload[] }): readonly HeldUpload[] {
  return uploads.map((upload) => ({
    bytesBase64: Buffer.from(upload.bytes).toString("base64"),
    filename: upload.filename,
  }));
}
