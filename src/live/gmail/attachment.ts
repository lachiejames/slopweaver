/**
 * `gmail attachment` — fetch ONE attachment's bytes through the door and keep them on disk, owner-only.
 *
 * A read (`gmail read`) reports an attachment by name, media type and size and never downloads it. This is
 * the separate, explicitly requested fetch that sentence promises: the caller names the part, the verb
 * resolves it on a fresh `full` read of the message, and the bytes land under
 * `$SLOPWEAVER_HOME/live/gmail/attachments/<message-id>/`.
 *
 * ## The sender chooses the filename, so the filename never chooses the path
 *
 * An attachment's filename is text written by whoever sent the mail. The on-disk name is therefore BUILT —
 * `<partId>-<stem reduced to [A-Za-z0-9._-]><short alphanumeric extension>` — and the result is checked to
 * sit directly inside the message's own directory before anything is written. The message id is taken from
 * Gmail's RESPONSE and must be alphanumeric, so neither half of the path is caller- or sender-shaped text.
 * The readable filename travels in the output as metadata, exactly as `slack read-thread` does with a file's
 * remote name (`src/live/slack/filePlan.ts`).
 *
 * ## Two size checks, because Gmail's figure is a claim
 *
 * The part's reported size is refused against the ceiling BEFORE any bytes are fetched. After the fetch the
 * DECODED length is compared with the size Gmail returned alongside the data: `Buffer.from(…, "base64url")`
 * silently drops a character it does not recognise, so that comparison is the only corruption witness, and
 * nothing is written when it fails.
 */
import { basename, dirname, join, resolve } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import type { GmailApi } from "./api.js";
import { saveAttachmentBytes, type WriteAttachmentBytes } from "./attachmentSave.js";
import { describeCandidate } from "./candidateLine.js";
import { type GmailError, GmailErrors } from "./errors.js";
import { type GmailPart, isAttachmentPart } from "./parse.js";

/**
 * The default ceiling on one attachment. 25 MiB is Google's own per-message size limit for mail sent through
 * Gmail, so this almost never bites on a real attachment — a coincidence of limits stated as one, not a
 * measurement of this mailbox. It is still worth having: the bytes arrive as base64url inside a parsed JSON
 * body, so a fetch costs roughly twice the file in memory.
 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Gmail message ids are hex; anything outside this is never joined into a path. */
const MESSAGE_ID = /^[A-Za-z0-9]+$/;

/** Gmail part ids are dotted decimals (`0`, `1`, `1.2`). */
const PART_ID = /^[0-9]+(?:\.[0-9]+)*$/;

/** A short alphanumeric extension at the end of a filename, kept so the saved file opens as its type. */
const EXTENSION = /\.([A-Za-z0-9]{1,10})$/;

/** Every run of characters outside the portable filename set. */
const UNSAFE_RUN = /[^A-Za-z0-9._-]+/g;

/** The longest stem kept, so a sender cannot push the path past a filesystem's name limit. */
const MAX_STEM_LENGTH = 100;

/** One attachment part of a message, as the fetch addresses it. */
export interface GmailAttachmentCandidate {
  /** Gmail's address for the part within the MIME tree — what `--part` takes. */
  readonly partId: string | undefined;
  readonly filename: string;
  readonly mimeType: string | undefined;
  /** Gmail's reported size, when it gave one. A claim, re-checked against the decoded bytes. */
  readonly sizeBytes: number | undefined;
  /** Per-read token for `attachments.get`. Used immediately; never printed, never retained. */
  readonly attachmentId: string;
}

/** What the caller named the attachment by. At least one of the two is set. */
export interface GmailAttachmentSelector {
  readonly name: string | undefined;
  readonly partId: string | undefined;
}

/**
 * What `gmail attachment` saved, and where.
 *
 * @internal — the declared shape of {@link GmailAttachmentResult}'s `saved`; no caller names it.
 */
