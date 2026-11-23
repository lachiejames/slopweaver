/**
 * A FIRST message in a channel brings its receipts — an annotated, unobstructed screenshot and a link to where the
 * reader sees it — or it never reaches the owner's Queue, whoever it posts as and whatever it is.
 *
 * ## The rule
 *
 * A standing rule around the need for screenshots, even when posting as the owner tagging the bot: the very first
 * message in the channel comes in with its receipts, because nothing goes anywhere without proof. The first message
 * LEADS with the screenshot, cropped and annotated, REQUIRED not preferred, with the links backing it up;
 * "annotated" is a rectangle drawn over the thing the reader should look at, with notes, on EVERY screenshot; a
 * capture a pop-up covers is retaken, never worked around; a card failing this is sent back without being put in
 * front of the owner.
 *
 * Action drafts that passed `./draftReceipts.ts` on their links alone — as-me posts tagging the bot, top-level in a
 * review channel, with no screenshot — are what this closes.
 *
 * ## What it reads
 *
 * - **A first message** is a row parked at the TOP LEVEL of a conversation that is not a DM
 *   (`./conversationId.ts`: a `G…` group reads as a channel, failing toward the rule), whose act is not a bump — a bump
 *   re-surfaces an earlier message, as receipts already reasons. Its actor and its kind are not read.
 * - **A group DM is a DM here**, because the ruling is about channel posts. A group DM carries a `C…` id like a
 *   channel, so the id cannot say; the row's `groupDm`, stamped at recording off `conversations.info`'s `is_mpim`,
 *   does. A top-level draft into the owner's group DM with three colleagues needs no screenshot or file
 *   attachment. A row without the stamp, every row
 *   recorded before it and any a read could not classify, still owes the proof. Only `--as me` stamps: a bot card is
 *   judged before its conversation read, so a bot card into a group DM still owes it. The stamp is in the digest
 *   (`./draftRegister.ts` `parkedDraftDigest`), and a release re-reads `is_mpim` live before it sends
 *   (`../../cli/commands/slack/releaseGroupDm.ts`), so a stamp written or revised in by hand never carries a send.
 * - **The proof** is all three: a picture under it (`screenshot`; a PDF or a video is not one), a link the reader sees
 *   in it (`link`, `./visibleLinks.ts`), and EVERY picture's image record vouching for the box drawn into its bytes and
 *   for nothing covering it (`annotation`). The record is the digest-keyed one `browser image-record` writes
 *   (`../../visualEvidence/types.ts`), after `browser annotate` drew the boxes onto the capture; its newest record decides, and a picture with ANY failed record — `obscured`
 *   included — never passes, because a failure is terminal for its bytes (`../../visualEvidence/admission.ts`).
 * - **No way past it.** There is deliberately no hatch: every piece is something a recorder can bring, and one that
 *   cannot be had means the card is not ready for the owner.
 *
 * The verdict is computed from the image store at each read, never stamped on the row: a later record that vouches for
 * a box already in the bytes clears a row without a re-cut, and a later failed record sends a cleared one back.
 *
 * ## Residue, stated rather than discovered
 *
 * - The annotation is an ATTESTATION about pixels, as every image record is: the recorder can write a box it did not
 *   look at. What the record buys is that the claim is bound to those bytes and visible on the row.
 * - That the link proves the claim is not decidable; that the reader has something to open is.
 * - The bytes are decoded once, at admission; a list or release trusts the digest-verified bytes recording stored.
 *   A blob planted in the store by hand, beside a record written by hand, is outside what either read can tell apart.
 *
 * Pure: no network, no clock, no filesystem.
 */
import type { ImageAnnotation, ImageRecord } from "../../visualEvidence/types.js";
import { landsTopLevelInChannel } from "./conversationId.js";
import type { ParkedSlackDraft } from "./draftRegister.js";
import { renderedReceiptLinks } from "./visibleLinks.js";

/** Each piece of proof a first message can be missing, in the order a refusal names them. */
const FIRST_MESSAGE_PROOF_MISSING = ["screenshot", "link", "annotation"] as const;

/** One of {@link FIRST_MESSAGE_PROOF_MISSING}. */
export type FirstMessageProofMissing = (typeof FIRST_MESSAGE_PROOF_MISSING)[number];

/**
 * What one attachment under a row is, as the edge read its stored bytes: a picture with every image record its digest
 * holds (oldest first), a file that is not a picture, or bytes the store could not read — which never clears a row.
 */
export type DraftMediaEvidence =
  | { readonly kind: "picture"; readonly sha256: string; readonly records: readonly ImageRecord[] }
  | { readonly kind: "other"; readonly sha256: string }
  | { readonly kind: "unread"; readonly sha256: string; readonly why: string };

/** The annotated picture a cleared first message leads with: its bytes and the notes its boxes carry. */
export interface LeadingReceipt {
  readonly sha256: string;
  readonly notes: readonly string[];
}

