/**
 * A forward that KEEPS its attachments, as a draft in the owner's own mailbox: the one multipart message this
 * repository writes. `./compose.ts` builds every other outbound mail as a single text part and says why; this file
 * reuses its header and base64 helpers and adds only what a forward needs — a `multipart/mixed` envelope, a text
 * part carrying the forwarded header block and body, and one part per attachment.
 *
 * Built for one caller: `spend forward` drafting a vendor receipt to Airwallex's receipts address, where the PDF is what Airwallex matches and the subject is left exactly as the receipt's.
 *
 * ## Why the boundary is derived, not random
 *
 * The plan/apply split holds a stored draft to the bytes its plan describes: apply REBUILDS the message and refuses
 * a plan whose `raw` is not what its fields build, exactly as `./outbox.ts` does. A random boundary would make that
 * rebuild differ every time. So the boundary is a hash over the content it separates, prefixed `=_sw_`: every part
 * is base64, whose alphabet holds no `_`, so no line of any part can be the boundary line — by construction, not by
 * a collision check.
 *
 * ## What the approval digest does not cover
 *
 * `./compose.ts`'s `approvalDigest` hashes recipients, subject and body, never an attachment, so a `gmail send` of
 * one of these drafts would not bind the PDF it carries. The fleet never sends these — the owner presses Send in Gmail —
 * and that is why this gap is stated here rather than closed.
 *
 * Pure but for {@link applyGmailForwardDraft}, which is effectful only through the injected Gmail seam.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "./api.js";
import { encodeHeaderValue, toRawBase64Url, validateRecipients, wrapBase64 } from "./compose.js";
import { type GmailError, GmailErrors } from "./errors.js";

/** RFC 5322's line ending, which is not the platform's. */
const CRLF = "\r\n";

/** The largest total attachment size a forward is built with — receipts are kilobytes, so this is headroom. */
export const MAX_FORWARD_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The line a forwarded header block opens with, as Gmail writes it. */
const FORWARD_MARKER = "---------- Forwarded message ---------";

/** The message being forwarded, as the mailbox holds it. */
export interface ForwardSource {
  readonly from: string | undefined;
  readonly to: readonly string[];
  readonly sentAtIso: string | undefined;
  /** Undefined when the message carries no `Subject` header — the forward then carries none either. */
  readonly subject: string | undefined;
  readonly body: string;
}

