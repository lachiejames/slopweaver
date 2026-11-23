/**
 * Turning a typed form into the bytes Gmail accepts, and into the digest an approval is bound to. Pure:
 * no I/O, no clock, no network.
 *
 * ## Why this is hand-rolled rather than a MIME library
 *
 * `nodemailer`'s `MailComposer` was proposed and rejected. Two reasons, in order. Install cost is a live,
 * tracked concern here rather than a hypothetical one, and pulling a mail-transport library in for its
 * builder alone widens every install to ship a client nothing sends through. And a library wrapper is
 * testable only through a fake, whereas the whole of this file is a string in and a string out — the repo's
 * testing rule wants pure functions, and `./htmlToText.ts` is the same call made for the same
 * reason on the reading side. What is built here is deliberately ONE message shape, not a MIME toolkit:
 * a single `text/plain; charset="UTF-8"` part, base64 body, RFC 2047 headers. No attachments, no
 * multipart, no HTML alternative here. The one multipart shape this repository writes — a forward that keeps
 * its attachments — is `./forward.ts`, which reuses this file's header and base64 helpers.
 *
 * ## The encoding choices, stated because each rules out a class of bug
 *
 * - **The body is base64, never quoted-printable or raw.** Raw 8-bit breaks on any non-ASCII character and
 *   on any line over 998 octets; quoted-printable needs soft line breaks, trailing-whitespace escaping and
 *   a `From ` -at-line-start rule. Base64 has one rule — wrap at 76 — and it is correct for every input.
 * - **Headers are RFC 2047 encoded-words only when they need to be.** An all-ASCII subject is written
 *   as-is, so an ordinary message stays readable in the raw bytes a reviewer prints.
 * - **CRLF everywhere.** RFC 5322 line endings are not the platform's.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";
import { hardWrapProblems } from "../../outbound/gmail/paragraphs.js";
import type { MailComposeForm } from "../../outbound/mail/form.js";

/** RFC 5322's line ending, which is not the platform's. */
const CRLF = "\r\n";

/**
 * How many UTF-8 bytes of source text go into one RFC 2047 encoded-word.
 *
 * 45 bytes base64-encode to 60 characters, and `=?UTF-8?B?` + 60 + `?=` is 72 — inside the 75-character
 * limit RFC 2047 § 2 puts on a single encoded-word, with room for the fold's leading space.
 */
const ENCODED_WORD_BYTES = 45;

/** Base64 wraps at 76 characters per RFC 2045 § 6.8. */
const BASE64_LINE_WIDTH = 76;

/** How many characters of the body the preview shows before it is cut. */
const BODY_PREVIEW_WIDTH = 400;

/** How many hex characters of the approval digest are shown and compared. */
const DIGEST_WIDTH = 16;

/** A composed message, before it is anything Gmail has seen — the shared mail form under Gmail's name. */
export type GmailComposeForm = MailComposeForm;

/** The threading headers a reply carries, lifted from the message being replied to. */
export interface GmailReplyContext {
  /** Gmail's own thread id, so the reply lands in the conversation rather than beside it. */
  readonly threadId: string;
  /** The parent's `Message-ID` header value, including its angle brackets. */
  readonly inReplyTo: string;
  /** The parent's `References` chain with the parent appended — the whole ancestry, oldest first. */
  readonly references: readonly string[];
}

/**
 * Whether a string is entirely US-ASCII printable, which is what decides between a raw header value and an
 * RFC 2047 encoded-word.
 */
function isAscii({ value }: { value: string }): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/**
 * Split text into chunks of at most {@link ENCODED_WORD_BYTES} UTF-8 bytes, never splitting a code point.
 *
 * Splitting by JavaScript string index would cut a surrogate pair in half and emit a lone surrogate, which
 * encodes to a replacement character in the recipient's client — a corruption that survives every test
 * written against ASCII input.
 */