export interface GmailSavedAttachment {
  readonly account: string;
  readonly messageId: string;
  readonly partId: string;
  readonly filename: string;
  readonly mimeType: string | undefined;
  readonly sizeBytes: number;
  readonly localPath: string;
}

/** A completed fetch: the shared provider-read document AND the typed payload. */
export interface GmailAttachmentResult {
  readonly document: ProviderReadDocument;
  readonly saved: GmailSavedAttachment;
}

/**
 * Every attachment part in a MIME tree, depth-first, by the same criterion `gmail read` lists them with.
 *
 * @param part the payload root, or a nested part during the walk
 * @returns each attachment part with the fields a fetch needs
 */
export function attachmentParts({ part }: { part: GmailPart | null | undefined }): readonly GmailAttachmentCandidate[] {
  if (part == null) {
    return [];
  }
  const here: GmailAttachmentCandidate[] = [];
  if (isAttachmentPart(part)) {
    here.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: typeof part.mimeType === "string" ? part.mimeType : undefined,
      partId: typeof part.partId === "string" ? part.partId : undefined,
      sizeBytes: typeof part.body.size === "number" ? part.body.size : undefined,
    });
  }
  if (part.parts == null) {
    return here;
  }
  return [...here, ...part.parts.flatMap((child) => attachmentParts({ part: child }))];
}

/**
 * Require at least one way of naming the attachment. Both may be given, and then both must match.
 *
 * @param name the exact filename, as `gmail read` prints it
 * @returns the selector, or the typed refusal when neither was given
 */
export function checkAttachmentSelector({
  name,
  partId,
}: {
  name: string | undefined;
  partId: string | undefined;
}): Result<GmailAttachmentSelector, GmailError> {
  if (name === undefined && partId === undefined) {
    return err(GmailErrors.attachmentSelectorMissing());
  }
  return ok({ name, partId });
}

/**
 * Pick exactly one attachment part. Zero matches and several matches are both refusals that list the
 * candidates, because two parts sharing a filename (`image.png`, `invite.ics`) is ordinary mail.
 *
 * @param parts every attachment part on the message
 * @param selector what the caller named the attachment by
 * @returns the one matching part, or the typed reason there is not exactly one
 */
export function selectAttachment({
  parts,
  selector,
}: {
  parts: readonly GmailAttachmentCandidate[];
  selector: GmailAttachmentSelector;
}): Result<GmailAttachmentCandidate, GmailError> {
  const checked = checkAttachmentSelector(selector);
  if (checked.isErr()) {
    return err(checked.error);
  }
  const matches = parts.filter(
    (part) =>
      (selector.name === undefined || part.filename === selector.name) &&
      (selector.partId === undefined || part.partId === selector.partId),
  );
  const [only] = matches;
  if (only !== undefined && matches.length === 1) {
    return ok(only);
  }
  const candidates = (matches.length === 0 ? parts : matches).map((candidate) => describeCandidate({ candidate }));
  if (matches.length === 0) {
    const named = [
      ...(selector.name === undefined ? [] : [`--name ${JSON.stringify(selector.name)}`]),
      ...(selector.partId === undefined ? [] : [`--part ${selector.partId}`]),
    ];
    return err(GmailErrors.attachmentNotFound({ candidates, selector: named.join(" ") }));
  }
  return err(GmailErrors.attachmentAmbiguous({ candidates }));
}

/**
 * The on-disk filename for a part: its part id, then the filename's stem reduced to `[A-Za-z0-9._-]` and
 * capped, then a short alphanumeric extension when the filename has one. Never contains a separator.
 *
 * @param partId a part id already checked against the dotted-decimal shape
 * @param filename the sender-chosen filename
 * @returns a single path component
 */
