/**
 * How a `gmail attachment` refusal names one candidate part: part id first, because that is what the caller
 * passes next, then the sender's filename, media type and size.
 *
 * Every slot is filled even when Gmail left the field off the part, and each one says which field is missing
 * rather than printing a blank a reader would take for an empty value. Pure.
 */
import type { GmailAttachmentCandidate } from "./attachment.js";

/**
 * The part-id slot. Gmail's schema declares `partId` optional; a part listed without one cannot be named by
 * `--part` at all, so the slot says so instead of offering nothing to copy.
 */
function partIdShown({ candidate }: { candidate: GmailAttachmentCandidate }): string {
  const { partId } = candidate;
  if (partId === undefined) {
    return "(no part id)";
  }
  return partId;
}

/**
 * The media-type slot. Gmail's schema declares a part's `mimeType` optional, and a part that declared none is
 * shown as of unknown type rather than guessed at.
 */
function mimeTypeShown({ candidate }: { candidate: GmailAttachmentCandidate }): string {
  const { mimeType } = candidate;
  if (mimeType === undefined) {
    return "unknown type";
  }
  return mimeType;
}

/**
 * One candidate as a refusal names it.
 *
 * @param candidate the attachment part, as {@link ./attachment.attachmentParts} listed it
 * @returns `part <id> "<filename>" (<type>, <size>)`
 */
export function describeCandidate({ candidate }: { candidate: GmailAttachmentCandidate }): string {
  const partId = partIdShown({ candidate });
  const mimeType = mimeTypeShown({ candidate });
  const size = candidate.sizeBytes === undefined ? "size unknown" : `${String(candidate.sizeBytes)} bytes`;
  return `part ${partId} ${JSON.stringify(candidate.filename)} (${mimeType}, ${size})`;
}