function chunkByUtf8Bytes({ value }: { value: string }): readonly string[] {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (bytes + size > ENCODED_WORD_BYTES && current.length > 0) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += codePoint;
    bytes += size;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Encode one header value for transport: as written when it is plain ASCII, as RFC 2047 base64
 * encoded-words when it is not — or when it merely CONTAINS `=?`, since a literal `=?UTF-8?B?…?=` written
 * through as-is would be decoded by every mail client into a different subject than the one recorded.
 *
 * The inverse of `parse.ts`'s {@link ../gmail/parse.decodeEncodedWords}, and the pair is worth keeping in
 * mind together — a subject this repo wrote and then read back should survive the round trip unchanged.
 *
 * @param value the raw header text, in whatever script the author wrote
 * @returns the header value ready to place after its colon
 */
export function encodeHeaderValue({ value }: { value: string }): string {
  if (isAscii({ value }) && !value.includes("=?")) {
    return value;
  }
  return chunkByUtf8Bytes({ value })
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join(`${CRLF} `);
}

/**
 * The address portion of a recipient, accepting both `user@example.com` and `Display Name <user@example.com>`.
 *
 * @param entry one recipient exactly as the form gave it
 * @returns the bare addr-spec, or undefined when no angle-bracketed address is present either
 */
function addrSpec({ entry }: { entry: string }): string | undefined {
  const bracketed = /<([^<>]*)>\s*$/.exec(entry.trim());
  // The pattern's one group is not optional, so a match always captured it (possibly empty).
  const candidate = (bracketed === null ? entry : bracketed[1]!).trim();
  return candidate.length === 0 ? undefined : candidate;
}

/**
 * Every character an addr-spec may contain: RFC 5322 `atext`, the `.` of a dot-atom, and the one `@`.
 *
 * Written as a POSITIVE class, so it says what is allowed rather than enumerating what is not, which is the
 * safer direction for a guard whose job is to stop a `\r\n` reaching a header. It is narrower than printable
 * ASCII on purpose: a `,` `;` `<` `(` or `:` in a bare address is address-list syntax, so `a@b.com,c` would
 * be written through as two recipients where the form recorded one. A quoted local part is refused with it.
 */
const ADDRESS_CHARACTERS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.@-]+$/;

/**
 * Whether an addr-spec is plausibly deliverable.
 *
 * Deliberately a shape check and not a claim of validity: exactly one `@`, something either side of it, a
 * dot in the domain, and nothing outside printable ASCII. Full RFC 5321 address grammar admits forms no
 * real mailbox uses, and the only authority on whether an address exists is the mail server. What this DOES
 * rule out is the class that matters here — a header-injecting newline, and an obvious typo like a missing
 * domain — before anything is sent.
 *
 * **A non-ASCII address is refused, and that is a real limitation rather than an oversight.** An
 * internationalised address (RFC 6531 SMTPUTF8) needs a `SMTPUTF8` capable path end to end, and neither the
 * builder above nor a bare `text/plain` message provides one — so the honest outcome is a refusal naming
 * the address, not a send that mangles it somewhere a sender never sees. Punycode the domain and it passes.
 *
 * Exported because a door reading a draft back (Outlook's send plan) holds the sender and every recipient it
 * shows to the same shape the form held them to.
 *
 * @returns true when the address has exactly the shape above
 */
export function isPlausibleAddress({ address }: { address: string }): boolean {
  if (!ADDRESS_CHARACTERS.test(address)) {
    return false;
  }
  const parts = address.split("@");
  const local = parts[0];
  const domain = parts[1];
  if (parts.length !== 2 || local === undefined || domain === undefined) {
    return false;
  }
  return local.length > 0 && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/**
 * Validate every recipient in one field, naming the field in each problem so a caller reading three
 * messages knows which list to fix.
 *
 * @param entries each recipient exactly as the caller wrote it
 * @param field the header the list belongs to, named in each problem
 * @returns every problem found, empty when every entry is one deliverable-looking mailbox
 */
export function validateRecipients({
  entries,
  field,
}: {
  entries: readonly string[];
  field: string;
}): readonly string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    const address = addrSpec({ entry });
    if (address === undefined) {
      problems.push(`${field}: "${entry}" has no address`);
      continue;
    }
    if (!isPlausibleAddress({ address })) {
      problems.push(`${field}: "${address}" is not a deliverable-looking address`);
      continue;
    }
    if (!isOneMailbox({ entry })) {
      problems.push(
        `${field}: "${entry}" is not one mailbox — put each recipient in its own entry, and quote a name ` +
          'that carries a comma, like "Smith, Jo" <jo@example.com>',
      );
    }
  }
  return problems;
}

/**
 * The RFC 5322 specials an UNQUOTED display name may not carry, `.` aside (`J. Smith` is everyday and every
 * parser reads it as a phrase). Each would start another mailbox (`,` `<` `@`), open a group (`:` `;`),
 * turn text into a comment (`(` `)`), or quote and escape (`"` `\` `[` `]`).
 */