export function attachmentFileName({ partId, filename }: { partId: string; filename: string }): string {
  const extensionMatch = EXTENSION.exec(filename);
  const extension = extensionMatch === null ? "" : `.${extensionMatch[1]!}`;
  const stemSource = extensionMatch === null ? filename : filename.slice(0, extensionMatch.index);
  const stem = stemSource.replaceAll(UNSAFE_RUN, "_").slice(0, MAX_STEM_LENGTH);
  const safeStem = stem.length === 0 ? "attachment" : stem;
  return `${partId}-${safeStem}${extension}`;
}

/**
 * Where one part is saved, CHECKED to sit directly inside `<root>/<messageId>/`.
 *
 * @param root the attachments root from `stateHomePaths`
 * @param messageId the message id as Gmail returned it
 * @param candidate the selected part
 * @returns the containing directory, the file path and the checked part id, or the typed reason neither may be used
 */
export function localAttachmentPath({
  root,
  messageId,
  candidate,
}: {
  root: string;
  messageId: string;
  candidate: GmailAttachmentCandidate;
}): Result<{ directory: string; path: string; partId: string }, GmailError> {
  if (!MESSAGE_ID.test(messageId)) {
    return err(GmailErrors.invalidAddress({ message: `not a Gmail message id: ${JSON.stringify(messageId)}` }));
  }
  const { partId } = candidate;
  if (partId === undefined || !PART_ID.test(partId)) {
    return err(
      GmailErrors.destinationUnusable({
        destination: root,
        reason: `the part has no usable part id (${describeCandidate({ candidate })})`,
      }),
    );
  }
  const base = resolve(root);
  const directory = join(base, messageId);
  const fileName = attachmentFileName({ filename: candidate.filename, partId });
  const path = join(directory, fileName);
  if (dirname(directory) !== base || dirname(path) !== directory || basename(path) !== fileName) {
    return err(
      GmailErrors.destinationUnusable({ destination: path, reason: "the path escapes the message directory" }),
    );
  }
  return ok({ directory, partId, path });
}

/** Unpadded or padded base64url, and nothing else. */
const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/;

/**
 * Decode an attachment body and prove it is the size Gmail said and within the ceiling.
 *
 * @param data the base64url body
 * @param reportedBytes Gmail's size from the attachment response, else from the message part
 * @param maxBytes the ceiling
 * @returns the decoded bytes, or the typed reason they must not be written
 */
export function decodeAttachmentData({
  data,
  reportedBytes,
  maxBytes,
}: {
  data: string;
  reportedBytes: number | undefined;
  maxBytes: number;
}): Result<Buffer, GmailError> {
  const bytes = Buffer.from(data, "base64url");
  // Node's base64url decoder DROPS a character it cannot read and stops at a stray "=", so the only proof
  // nothing was lost is that the bytes re-encode to exactly the input. Gmail may pad; padding carries no data.
  if (!BASE64URL.test(data) || bytes.toString("base64url") !== data.replace(/=+$/, "")) {
    return err(GmailErrors.attachmentCorrupt());
  }
  if (bytes.length > maxBytes) {
    return err(GmailErrors.attachmentTooLarge({ maxBytes, sizeBytes: bytes.length }));
  }
  if (reportedBytes !== undefined && reportedBytes !== bytes.length) {
    return err(GmailErrors.attachmentSizeMismatch({ decodedBytes: bytes.length, expectedBytes: reportedBytes }));
  }
  return ok(bytes);
}

/**
 * Resolve the named part on a fresh `full` read and check everything that can be checked before a fetch:
 * exactly one match, under the ceiling, and a contained local path.
 *
 * @returns the part and where it will be saved, or the typed refusal
 */
async function resolveAttachmentTarget({
  api,
  messageId,
  selector,
  maxBytes,
  root,
}: {
  api: GmailApi;
  messageId: string;
  selector: GmailAttachmentSelector;
  maxBytes: number;
  root: string;
}): Promise<
  Result<
    { candidate: GmailAttachmentCandidate; messageId: string; directory: string; path: string; partId: string },
    GmailError
  >
