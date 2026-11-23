/**
 * `outlook attachment` — fetch ONE file attachment's bytes and keep them owner-only under
 * `$SLOPWEAVER_HOME/live/outlook/attachments/<hashed-message-id>/`.
 *
 * Only a `fileAttachment` has bytes to save. An attached Outlook item or a cloud link is refused by KIND,
 * naming it, rather than saved as something it is not. Everything checkable is checked before a byte is
 * fetched: exactly one match, the kind, and the size Graph reports against the ceiling; the fetched length
 * is checked against the ceiling again, since the reported size is Graph's figure and not a promise. The two
 * are NOT compared for equality: Graph documents `size` as the attachment's length without saying it is the
 * `$value` byte count, and with no live mailbox to measure, a check that could refuse every real attachment
 * is worse than none. Gmail's door compares because Gmail's figure is the decoded length.
 *
 * The on-disk name is BUILT, never taken from the sender: the shared Gmail helpers reduce a filename to a
 * safe stem and check the directory tree is real directories all the way up, and the message directory is a
 * hash of the id because an Outlook id is long and carries characters a path should not.
 */
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { attachmentFileName } from "../gmail/attachment.js";
import { prepareAttachmentDirectory } from "../gmail/attachmentSave.js";
import type { OutlookApi } from "./apiCore.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import type { GraphAttachment } from "./graphWire.js";
import type { OutlookMessage } from "./messages.js";

/** The default ceiling, 25 MiB — the same as Gmail's door, so the two refuse the same file. */
export const DEFAULT_OUTLOOK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** How the caller named the attachment: exactly one of the two. */
export type OutlookAttachmentSelector = { readonly name: string } | { readonly attachmentId: string };

/** What was saved, and where. */
export interface OutlookSavedAttachment {
  readonly messageId: string;
  readonly attachmentId: string;
  readonly name: string;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly path: string;
}

/** One attachment as `outlook read` lists it: enough to name it to `outlook attachment`, and no bytes. */
export interface OutlookAttachmentEntry {
  readonly attachmentId: string;
  readonly name: string | null;
  readonly kind: string;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
}

/** A message as `outlook read` shows it: the message, and every attachment it carries. */
export interface OutlookReadMessage {
  readonly message: OutlookMessage;
  readonly attachments: readonly OutlookAttachmentEntry[];
}

/** Writes bytes to a path, owner-only and atomically; throws on failure. */
export type WriteOutlookAttachmentBytes = (args: { path: string; bytes: Buffer }) => void;

/** The kind Graph stamped on an attachment, as a refusal names it. */
function kindOf({ attachment }: { attachment: GraphAttachment }): string {
  return attachment["@odata.type"].replace("#microsoft.graph.", "");
}

/**
 * An attachment's name, or the word the caller chose for one Graph sent unnamed. An early return, because a
 * ternary here is what oxlint's `prefer-nullish-coalescing` rewrites into the `??` `no-silent-fallback` bans.
 */
function nameOrWord({ attachment, unnamed }: { attachment: GraphAttachment; unnamed: string }): string {
  if (attachment.name == null) {
    return unnamed;
  }
  return attachment.name;
}

/** A candidate as a refusal lists it. */
function describe({ attachment }: { attachment: GraphAttachment }): string {
  const name = nameOrWord({ attachment, unnamed: "(unnamed)" });
  return `${name} [${kindOf({ attachment })}] id=${attachment.id}`;
}

/**
 * Attach every message's attachment list, so `outlook read` names what `outlook attachment` can fetch, as
 * `gmail read` does. Only a message Graph flags `hasAttachments` costs a call, and that call is the same
 * metadata-only list `outlook attachment` reads, so the two always agree on names and ids.
 *
 * @param messages the messages read, in the order they are shown
 * @returns each message beside its attachments, or the first list that failed
 */
export async function withOutlookAttachments({
  api,
  messages,
}: {
  api: OutlookApi;
  messages: readonly OutlookMessage[];
}): Promise<Result<readonly OutlookReadMessage[], OutlookError>> {
  const read: OutlookReadMessage[] = [];
  for (const message of messages) {
    if (!message.hasAttachments) {
      read.push({ attachments: [], message });
      continue;
    }
    const listed = await api.listAttachments({ messageId: message.id });
    if (listed.isErr()) {
      return err(listed.error);
    }
    const attachments = listed.value.map((attachment): OutlookAttachmentEntry => ({
      attachmentId: attachment.id,
      contentType: unsetFieldAsNull({ key: "contentType", record: attachment }),
      kind: kindOf({ attachment }),
      name: unsetFieldAsNull({ key: "name", record: attachment }),
      sizeBytes: unsetFieldAsNull({ key: "size", record: attachment }),
    }));
    read.push({ attachments, message });
  }
  return ok(read);
}

/**
 * Pick exactly one attachment by exact name or by id; zero or several matches are refusals listing every one.
 *
 * @param attachments the message's attachment list
 * @param selector what the caller named it by
 * @returns the one attachment, or the refusal
 */
