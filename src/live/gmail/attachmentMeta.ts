/**
 * What a read REPORTS about one attachment part: its filename, media type and byte count, by metadata only.
 *
 * Split from `./parse.ts`, whose {@link ./parse.isAttachmentPart} is the one criterion for which parts these
 * are, so the two fields the MIME schema leaves optional are each read by a function that says what printing
 * them means. Both are display policy rather than a claim about the bytes: `gmail attachment` (`./attachment.ts`)
 * reads the part again itself, keeps an undeclared type undeclared, and reports the decoded length of what it
 * downloaded, so nothing it saves is shaped by the words chosen here.
 *
 * Pure: no I/O, no SDK client.
 */
import type { GmailAttachment, GmailAttachmentPart } from "./parse.js";

/**
 * The generic binary media type — RFC 2046 § 4.5.1's own name for "arbitrary binary data", and the type a
 * receiving agent is told to treat an unrecognised part as.
 */
const UNDECLARED_MEDIA_TYPE = "application/octet-stream";

/**
 * The media type a read reports for an attachment part. A part whose `mimeType` Gmail omitted or sent as
 * `null` declared no type, and RFC 2046 has a name for undeclared binary data, so that name is reported
 * rather than a blank.
 */
function reportedMimeType({ part }: { part: GmailAttachmentPart }): string {
  const { mimeType } = part;
  if (mimeType == null) {
    return UNDECLARED_MEDIA_TYPE;
  }
  return mimeType;
}

/**
 * The byte count a read reports for an attachment part. An attachment's `body` is always present — it carries
 * the `attachmentId` that made the part an attachment — but its `size` is optional in the schema, and a part
 * Gmail sent no size for is listed as `0` bytes, the read's display for "no size was given"; the fetch never
 * reads this figure, and reports the decoded length of what it actually downloads instead.
 */
function reportedSizeBytes({ part }: { part: GmailAttachmentPart }): number {
  const { size } = part.body;
  if (size == null) {
    return 0;
  }
  return size;
}

/**
 * One attachment part's metadata, as a Slopweaver read reports it. Never the bytes.
 *
 * @param part a part {@link ./parse.isAttachmentPart} has already admitted
 * @returns the filename, media type and byte count the read lists
 */
export function attachmentMetadata({ part }: { part: GmailAttachmentPart }): GmailAttachment {
  return { filename: part.filename, mimeType: reportedMimeType({ part }), sizeBytes: reportedSizeBytes({ part }) };
}
