/**
 * A Gmail write's raw MIME message as the strings the outbound privacy check judges. Pure bar the parser's own
 * promise: `postal-mime` (pinned) parses asynchronously, so {@link gmailRawMimeLeaves} is async rather than faking a
 * synchronous read. The effectful half — the policy and the refusal — is `./writePrivacy.ts`.
 *
 * ## What is judged
 *
 * The `raw` a draft carries is base64url, decoded STRICTLY: a character outside the alphabet, a stray pad, or bits a
 * re-encode would not reproduce refuses, because Node's decoder silently drops what it cannot read and a dropped run
 * is a run nobody judged. The decoded message is parsed with a real MIME parser, and judged:
 *
 * - the decoded subject, and every From, Sender, Reply-To, To, Cc and Bcc display name and address, groups included;
 * - every OTHER top-level header's value, its RFC 2047 encoded words decoded;
 * - the body: every inline `text/plain` and `text/html` part, which the parser joins in part order, the HTML both as
 *   sent and reduced to text, so a term split by a tag is still found;
 * - every attachment's filename, MIME type, disposition and description;
 * - an attachment's BYTES when its filename has an extension on `TEXT_UPLOAD_EXTENSIONS` or its type is `text/*`,
 *   decoded as strict UTF-8, refusing when they are not; a forwarded `message/rfc822` attachment is opened and judged
 *   the same way, to {@link MAX_ATTACHED_MESSAGE_DEPTH} levels.
 *
 * Every other attachment — an image, a PDF, an archive — passes with its bytes unread: no OCR, EXIF or document
 * extraction. A message the parser refuses (nesting, header size, part count), one over {@link MAX_RAW_MIME_BYTES},
 * and a forwarded message deeper than the bound refuse rather than pass unjudged.
 *
 * ## What the parser does not show, stated
 *
 * A multipart PREAMBLE and EPILOGUE are not exposed, nor are the headers of a nested part beyond its type,
 * disposition, filename and description, nor the filename of an inline text part the parser folds into the body (its
 * text IS judged). Those bytes still leave the machine with the draft.
 */
import PostalMime, { type Address, type Attachment, decodeWords, type Email, type Mailbox } from "postal-mime";

import { err, ok, type Result } from "../../lib/result.js";
import { htmlToText } from "../../live/gmail/htmlToText.js";
import { TEXT_UPLOAD_EXTENSIONS } from "../slack/writePrivacyPayload.js";
import { type GmailWritePayloadError, GmailWritePayloadErrors } from "./writePrivacyErrors.js";

/** One string the Gmail guard judges, and the locus a refusal names it by. */
export interface GmailWriteLeaf {
  readonly locus: string;
  readonly text: string;
}

/** The largest decoded message judged: Gmail's own 35 MB message ceiling, rounded up to a binary unit. */
const MAX_RAW_MIME_BYTES = 36 * 1024 * 1024;

/** How many forwarded `message/rfc822` attachments deep a message is opened before it refuses. */
export const MAX_ATTACHED_MESSAGE_DEPTH = 4;

/** Unpadded or padded base64url, and nothing else. */
const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/u;

/** The headers judged through the parser's decoded fields rather than as raw values. */
const SPECIALISED_HEADERS: ReadonlySet<string> = new Set(["subject", "from", "sender", "reply-to", "to", "cc", "bcc"]);

/**
 * Decode base64url strictly: the alphabet only, at most two pads, and the bytes must re-encode to exactly the input.
 *
 * @param locus where the raw sits in the write, which a refusal opens on
 * @param text the encoded message as the request or response carries it
 * @returns the bytes, or why they cannot be trusted to be what was sent
 */
export function decodeBase64UrlStrict({
  locus,
  text,
}: {
  locus: string;
  text: string;
}): Result<Uint8Array, GmailWritePayloadError> {
  if (!BASE64URL.test(text)) {
    return err(GmailWritePayloadErrors.rawNotBase64Url({ locus }));
  }
  if (Math.floor((text.length * 3) / 4) > MAX_RAW_MIME_BYTES) {
    return err(GmailWritePayloadErrors.rawTooLarge({ locus, maxBytes: MAX_RAW_MIME_BYTES }));
  }
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text.replace(/=+$/u, "")) {
    return err(GmailWritePayloadErrors.rawNotClean({ locus }));
  }
  return ok(new Uint8Array(bytes));
}

/** The leaves of one mailbox or group, each name and address under its own locus. */
function addressLeaves({ locus, address }: { locus: string; address: Address }): GmailWriteLeaf[] {
  if (address.group !== undefined) {
    return [
      { locus: `${locus}.name`, text: address.name },
      ...address.group.flatMap((member: Mailbox, index) =>
        addressLeaves({ address: member, locus: `${locus}.group[${String(index)}]` }),
      ),
    ];
  }
  return [
    { locus: `${locus}.name`, text: address.name },
    { locus: `${locus}.address`, text: address.address },
  ];
}

/** The leaves of an address list field the parser decoded, empty when the header was absent. */
function addressListLeaves({
  locus,
  addresses,
}: {
  locus: string;
  addresses: readonly Address[] | undefined;
}): GmailWriteLeaf[] {
  if (addresses === undefined) {
    return [];
  }
  return addresses.flatMap((address, index) => addressLeaves({ address, locus: `${locus}[${String(index)}]` }));
}