const MAILBOX_SPECIALS = /[<>@,;:()[\]\\"]/;

/**
 * Whether an entry is exactly one mailbox, written so a header carries it on one logical line. A `Name
 * <addr>` entry whose name holds a second address, a list separator or a stray bracket is several mailboxes
 * written as one, and a header built from it would deliver to the last address alone, with the others turned
 * into display-name text. A control character anywhere in a name is refused outright, because an ASCII name
 * is written through unencoded and a `\r\n` in it would start a header of its own. A name inside double
 * quotes may carry any special except a quote or a backslash; a bare address was already held to addr-spec
 * shape.
 */
function isOneMailbox({ entry }: { entry: string }): boolean {
  const trimmed = entry.trim();
  const open = trimmed.lastIndexOf("<");
  if (open === -1) {
    return true;
  }
  const name = trimmed.slice(0, open).trim();
  if (hasControlCharacter({ value: name })) {
    return false;
  }
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    return !/["\\]/.test(name.slice(1, -1));
  }
  return !MAILBOX_SPECIALS.test(name);
}

/** Whether a value carries a C0 control character or DEL, a line break among them. */
function hasControlCharacter({ value }: { value: string }): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a compose form: at least one recipient, every address plausible, no header-injecting newline in
 * the subject, a body UTF-8 can carry byte for byte, and no hard line break inside a body paragraph ({@link
 * ../../outbound/gmail/paragraphs.hardWrapProblems}).
 *
 * Returns EVERY problem rather than the first, because a caller fixing a form wants the whole list —
 * per `.claude/rules/error-handling.md`, a variable-length list of same-shaped problems stays a
 * `readonly string[]` rather than being forced into a discriminated union.
 *
 * @param form the parsed form, before anything has been encoded
 * @returns the form unchanged, or every reason it cannot be composed
 */
export function validateComposeForm({ form }: { form: GmailComposeForm }): Result<GmailComposeForm> {
  const problems: string[] = [
    ...validateRecipients({ entries: form.to, field: "to" }),
    ...validateRecipients({ entries: form.cc, field: "cc" }),
    ...validateRecipients({ entries: form.bcc, field: "bcc" }),
  ];
  if (form.to.length === 0) {
    problems.push("to: at least one recipient is required");
  }
  if (/[\r\n]/.test(form.subject)) {
    problems.push("subject: must not contain a line break — a header cannot span lines");
  }
  problems.push(...composeBodyProblems({ body: form.body }));
  return problems.length > 0 ? err(problems) : ok(form);
}

/**
 * The body's own rules, apart from the rest of the form: not empty, carried by UTF-8 byte for byte, and no
 * hard line break inside a paragraph. Split out so the store step can hold a plan's body to them without
 * re-judging a subject a reply inherited from its parent.
 *
 * @param body the mail body exactly as the form carries it
 * @returns every rule the body breaks, empty when it breaks none
 */
export function composeBodyProblems({ body }: { body: string }): readonly string[] {
  const problems: string[] = [];
  if (body.length === 0) {
    problems.push("body: must not be empty");
  }
  if (!body.isWellFormed()) {
    problems.push(
      "body: carries a lone surrogate, which UTF-8 cannot encode — the draft would not be what was written",
    );
  }
  problems.push(...hardWrapProblems({ body }));
  return problems;
}

/**
 * One recipient as a header writes it. Only a `Name <addr>` entry's DISPLAY NAME is ever encoded: an
 * encoded-word swallowing the angle-bracketed address would leave a client no address to deliver to, so
 * `José <jose@example.com>` becomes `=?UTF-8?B?Sm9zw6k=?= <jose@example.com>`. A name that needs no
 * encoding is written exactly as given, quotes and all. A bare address is NEVER encoded: {@link
 * validateComposeForm} has already held it to a printable-ASCII addr-spec, and an encoded-word is not address
 * syntax, so `=?billing@example.com` is a mailbox to write through, not a header to encode.
 */
function encodeRecipient({ entry }: { entry: string }): string {
  const trimmed = entry.trim();
  const open = trimmed.lastIndexOf("<");
  if (open === -1 || !trimmed.endsWith(">")) {
    return entry;
  }
  const quoted = trimmed.slice(0, open).trim();
  const name = quoted.length >= 2 && quoted.startsWith('"') && quoted.endsWith('"') ? quoted.slice(1, -1) : quoted;
  if (encodeHeaderValue({ value: name }) === name) {
    return entry;
  }
  return `${encodeHeaderValue({ value: name })} ${trimmed.slice(open)}`;
}

/** Fold a recipient list across lines, so a long list does not produce an over-length header line. */
function foldAddressList({ entries }: { entries: readonly string[] }): string {
  return entries.map((entry) => encodeRecipient({ entry })).join(`,${CRLF} `);
}

/**
 * Wrap base64 output to the width RFC 2045 requires.
 *
 * @param encoded one unbroken base64 string
 * @returns the same characters in CRLF-separated lines of at most 76
 */
export function wrapBase64({ encoded }: { encoded: string }): string {
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += BASE64_LINE_WIDTH) {
    lines.push(encoded.slice(index, index + BASE64_LINE_WIDTH));
  }
  return lines.join(CRLF);
}