> {
  const message = await api.getMessage({ format: "full", id: messageId });
  if (message.isErr()) {
    return err(message.error);
  }
  const selected = selectAttachment({ parts: attachmentParts({ part: message.value.payload }), selector });
  if (selected.isErr()) {
    return err(selected.error);
  }
  const candidate = selected.value;
  if (candidate.sizeBytes !== undefined && candidate.sizeBytes > maxBytes) {
    return err(GmailErrors.attachmentTooLarge({ maxBytes, sizeBytes: candidate.sizeBytes }));
  }
  const respondedId = typeof message.value.id === "string" ? message.value.id : messageId;
  const located = localAttachmentPath({ candidate, messageId: respondedId, root });
  if (located.isErr()) {
    return err(located.error);
  }
  return ok({ candidate, messageId: respondedId, ...located.value });
}

/**
 * Fetch one attachment and save it under the attachments root.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param messageId the message carrying the attachment
 * @param selector the filename and/or part id naming it
 * @param maxBytes the ceiling, refused before the fetch and re-checked after decoding
 * @param root the attachments root from `stateHomePaths`
 * @param nowIso the read timestamp source
 * @param writeBytes the atomic owner-only write
 * @returns the saved attachment and its document, or the typed refusal
 */
export async function fetchGmailAttachment({
  api,
  account,
  messageId,
  selector,
  maxBytes,
  root,
  nowIso,
  writeBytes,
}: {
  api: GmailApi;
  account: string;
  messageId: string;
  selector: GmailAttachmentSelector;
  maxBytes: number;
  root: string;
  nowIso: () => string;
  writeBytes: WriteAttachmentBytes;
}): Promise<Result<GmailAttachmentResult, GmailError>> {
  const target = await resolveAttachmentTarget({ api, maxBytes, messageId, root, selector });
  if (target.isErr()) {
    return err(target.error);
  }
  const { candidate, directory, path } = target.value;
  const body = await api.getAttachment({ attachmentId: candidate.attachmentId, messageId: target.value.messageId });
  if (body.isErr()) {
    return err(body.error);
  }
  // Gmail's figure from the attachment response is preferred; when it gave none, the message part's is used.
  let reportedBytes = candidate.sizeBytes;
  if (body.value.size !== undefined) {
    reportedBytes = body.value.size;
  }
  const bytes = decodeAttachmentData({ data: body.value.data, maxBytes, reportedBytes });
  if (bytes.isErr()) {
    return err(bytes.error);
  }
  const written = saveAttachmentBytes({ bytes: bytes.value, directory, path, writeBytes });
  if (written.isErr()) {
    return err(written.error);
  }
  const saved: GmailSavedAttachment = {
    account,
    filename: candidate.filename,
    localPath: path,
    messageId: target.value.messageId,
    mimeType: candidate.mimeType,
    partId: target.value.partId,
    sizeBytes: bytes.value.length,
  };
  return ok({ document: attachmentDocument({ nowIso, saved }), saved });
}

/**
 * The provider-read document for a saved attachment. It carries the path, never the bytes or the token.
 *
 * @returns the document
 */
function attachmentDocument({
  saved,
  nowIso,
}: {
  saved: GmailSavedAttachment;
  nowIso: () => string;
}): ProviderReadDocument {
  return {
    coverage: {
      detail: `one attachment, ${String(saved.sizeBytes)} bytes, saved in full`,
      kind: "bounded",
      residue: [
        `the bytes are stored UNREDACTED and owner-only at ${saved.localPath}; this verb did not read them — open the file`,
        "only this attachment was fetched; the message body and any other attachments were not",
        "the attachment token is issued per read and was not retained",
      ],
    },
    data: saved,
    readAtIso: nowIso(),
    source: "gmail",
    target: { address: `${saved.messageId}/${saved.partId}`, identity: saved.account, kind: "attachment" },
  };
}
