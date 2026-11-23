/**
 * What each attachment under a held draft IS, read off the stored bytes and the image store — the one input the proof
 * verdict (`../../../outbound/slack/draftProof.ts`) cannot read for itself.
 *
 * Two reads per attachment and no decode: the blob in the private draft media store, verified against the row
 * (`../../../admit/slackDraftMediaStore.ts`), and every image record its digest holds
 * (`../../../visualEvidence/store.ts`). The register's lowercase-hex SHA-256 is the image store's `sha256:` key over
 * the same bytes, so a record is found by content, never by name. A blob a document or video sniffs as is not a
 * picture; anything else is held to the picture's rule, failing toward it. A read that fails is `unread`, which never
 * clears a row.
 *
 * Stored bytes are not decoded again here. The store is written only after admission (`./draftMedia.ts`,
 * `./draftPriorAsk.ts`), which decoded each picture or classified it, and the read verifies every blob against its
 * digest; what that leaves is bytes planted in the store by hand beside a record written by hand, the same local-write
 * residue `../../../outbound/slack/firstMessageProof.ts` states for the records themselves.
 */
import { readSlackDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import type { DraftMediaOf } from "../../../outbound/slack/draftProof.js";
import type { ParkedSlackDraftMedia } from "../../../outbound/slack/draftRegister.js";
import type { DraftMediaEvidence } from "../../../outbound/slack/firstMessageProof.js";
import type { ResolvedImageEvidence } from "../../../visualEvidence/admission.js";
import { attachmentKindOf } from "../../../visualEvidence/attachmentKind.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import { readImageRecords } from "../../../visualEvidence/store.js";
import type { ImageRecord } from "../../../visualEvidence/types.js";

/** The prefix the image store spells a digest with, over the register's bare hex. */
const DIGEST_PREFIX = "sha256:";

/**
 * A picture carrying its records, or `unread` when any record names bytes other than these: a record filed under the
 * wrong digest vouches for nothing here, so it can neither clear the row nor lend its notes to the receipt.
 */
function pictureOf({
  label,
  records,
  sha256,
}: {
  label: string;
  records: readonly ImageRecord[];
  sha256: string;
}): DraftMediaEvidence {
  const digest = `${DIGEST_PREFIX}${sha256}`;
  const stray = records.find((record) => record.artifact.digest !== digest);
  if (stray !== undefined) {
    return {
      kind: "unread",
      sha256,
      why: `an image record for ${label} describes other bytes (${stray.artifact.digest})`,
    };
  }
  return { kind: "picture", records, sha256 };
}

/**
 * Read what each attachment under a row is.
 *
 * @param home the state home both stores live under
 * @param media the row's attachments, in attach order; absent on a row carrying none
 * @returns one entry per attachment, in attach order
 */
export function draftMediaEvidence({
  home,
  media,
}: {
  home: string;
  media: readonly ParkedSlackDraftMedia[] | undefined;
}): readonly DraftMediaEvidence[] {
  if (media === undefined) {
    return [];
  }
  return media.map((entry): DraftMediaEvidence => {
    const read = readSlackDraftMedia({ home, media: [entry] });
    if (read.isErr()) {
      return { kind: "unread", sha256: entry.sha256, why: read.error.message };
    }
    const [verified] = read.value;
    if (verified === undefined) {
      return { kind: "unread", sha256: entry.sha256, why: "the media store answered no bytes" };
    }
    if (attachmentKindOf({ bytes: verified.upload.bytes, filename: verified.upload.filename }) !== undefined) {
      return { kind: "other", sha256: entry.sha256 };
    }
    const records = readImageRecords({ digest: `${DIGEST_PREFIX}${entry.sha256}`, home });
    if (records.isErr()) {
      return { kind: "unread", sha256: entry.sha256, why: records.error.message };
    }
    return pictureOf({ label: entry.name, records: records.value, sha256: entry.sha256 });
  });
}

/**
 * What each attachment a RECORDING admitted is, off the bytes admission read and the records it resolved — so the first
 * message's proof is judged before a byte is stored, on exactly the bytes the row will carry.
 *
 * @param uploads the admitted bytes, in attach order
 * @param evidence the records admission resolved per picture, keyed by digest (shorter than `uploads` beside a document)
 * @returns one entry per upload, in attach order
 */
export function admittedMediaEvidence({
  evidence,
  uploads,
}: {
  evidence: readonly ResolvedImageEvidence[];
  uploads: readonly SlackUpload[];
}): readonly DraftMediaEvidence[] {
  return uploads.map((upload): DraftMediaEvidence => {
    const digest = imageDigestOf({ bytes: upload.bytes });
    const sha256 = digest.slice(DIGEST_PREFIX.length);
    if (attachmentKindOf({ bytes: upload.bytes, filename: upload.filename }) !== undefined) {
      return { kind: "other", sha256 };
    }
    const resolved = evidence.find((one) => one.artifact.digest === digest);
    if (resolved === undefined) {
      return { kind: "unread", sha256, why: `admission resolved no image record for ${upload.filename}` };
    }
    return pictureOf({ label: upload.filename, records: resolved.records, sha256 });
  });
}

/**
 * What each attachment under a HELD row is, read from this home; a resolved row is never judged on its proof, so its
 * stores are not read. `slack draft list` and `talk find-card` both take it, so the Queue and the voice agree.
 *
 * @param home the state home both stores live under
 * @returns the reader a seam listing rows on their proof takes
 */
export function heldMediaOf({ home }: { home: string }): DraftMediaOf {
  return ({ item }) => (item.state === "held" ? draftMediaEvidence({ home, media: item.draft.media }) : []);
}
