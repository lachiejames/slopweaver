/**
 * The shape of the ATTACH-UPLOAD half a `ruling` may carry: the owner's word on whether `github attach upload` may
 * send a picture or a recording off this machine. A leaf of types, so `./ledger.ts` can name it without importing the
 * reader (`./attachUploadRuling.ts`) that walks every journal.
 */

/** The two answers the owner can give. There is no third: an install with neither recorded is closed. */
export const ATTACH_UPLOAD_VERDICTS = ["permitted", "refused"] as const;

/** One of {@link ATTACH_UPLOAD_VERDICTS}. */
export type AttachUploadVerdict = (typeof ATTACH_UPLOAD_VERDICTS)[number];

/** What a ruling carrying the half records. */
export interface AttachUploadRuling {
  readonly verdict: AttachUploadVerdict;
}