/**
 * Build the RFC 5322 message for a form — headers, a blank line, and a base64 `text/plain` body.
 *
 * `Bcc` is written as a header on purpose: Gmail's own send path reads it, delivers to those recipients and
 * strips the header from what it hands the visible recipients. Omitting it here would silently drop every
 * blind recipient, which is the failure nobody notices until it matters.
 *
 * @param form the validated form
 * @param from the address the bound grant sends as
 * @param reply the parent's threading headers, when this is a reply
 * @returns the complete message as a string, CRLF throughout
 */
export function buildMimeMessage({
  form,
  from,
  reply,
}: {
  form: GmailComposeForm;
  from: string;
  reply?: GmailReplyContext | undefined;
}): string {
  const headers: string[] = [
    `From: ${encodeHeaderValue({ value: from })}`,
    `To: ${foldAddressList({ entries: form.to })}`,
    ...(form.cc.length > 0 ? [`Cc: ${foldAddressList({ entries: form.cc })}`] : []),
    ...(form.bcc.length > 0 ? [`Bcc: ${foldAddressList({ entries: form.bcc })}`] : []),
    `Subject: ${encodeHeaderValue({ value: form.subject })}`,
    ...(reply === undefined
      ? []
      : [`In-Reply-To: ${reply.inReplyTo}`, `References: ${reply.references.join(`${CRLF} `)}`]),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrapBase64({ encoded: Buffer.from(form.body, "utf8").toString("base64") });
  return `${headers.join(CRLF)}${CRLF}${CRLF}${body}${CRLF}`;
}

/**
 * Encode a built message the way the Gmail API's `raw` field requires — base64url, unpadded.
 *
 * @param message the RFC 5322 message
 * @returns the URL-safe base64 Gmail accepts
 */
export function toRawBase64Url({ message }: { message: string }): string {
  return Buffer.from(message, "utf8").toString("base64url");
}

/**
 * The digest an approval is bound to: a hash over exactly the recipients, subject and body that would go
 * out, and nothing else.
 *
 * What it deliberately excludes is as important as what it covers. The draft id is not in it, so approving
 * a draft approves its CONTENT — edit the draft and the old approval stops matching. The clock is not in
 * it, so an approval does not expire mid-review. And it is order-insensitive in nothing: reordering
 * recipients changes the digest, because a reader who checked a `To` line is entitled to have checked that
 * exact line.
 *
 * `subject` is `string | undefined` rather than a string that may be empty, and the distinction survives
 * into the hash: `JSON.stringify` omits an undefined value, so a message with NO `Subject` header and one
 * with an empty subject digest differently. They are different messages, and a digest that conflated them
 * would let an approval of one admit the other.
 *
 * **What this is not.** It does not authenticate a human, and no docstring here should imply otherwise —
 * the same process that prints the digest can compute it. Its two real properties are that an approval
 * cannot be transplanted onto different content, and that an unapproved send is refused at the door and
 * recorded, so sending takes a second deliberate act with the preview already on screen.
 *
 * `version` is a provider's own revision stamp for the stored draft, for a door whose `body` is a projection
 * that cannot show every edit (Outlook's text view of an HTML draft). Absent, it is omitted from the hash
 * exactly as an absent `subject` is, so a door that passes none digests byte for byte as before.
 *
 * @param from the sending address, which is part of what a reviewer approved
 * @param subject undefined when the message carries no `Subject` header at all
 * @param version the provider's revision stamp, which any edit to the stored draft changes
 * @returns the leading hex characters of the SHA-256 over the canonical content
 */
export function approvalDigest({
  from,
  to,
  cc,
  bcc,
  subject,
  body,
  version,
}: {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
  subject: string | undefined;
  body: string;
  version?: string;
}): string {
  const canonical = JSON.stringify({ bcc, body, cc, from, subject, to, version });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * The first part of a body, for a preview that shows what is being approved without printing a long mail
 * into a terminal.
 *
 * The cut is marked rather than silent: a reviewer who cannot see where a body ends cannot tell an
 * approval preview from the whole message.
 *
 * @param body the full body text
 * @returns the body, or its first characters followed by a visible cut marker
 */
export function previewBody({ body }: { body: string }): string {
  return body.length <= BODY_PREVIEW_WIDTH
    ? body
    : `${body.slice(0, BODY_PREVIEW_WIDTH)}\n… (${String(body.length - BODY_PREVIEW_WIDTH)} more characters, not shown)`;
}