/** What a row owes as a first message: the pieces it lacks, and the receipt it leads with once it lacks none. */
export interface FirstMessageProofVerdict {
  readonly missing: readonly FirstMessageProofMissing[];
  readonly leadingReceipt?: LeadingReceipt | undefined;
}

/**
 * Whether a row is a first message in a channel: top-level, not a DM or a group DM, not a bump.
 *
 * @param draft the row's destination, act and group-DM stamp
 * @returns true when the first-message proof bar applies
 */
export function isFirstChannelMessage({
  draft,
}: {
  draft: Pick<ParkedSlackDraft, "act" | "channel" | "groupDm" | "shape" | "threadTs">;
}): boolean {
  return (
    draft.shape === "top-level" &&
    draft.act !== "bump" &&
    draft.groupDm !== true &&
    landsTopLevelInChannel({ channel: draft.channel, threadTs: draft.threadTs })
  );
}

/**
 * The boxes a picture's records vouch for, or `undefined` when they vouch for none: no failed record for its bytes,
 * and its newest record names at least one box and declares nothing covering it.
 *
 * @param records every record its digest holds, oldest first
 * @returns the boxes, or `undefined`
 */
export function vouchedAnnotations({
  records,
}: {
  records: readonly ImageRecord[];
}): readonly ImageAnnotation[] | undefined {
  if (records.some((record) => record.outcome === "failed")) {
    return undefined;
  }
  const newest = records.at(-1);
  if (newest?.outcome !== "passed" || newest.obstruction !== "none") {
    return undefined;
  }
  const { annotations } = newest;
  if (annotations === undefined || annotations.length === 0) {
    return undefined;
  }
  return annotations;
}

/**
 * What a row owes as a first message in a channel — nothing when it is not one.
 *
 * @param draft the row: where it lands, its act and the exact bytes a release would post
 * @param media what each attachment under it is, in attach order, as the edge read the stored bytes
 * @returns the missing pieces, and the leading receipt when none is missing
 */
export function firstMessageProofVerdict({
  draft,
  media,
}: {
  draft: Pick<ParkedSlackDraft, "act" | "channel" | "groupDm" | "shape" | "threadTs"> & { readonly payload: unknown };
  media: readonly DraftMediaEvidence[];
}): FirstMessageProofVerdict {
  if (!isFirstChannelMessage({ draft })) {
    return { missing: [] };
  }
  const pictures = media.filter((entry) => entry.kind === "picture");
  // Bytes the store could not read may well be a picture, so they never read as "no screenshot" — only as unvouched.
  const unread = media.some((entry) => entry.kind === "unread");
  const missing: FirstMessageProofMissing[] = [];
  if (pictures.length === 0 && !unread) {
    missing.push("screenshot");
  }
  if (renderedReceiptLinks({ payload: draft.payload }).length === 0) {
    missing.push("link");
  }
  const boxes = pictures.map((picture) => vouchedAnnotations({ records: picture.records }));
  if (unread || pictures.length === 0 || boxes.some((one) => one === undefined)) {
    missing.push("annotation");
  }
  const [lead] = pictures;
  const [leadBoxes] = boxes;
  if (missing.length > 0 || lead === undefined || leadBoxes === undefined) {
    return { missing };
  }
  return { leadingReceipt: { notes: leadBoxes.map((box) => box.note), sha256: lead.sha256 }, missing };
}

/** What each missing piece asks the recorder to bring. */
const BRING: Readonly<Record<FirstMessageProofMissing, string>> = {
  annotation:
    "every screenshot annotated and clear: a box drawn over what the reader should look at, with its note, every " +
    "pop-up, banner and modal dismissed before the capture, the boxes drawn with `browser annotate`, the output read " +
    "back, and its image record saying so (`browser image-record` on the form annotate wrote, with `annotations: " +
    '[{ rect, note }]` and `obstruction: "none"`). A capture something ' +
    "covers is retaken — `reason: obscured` — never worked around",
  link: "a link to where the reader sees it for themselves (the Vanta control, the Datadog view, the record itself)",
  screenshot: "a screenshot of what it claims, cropped to it: --media <file.png>",
};

/**
 * The refusal for a first message missing proof, every missing piece named, or nothing when none is missing.
 *
 * @param missing what {@link firstMessageProofVerdict} found missing
 * @returns the refusal lines
 */
export function firstMessageProofRefusal({
  missing,
}: {
  missing: readonly FirstMessageProofMissing[];
}): readonly string[] {
  if (missing.length === 0) {
    return [];
  }
  return [
    `this draft is a first message in a channel and is missing ${missing.join(", ")}. The very ` +
      "first message in the channel leads with the receipts, an annotated screenshot and the link backing it, " +
      "even posting as the owner tagging the bot; one without is sent back unseen.",
    ...missing.map((piece) => `bring ${BRING[piece]}`),
    "--self-evident and --tried do not answer this. There is deliberately NO escape hatch here.",
  ];
}