export function selectOutlookAttachment({
  attachments,
  selector,
}: {
  attachments: readonly GraphAttachment[];
  selector: OutlookAttachmentSelector;
}): Result<GraphAttachment, OutlookError> {
  const matches =
    "name" in selector
      ? attachments.filter((attachment) => attachment.name === selector.name)
      : attachments.filter((attachment) => attachment.id === selector.attachmentId);
  const [only] = matches;
  if (only !== undefined && matches.length === 1) {
    return ok(only);
  }
  const named = "name" in selector ? `--name ${selector.name}` : `--attachment-id ${selector.attachmentId}`;
  const ambiguous = matches.length > 1;
  const listed = ambiguous ? matches : attachments;
  return err(
    OutlookErrors.attachmentUnresolved({
      ambiguous,
      candidates: listed.map((attachment) => describe({ attachment })),
      selector: named,
    }),
  );
}

/**
 * Where one attachment is saved, CHECKED to sit directly inside `<root>/<hash>/`.
 *
 * @param root the Outlook attachments root from `stateHomePaths`
 * @param index the attachment's 1-based position on the message, which prefixes the file name
 * @returns the directory and path, or why neither may be used
 */
export function outlookAttachmentPath({
  root,
  messageId,
  index,
  name,
}: {
  root: string;
  messageId: string;
  index: number;
  name: string;
}): Result<{ directory: string; path: string }, OutlookError> {
  const base = resolve(root);
  const directory = join(base, createHash("sha256").update(messageId, "utf8").digest("hex").slice(0, 32));
  const fileName = attachmentFileName({ filename: name, partId: String(index) });
  const path = join(directory, fileName);
  if (dirname(directory) !== base || dirname(path) !== directory || basename(path) !== fileName) {
    return err(
      OutlookErrors.destinationUnusable({ destination: path, reason: "the path escapes the message directory" }),
    );
  }
  return ok({ directory, path });
}

/** Make the message's owner-only directory, then write the bytes into it atomically. */
function saveAttachmentBytes({
  bytes,
  located,
  writeBytes,
}: {
  bytes: Uint8Array;
  located: { directory: string; path: string };
  writeBytes: WriteOutlookAttachmentBytes;
}): Result<void, OutlookError> {
  const { directory, path } = located;
  const prepared = prepareAttachmentDirectory({ directory });
  if (prepared.isErr()) {
    return err(OutlookErrors.destinationUnusable({ destination: directory, reason: prepared.error.message }));
  }
  const written = safeFs({
    execute: () => {
      writeBytes({ bytes: Buffer.from(bytes), path });
    },
    operation: "outlook.attachment.write",
    path,
  });
  if (written.isErr()) {
    return err(OutlookErrors.destinationUnusable({ destination: path, reason: written.error.message }));
  }
  return ok(undefined);
}

/**
 * Fetch one file attachment and save it owner-only.
 *
 * @param messageId the message carrying the attachment
 * @param selector exactly one of `--name` or `--attachment-id`
 * @param maxBytes the ceiling, checked before and after the fetch
 * @param root the Outlook attachments root
 * @param writeBytes the owner-only atomic write
 * @returns what was saved, or the typed refusal
 */
export async function fetchOutlookAttachment({
  api,
  messageId,
  selector,
  maxBytes,
  root,
  writeBytes,
}: {
  api: OutlookApi;
  messageId: string;
  selector: OutlookAttachmentSelector;
  maxBytes: number;
  root: string;
  writeBytes: WriteOutlookAttachmentBytes;
}): Promise<Result<OutlookSavedAttachment, OutlookError>> {
  const listed = await api.listAttachments({ messageId });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const selected = selectOutlookAttachment({ attachments: listed.value, selector });
  if (selected.isErr()) {
    return err(selected.error);
  }
  const attachment = selected.value;
  const name = nameOrWord({ attachment, unnamed: "attachment" });
  if (attachment["@odata.type"] !== "#microsoft.graph.fileAttachment") {
    return err(OutlookErrors.attachmentKindUnsupported({ kind: kindOf({ attachment }), name }));
  }
  if (attachment.size !== undefined && attachment.size > maxBytes) {
    return err(OutlookErrors.attachmentTooLarge({ maxBytes, sizeBytes: attachment.size }));
  }
  const index = listed.value.indexOf(attachment) + 1;
  const located = outlookAttachmentPath({ index, messageId, name, root });
  if (located.isErr()) {
    return err(located.error);
  }
  const bytes = await api.attachmentBytes({ attachmentId: attachment.id, messageId });
  if (bytes.isErr()) {
    return err(bytes.error);
  }
  if (bytes.value.length > maxBytes) {
    return err(OutlookErrors.attachmentTooLarge({ maxBytes, sizeBytes: bytes.value.length }));
  }
  const { path } = located.value;
  const saved = saveAttachmentBytes({ bytes: bytes.value, located: located.value, writeBytes });
  if (saved.isErr()) {
    return err(saved.error);
  }
  return ok({
    attachmentId: attachment.id,
    contentType: unsetFieldAsNull({ key: "contentType", record: attachment }),
    messageId,
    name,
    path,
    sizeBytes: bytes.value.length,
  });
}