/** Every header and body leaf of one parsed message, attachments aside. */
function messageLeaves({ email, locus }: { email: Email; locus: string }): GmailWriteLeaf[] {
  const leaves: GmailWriteLeaf[] = [];
  if (email.subject !== undefined) {
    leaves.push({ locus: `${locus} subject`, text: email.subject });
  }
  for (const [field, value] of [
    ["from", email.from],
    ["sender", email.sender],
  ] as const) {
    if (value !== undefined) {
      leaves.push(...addressLeaves({ address: value, locus: `${locus} ${field}` }));
    }
  }
  leaves.push(
    ...addressListLeaves({ addresses: email.replyTo, locus: `${locus} replyTo` }),
    ...addressListLeaves({ addresses: email.to, locus: `${locus} to` }),
    ...addressListLeaves({ addresses: email.cc, locus: `${locus} cc` }),
    ...addressListLeaves({ addresses: email.bcc, locus: `${locus} bcc` }),
  );
  for (const header of email.headers) {
    if (!SPECIALISED_HEADERS.has(header.key)) {
      leaves.push({ locus: `${locus} header.${header.key}`, text: decodeWords(header.value) });
    }
  }
  if (email.text !== undefined) {
    leaves.push({ locus: `${locus} text`, text: email.text });
  }
  if (email.html !== undefined) {
    leaves.push(
      { locus: `${locus} html`, text: email.html },
      { locus: `${locus} html as text`, text: htmlToText({ html: email.html }) },
    );
  }
  return leaves;
}

/** An attachment's content as bytes, whichever encoding the parser handed it back in. */
function attachmentBytes({ attachment }: { attachment: Attachment }): Uint8Array {
  const { content } = attachment;
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

/** Whether an attachment's bytes are read as text: a text-like extension, or a `text/*` type. */
function isTextLike({ attachment }: { attachment: Attachment }): boolean {
  if (attachment.mimeType.startsWith("text/")) {
    return true;
  }
  const { filename } = attachment;
  if (filename === null) {
    return false;
  }
  const dot = filename.lastIndexOf(".");
  return dot >= 0 && TEXT_UPLOAD_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}

/** The bytes as UTF-8, or undefined when they are not valid UTF-8. */
function decodeStrictUtf8({ bytes }: { bytes: Uint8Array }): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Every leaf of one attachment, its forwarded message opened, or the refusal for one that cannot be judged. */
async function attachmentLeaves({
  attachment,
  locus,
  depth,
}: {
  attachment: Attachment;
  locus: string;
  depth: number;
}): Promise<Result<readonly GmailWriteLeaf[], GmailWritePayloadError>> {
  const leaves: GmailWriteLeaf[] = [{ locus: `${locus}.mimeType`, text: attachment.mimeType }];
  for (const [field, value] of [
    ["filename", attachment.filename],
    ["disposition", attachment.disposition],
    ["description", attachment.description],
  ] as const) {
    if (typeof value === "string") {
      leaves.push({ locus: `${locus}.${field}`, text: value });
    }
  }
  if (attachment.rfc822DepthExceeded === true) {
    return err(GmailWritePayloadErrors.forwardTooDeep({ bound: undefined, locus }));
  }
  const bytes = attachmentBytes({ attachment });
  if (attachment.mimeType === "message/rfc822") {
    const nested = await mimeLeaves({ bytes, depth: depth + 1, locus: `${locus}.message` });
    return nested.map((inner) => [...leaves, ...inner]);
  }
  if (!isTextLike({ attachment })) {
    return ok(leaves);
  }
  const text = decodeStrictUtf8({ bytes });
  if (text === undefined) {
    return err(GmailWritePayloadErrors.attachmentNotUtf8({ locus }));
  }
  return ok([...leaves, { locus, text }]);
}

/** Parse one message's bytes, or the refusal naming why the parser would not. */
async function parseMessage({
  bytes,
  locus,
}: {
  bytes: Uint8Array;
  locus: string;
}): Promise<Result<Email, GmailWritePayloadError>> {
  try {
    return ok(await PostalMime.parse(bytes));
  } catch (error: unknown) {
    return err(GmailWritePayloadErrors.mimeUnparseable({ cause: error, locus }));
  }
}

/** Every leaf of one decoded message, attachments and forwarded messages included. */
async function mimeLeaves({
  bytes,
  locus,
  depth,
}: {
  bytes: Uint8Array;
  locus: string;
  depth: number;
}): Promise<Result<readonly GmailWriteLeaf[], GmailWritePayloadError>> {
  if (depth > MAX_ATTACHED_MESSAGE_DEPTH) {
    return err(GmailWritePayloadErrors.forwardTooDeep({ bound: MAX_ATTACHED_MESSAGE_DEPTH, locus }));
  }
  const parsed = await parseMessage({ bytes, locus });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const leaves: GmailWriteLeaf[] = messageLeaves({ email: parsed.value, locus });
  for (const [index, attachment] of parsed.value.attachments.entries()) {
    const judged = await attachmentLeaves({ attachment, depth, locus: `${locus} attachments[${String(index)}]` });
    if (judged.isErr()) {
      return err(judged.error);
    }
    leaves.push(...judged.value);
  }
  return ok(leaves);
}

/**
 * Every string a raw MIME message would send that the guard judges, each under its locus.
 *
 * @param locus where the raw sits in the write, `gmail drafts.create message.raw`
 * @param raw the base64url message exactly as the request or the re-read draft carries it
 * @returns the leaves in message order, or the refusal for a message that cannot be judged
 */
export async function gmailRawMimeLeaves({
  locus,
  raw,
}: {
  locus: string;
  raw: string;
}): Promise<Result<readonly GmailWriteLeaf[], GmailWritePayloadError>> {
  const bytes = decodeBase64UrlStrict({ locus, text: raw });
  if (bytes.isErr()) {
    return err(bytes.error);
  }
  return mimeLeaves({ bytes: bytes.value, depth: 0, locus });
}