/** One file the forward carries. */
export interface ForwardAttachment {
  /** The name the file had in the source message, never a local path. */
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** A forward, encoded and ready to store, but not yet stored. */
export interface GmailForwardPlan {
  readonly account: string;
  readonly to: readonly string[];
  readonly source: ForwardSource;
  readonly attachments: readonly ForwardAttachment[];
  /** The complete RFC 5322 message. */
  readonly message: string;
  /** The same message, base64url-encoded the way the API's `raw` field takes it. */
  readonly raw: string;
}

/** A stored forward draft, and how to reach it. */
export interface GmailForwardOutcome {
  readonly draftId: string;
  /** The draft's MESSAGE id — what a Gmail link to the draft addresses; undefined when Gmail returned none. */
  readonly draftMessageId: string | undefined;
}

/** Whether a value carries a C0 control character or DEL, a line break among them. */
function hasControlCharacter({ value }: { value: string }): boolean {
  // Every UTF-16 unit is checked: a surrogate half is 0xD800 or above, so it is never mistaken for a control.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * The text part: the forwarded header block, each line only when the source carries it, then the source's body.
 *
 * @param source the message being forwarded
 * @returns the text, CRLF line endings throughout
 */
export function forwardText({ source }: { source: ForwardSource }): string {
  const header = [FORWARD_MARKER];
  if (source.from !== undefined) {
    header.push(`From: ${source.from}`);
  }
  if (source.sentAtIso !== undefined) {
    header.push(`Date: ${source.sentAtIso}`);
  }
  if (source.subject !== undefined) {
    header.push(`Subject: ${source.subject}`);
  }
  if (source.to.length > 0) {
    header.push(`To: ${source.to.join(", ")}`);
  }
  return `${header.join("\n")}\n\n${source.body}`.replaceAll(/\r?\n/gu, CRLF);
}

/**
 * A `Content-Type` `name` and a `Content-Disposition` `filename` for one file: a quoted string when the name is
 * printable ASCII, else an RFC 2047 encoded-word for `name` (what mail clients read) beside an RFC 2231
 * `filename*` (what the standard says).
 */
function fileParameters({ filename }: { filename: string }): { name: string; disposition: string } {
  if (/^[\x20-\x7e]*$/u.test(filename)) {
    const quoted = filename.replaceAll(/[\\"]/gu, (character) => `\\${character}`);
    return { disposition: `filename="${quoted}"`, name: `name="${quoted}"` };
  }
  const word = `=?UTF-8?B?${Buffer.from(filename, "utf8").toString("base64")}?=`;
  const percent = encodeURIComponent(filename).replaceAll(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return { disposition: `filename*=UTF-8''${percent}`, name: `name="${word}"` };
}

/** The boundary for one message's content — see the file header for why it is derived and cannot collide. */
function boundaryFor({ text, attachments }: { text: string; attachments: readonly ForwardAttachment[] }): string {
  const hash = createHash("sha256").update(text, "utf8");
  for (const attachment of attachments) {
    hash.update(attachment.filename, "utf8").update(attachment.bytes);
  }
  return `=_sw_${hash.digest("hex").slice(0, 24)}`;
}

/**
 * Build the RFC 5322 forward: headers, then a `multipart/mixed` body of the forwarded text and every attachment,
 * each part base64 and CRLF throughout.
 *
 * @param from the address the bound grant writes as
 * @param to the forward's recipients, already validated
 * @param source the message being forwarded; its subject is written unchanged
 * @param attachments the files kept from it
 * @returns the complete message as a string
 */
function buildForwardMessage({
  from,
  to,
  source,
  attachments,
}: {
  from: string;
  to: readonly string[];
  source: ForwardSource;
  attachments: readonly ForwardAttachment[];
}): string {
  const text = forwardText({ source });
  const boundary = boundaryFor({ attachments, text });
  const headers = [`From: ${encodeHeaderValue({ value: from })}`, `To: ${to.join(`,${CRLF} `)}`];
  if (source.subject !== undefined) {
    headers.push(`Subject: ${encodeHeaderValue({ value: source.subject })}`);
  }
  headers.push("MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`);
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64({ encoded: Buffer.from(text, "utf8").toString("base64") }),
  ].join(CRLF);
  const fileParts = attachments.map((attachment) => {
    const { name, disposition } = fileParameters({ filename: attachment.filename });
    return [
      `Content-Type: ${attachment.mimeType}; ${name}`,
      `Content-Disposition: attachment; ${disposition}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64({ encoded: Buffer.from(attachment.bytes).toString("base64") }),
    ].join(CRLF);
  });
  const parts = [textPart, ...fileParts].map((part) => `--${boundary}${CRLF}${part}${CRLF}`).join("");
  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts}--${boundary}--${CRLF}`;
}

/**
 * Every reason a forward cannot be built as asked, all at once.
 *
 * @returns the problems, empty when there are none
 */
function forwardProblems({
  to,
  source,
  attachments,
}: {
  to: readonly string[];
  source: ForwardSource;
  attachments: readonly ForwardAttachment[];
}): readonly string[] {
  const problems: string[] = [...validateRecipients({ entries: to, field: "to" })];
  if (to.length === 0) {
    problems.push("to: at least one recipient is required");
  }
  if (source.subject !== undefined && /[\r\n]/u.test(source.subject)) {
    problems.push("subject: must not contain a line break — a header cannot span lines");
  }
  if (!source.body.isWellFormed()) {
    problems.push("body: carries a lone surrogate, which UTF-8 cannot encode");
  }
  if (attachments.length === 0) {
    problems.push("attachments: a forward that keeps its attachments needs at least one");
  }
  problems.push(...attachments.flatMap((attachment) => attachmentProblems({ attachment })));
  const total = attachments.reduce((sum, attachment) => sum + attachment.bytes.byteLength, 0);
  if (total > MAX_FORWARD_ATTACHMENT_BYTES) {
    problems.push(
      `attachments: ${String(total)} bytes is over the ${String(MAX_FORWARD_ATTACHMENT_BYTES)}-byte forward cap`,
    );
  }
  return problems;
}

/**
 * Every reason one file cannot ride the forward: a name that is empty or spans lines, a malformed MIME type, or a
 * file that calls itself a PDF without opening like one.
 *
 * @returns the problems, empty when there are none
 */
function attachmentProblems({ attachment }: { attachment: ForwardAttachment }): readonly string[] {
  const problems: string[] = [];
  if (attachment.filename.length === 0 || hasControlCharacter({ value: attachment.filename })) {
    problems.push(`attachment ${JSON.stringify(attachment.filename)}: a file name must be non-empty, one line`);
  }
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(attachment.mimeType)) {
    problems.push(`attachment ${attachment.filename}: ${JSON.stringify(attachment.mimeType)} is not a MIME type`);
  }
  const isPdf = attachment.mimeType.toLowerCase() === "application/pdf";
  if (isPdf && Buffer.from(attachment.bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    problems.push(`attachment ${attachment.filename}: says it is a PDF but does not open with %PDF-`);
  }
  return problems;
}

/**
 * Plan a forward: validate it and build its bytes. Stores nothing.
 *
 * @param account the mailbox the grant bound to, which the forward is written from
 * @param to the forward's recipients
 * @param source the message being forwarded, its subject kept exactly
 * @param attachments the files kept from it
 * @returns the plan, or every reason it cannot be built
 */
export function planGmailForwardDraft({
  account,
  to,
  source,
  attachments,
}: {
  account: string;
  to: readonly string[];
  source: ForwardSource;
  attachments: readonly ForwardAttachment[];
}): Result<GmailForwardPlan, GmailError> {
  const problems = forwardProblems({ attachments, source, to });
  if (problems.length > 0) {
    return err(GmailErrors.composeFormRefused({ problems }));
  }
  const message = buildForwardMessage({ attachments, from: account, source, to });
  return ok({ account, attachments, message, raw: toRawBase64Url({ message }), source, to });
}

/**
 * Store a planned forward as a draft in the owner's own mailbox, in ONE attempt — a lost response is never retried,
 * so a caller's one-draft-per-receipt claim holds. Delivers nothing.
 *
 * @param api the Gmail seam's draft call
 * @param plan the plan, refused unless its `raw` is exactly what its fields build
 * @returns the stored draft's ids, or the typed reason it was not stored
 */
export async function applyGmailForwardDraft({
  api,
  plan,
}: {
  api: Pick<GmailApi, "createDraft">;
  plan: GmailForwardPlan;
}): Promise<Result<GmailForwardOutcome, GmailError>> {
  const refusals = [...forwardProblems(plan)];
  const rebuilt = toRawBase64Url({ message: buildForwardMessage({ ...plan, from: plan.account }) });
  if (rebuilt !== plan.raw) {
    refusals.push("raw: the plan's message is not the one its fields build");
  }
  if (refusals.length > 0) {
    return err(GmailErrors.composeFormRefused({ problems: refusals }));
  }
  const created = await api.createDraft({ once: true, raw: plan.raw });
  if (created.isErr()) {
    return err(created.error);
  }
  const messageId = created.value.message.id;
  return ok({ draftId: created.value.id, draftMessageId: typeof messageId === "string" ? messageId : undefined });
}
