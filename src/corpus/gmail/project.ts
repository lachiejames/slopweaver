/**
 * Project parsed Gmail messages into `CorpusRecord`s — and, in doing so, settle what a mail record is
 * ALLOWED to carry. Pure and deterministic: the same message always projects to the same record, which is
 * what makes a re-crawl a no-op at the write path.
 *
 * ## The hygiene ruling, which is this connector's real content
 *
 * The doc this connector was built from asked whether mail should be scrubbed harder than the other four
 * sources. It is NOT, and the reason is that the existing scrub already removes the one class a mailbox
 * adds in bulk. {@link ../redact.redactText} replaces every address with `[email]` and leaves the display
 * name beside it, so `"Jane Smith" <jane@example.com>` is stored as `"Jane Smith" <[email]>`: who wrote it
 * survives, how to reach them does not. That is the correct trade for mail, and it arrives free.
 *
 * What the ruling DID have to add is a rule about the fields the scrub does not fully reach. The bronze
 * writer scrubs `text`, `title`, `attrs` and `raw` whole, scrubs only ADDRESSES out of `author`, and leaves
 * `container`, `sourceId` and `url` alone. So:
 *
 *  - **`author` is the sender's display name, never their address** ({@link ../personName.personName}).
 *    When a sender has no display name, the address's local part is used, which is the same class of
 *    identifier as a Slack handle or a GitHub login and is the only name a bare address carries. The
 *    writer's own scrub would only leave `[email]` there. The full `From:` header rides on `attrs.from`,
 *    where the scrub reaches it.
 *  - **`raw` is not retained at all.** Every other connector keeps the whole SDK payload so a future
 *    feature never forces a re-fetch, and for a mailbox that payload is the base64 MIME tree — the entire
 *    message, headers, addresses and all, in a field whose retention argument is "we might want it later".
 *    Redaction does reach it, but redacting a base64 body leaves the base64 body: the scrub's patterns
 *    match text, and the payload is not text at the point it is stored. So bronze keeps the parsed
 *    projection and nothing else, and a mail record is the one record in this corpus that is genuinely
 *    lossy on purpose. Re-reading a message is a `slopweaver gmail read <id>` away, which is exactly what
 *    {@link ../../live/recordReadPlan.recordReadPlan} returns for this source.
 *
 * ## Why no label list, and why the container is what it is
 *
 * A Gmail label is the owner's filing, not the message. `UNREAD` flips the first time the owner opens it, `INBOX`
 * disappears the first time the owner archives it, and `STARRED`/`IMPORTANT` move on their own. Bronze dedups on a
 * content fingerprint, so carrying those would append a fresh line per label flip for zero content change
 * — a mailbox that grows every time it is READ. So the volatile set is dropped
 * ({@link VOLATILE_LABELS}) and what remains is carried.
 *
 * `container` is documented as a LOW-CARDINALITY grouping, which rules out the thread id (measured: 92
 * distinct threads across 100 sampled messages) and the sender domain (21 across the same 100). It is the
 * Gmail CATEGORY — assigned once at delivery by Gmail's own classifier and effectively immutable — with
 * `sent` winning when the message is one the owner sent, since a sent message carries no category. That
 * bucket is worth having rather than merely cheap: of 100 sampled messages 73 were `updates` or
 * `promotions`, so the container is the axis that separates notification noise from correspondence, and it
 * is what `--sample` and the audit report bucket by.
 */
import type { DocContent } from "../../live/gmail/docs.js";
import type { ParsedGmailMessage } from "../../live/gmail/parse.js";
import { personName } from "../personName.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";
import {
  documentAttendees,
  isMeetingNotesEmail,
  type MeetingNotesEmail,
  mergeAttendees,
  readMeetingNotesEmail,
} from "./geminiNotes.js";
import { stripQuotedTail } from "./quoted.js";
import { transcriptBlock } from "./transcriptBlock.js";

/**
 * Labels that describe the owner's CURRENT relationship to a message rather than the message.
 *
 * Every one of these changes without the message changing, which is why none of them may reach a record
 * that is deduplicated on a content fingerprint. `INBOX` is in the list for the same reason as `UNREAD`,
 * and is the one that looks durable and is not: archiving removes it.
 */
const VOLATILE_LABELS: ReadonlySet<string> = new Set(["UNREAD", "INBOX", "STARRED", "IMPORTANT"]);

/** Gmail's delivery categories, lower-cased into the container bucket each one names. */
const CATEGORY_BUCKETS: Readonly<Record<string, string>> = {
  CATEGORY_FORUMS: "forums",
  CATEGORY_PERSONAL: "personal",
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_SOCIAL: "social",
  CATEGORY_UPDATES: "updates",
};

/**
 * How many recipients are stored per address list before the rest becomes a count.
 *
 * MEASURED on 99 real messages (`gmail list --limit 100`, then `gmail read` each): the recipient count is
 * p50 1, p90 2, and exactly TWO messages carry more than ten — both company-wide invitations, one with 63.
 * So a bound of twenty stores 97 of 99 conversations whole and collapses only the distribution lists, where
 * the roll is noise and the SIZE is the signal. `recipientCount` carries that signal unconditionally, so a
 * truncated list never reads as a complete one.
 *
 * Reproduce: `slopweaver gmail list --limit 100 --json`, then `gmail read <id> --json` per id, counting
 * `to.length + cc.length`.
 */
export const MAX_STORED_RECIPIENTS = 20;

/** The bucket for a message the owner sent, which Gmail gives no delivery category at all. */
const SENT_BUCKET = "sent";

/** The bucket for a message with neither a delivery category nor the `SENT` label. */
const UNCATEGORISED_BUCKET = "other";

/**
 * The display name from an address header, or the address's local part when it carries none.
 *
 * NEVER the full address: the bronze writer would reduce one in `author` to `[email]` (see the module note),
 * so this is the choke-point that keeps a NAME there instead. A local part is the same class of identifier as a Slack handle — it
 * names a person without carrying the route to them — and it is the only name a bare address has. Pure.
 *
 * @param header the raw `From:` value, or undefined when the message carried none
 * @returns the sender's name, or undefined when there is no header to take one from
 */
export function senderName({ header }: { header: string | undefined }): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const split = splitAddressHeader({ header });
  return personName({ address: split.address, displayName: unquote({ value: split.display }) });
}

/**
 * Split `Display Name <address>` into its two halves, by INDEX rather than by pattern.
 *
 * Written as a scan because the obvious regex — `^\s*(.*?)\s*<([^>]+)>\s*$` — is polynomial-backtracking
 * and the repo's `redos-check` gate refuses it, correctly: a lazy group flanked by two `\s*` gives the
 * engine quadratically many ways to divide the same prefix, and a header is attacker-supplied text arriving
 * from anyone who can send mail. Indices have one answer and cannot backtrack at all. Pure.
 *
 * @param header the raw address header
 * @returns the display half (empty when the header is a bare address) and the address half
 */
function splitAddressHeader({ header }: { header: string }): { display: string; address: string } {
  const trimmed = header.trim();
  const open = trimmed.lastIndexOf("<");
  // The `>` must CLOSE the header, so a stray `<` inside a display name cannot make the tail read as an
  // address. A header that does not end in `>` is a bare address, which is the other legal RFC 5322 form.
  if (open === -1 || !trimmed.endsWith(">")) {
    return { address: trimmed, display: "" };
  }
  return { address: trimmed.slice(open + 1, -1).trim(), display: trimmed.slice(0, open).trim() };
}

/**
 * Strip one pair of surrounding double quotes, which RFC 5322 allows around a display name. Pure.
 *
 * @param value the display half, already trimmed
 * @returns the value without its outer quotes, trimmed again
 */
function unquote({ value }: { value: string }): string {
  const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  return (quoted ? value.slice(1, -1) : value).trim();
}

/**
 * The low-cardinality container for a message: `mail/<bucket>`.
 *
 * @param labelIds every label Gmail reported on the message
 * @returns the container, one of a fixed handful of values
 */
export function gmailContainer({ labelIds }: { labelIds: readonly string[] }): string {
  if (labelIds.includes("SENT")) {
    return `mail/${SENT_BUCKET}`;
  }
  const category = labelIds.find((label) => label in CATEGORY_BUCKETS);
  return `mail/${category === undefined ? UNCATEGORISED_BUCKET : CATEGORY_BUCKETS[category]}`;
}

/**
 * The Gmail web permalink for one message.
 *
 * `#all/` rather than `#inbox/` deliberately: the fragment names the view the message is opened IN, and a
 * link into `#inbox` breaks the moment the message is archived — which, measured on the sampled mailbox, is
 * the state 94 of 100 messages are already in. `#all` resolves for every message regardless of filing.
 *
 * @param id the Gmail message id
 * @returns the permalink
 */
export function gmailPermalink({ id }: { id: string }): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

/** One attachment rendered as a single stable string, since `attrs` holds no nested objects. */
function attachmentLine({
  attachment,
}: {
  attachment: { filename: string; mimeType: string; sizeBytes: number };
}): string {
  return `${attachment.filename} (${attachment.mimeType}, ${String(attachment.sizeBytes)} bytes)`;
}

/**
 * The rich attributes for one message.
 *
 * @param message the parsed message
 * @param droppedChars how many characters the quoted-tail strip removed, recorded so the projection's one
 *   lossy step is visible in the corpus rather than only in its source
 * @returns the attribute bag, with absent fields omitted rather than emptied
 */
function gmailAttrs({
  message,
  droppedChars,
}: {
  message: ParsedGmailMessage;
  droppedChars: number;
}): Readonly<Record<string, CorpusAttributeValue>> {
  const labels = message.labelIds.filter((label) => !VOLATILE_LABELS.has(label));
  const to = message.to.slice(0, MAX_STORED_RECIPIENTS);
  const cc = message.cc.slice(0, MAX_STORED_RECIPIENTS);
  return {
    bodyFormat: message.bodyFormat,
    quotedCharsDropped: droppedChars,
    // Unconditional, so a bounded list is never mistaken for a complete one — the same reason every read in
    // `src/live` states its residue rather than presenting a page as a total.
    recipientCount: message.to.length + message.cc.length,
    threadId: message.threadId,
    ...(message.from !== undefined ? { from: message.from } : {}),
    ...(to.length > 0 ? { to } : {}),
    ...(cc.length > 0 ? { cc } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(message.attachments.length > 0
      ? {
          attachmentCount: message.attachments.length,
          attachments: message.attachments.map((attachment) => attachmentLine({ attachment })),
        }
      : {}),
  };
}

/**
 * Project one parsed message into a corpus record, or decline it.
 *
 * A message with no resolvable send time is DECLINED rather than dated from the clock. `tsIso` drives the
 * window, the pooled cursor and the recency decay every answer is ranked by, so a guessed date is not a
 * small inaccuracy — it is a record that reads as today's news forever. The mail door already models the
 * absence honestly (`sentAtIso` is `string | undefined`, never a stand-in), and this is where that honesty
 * has to be paid for.
 *
 * @param message the parsed message
 * @returns the record, or undefined when the message carries no send time to date it by
 */
export function projectGmailMessage({ message }: { message: ParsedGmailMessage }): CorpusRecord | undefined {
  if (message.sentAtIso === undefined) {
    return undefined;
  }
  const stripped = stripQuotedTail({ body: message.body });
  const author = senderName({ header: message.from });
  const record: CorpusRecord = {
    attrs: gmailAttrs({ droppedChars: stripped.droppedChars, message }),
    container: gmailContainer({ labelIds: message.labelIds }),
    kind: "message",
    refs: extractRefs({ text: stripped.text }),
    source: "gmail",
    sourceId: message.id,
    text: stripped.text,
    tsIso: message.sentAtIso,
    url: gmailPermalink({ id: message.id }),
    ...(author !== undefined ? { author } : {}),
    ...(message.subject !== undefined ? { title: message.subject } : {}),
  };
  // `private` is redundant with `isAlwaysPrivateSource`, and the redundancy is the point: the default is
  // PUBLIC, so a single projection path that forgot to stamp would put a mailbox into a non-owner's lane
  // with nothing to show it had happened. Two independent failures are needed rather than one omission.
  return stampVisibility({ record, visibility: "private" });
}

/** The bucket every meeting transcript lands in — its own, so a mailbox's meetings are one container. */
const MEETING_BUCKET = "mail/meetings";

/**
 * How many characters of transcript one record stores.
 *
 * A bound rather than a budget, and the number is the corpus's own: a record is embedded and retrieved
 * whole, and an hour of transcript is far longer than any other record in this corpus. Truncation is
 * REPORTED on the record (`transcriptCharsDropped`) rather than silent, which is the same contract the
 * quoted-tail strip already carries — the projection's lossy steps are visible in the corpus, never only
 * in its source.
 *
 * Measured on the owner's corpus: the longest raw transcript across 41 read documents is
 * 74,324 characters, so this bound is well clear of a real meeting and exists to stop an unbounded
 * document, not to shape a normal one. The population is the 41 read `transcript` documents in the owner's
 * own corpus on that date; the command that took the reading has since been retired, so the figure stands on
 * its date rather than on a repro this file cannot honestly hand a reader.
 */
export const MAX_TRANSCRIPT_CHARS = 120_000;

/**
 * The record body: the raw transcript, bounded.
 *
 * There is no summary half and no tab headings, and that absence is the whole change this function
 * carries. It used to lead with the email's own inline summary and append every tab under its title —
 * which put Gemini's prose about the call, and Google's mail chrome around it, into a record whose kind
 * promises raw speech. Only the transcript is stored. Pure.
 *
 * @param transcript the raw transcript {@link ./transcriptBlock.transcriptBlock} found
 * @returns the body text and how many characters the bound removed
 */
export function meetingBody({ transcript }: { transcript: string }): {
  text: string;
  droppedChars: number;
} {
  const whole = transcript.trim();
  if (whole.length <= MAX_TRANSCRIPT_CHARS) {
    return { droppedChars: 0, text: whole };
  }
  return { droppedChars: whole.length - MAX_TRANSCRIPT_CHARS, text: whole.slice(0, MAX_TRANSCRIPT_CHARS) };
}

/**
 * Project one recognised meeting-notes email — plus the document it linked — into a `transcript` record,
 * or REFUSE the meeting when no raw transcript can be had.
 *
 * Three refusals, and each is a meeting that produces no record at all rather than a record holding
 * something else: a carrier with no send time to date it by, a document that was not read, and a document
 * that was read and carries only Gemini's summary. The last two used to project the emailed summary as the
 * meeting's whole text — see {@link meetingBody} for the ruling that removed it. A refused meeting is
 * counted and reported by {@link projectGmailMessages}, never dropped in silence.
 *
 * The record is dated by the MESSAGE, not by the date text in the subject. Google mails the notes within
 * minutes of the call ending, so the message instant is the meeting's instant to within an ordinary
 * rounding, and it is an exact instant this code did not have to parse out of a human-written date in an
 * unstated timezone. The subject's date text is carried on `attrs.meetingDate` so a reader can see what
 * Google itself said.
 *
 * @param message the parsed carrier email
 * @param notes what {@link ./geminiNotes.readMeetingNotesEmail} read out of it
 * @param document the linked document, when one was read
 * @returns the record, or undefined when this meeting has no raw transcript to store
 */
export function projectMeetingTranscript({
  message,
  notes,
  document,
}: {
  message: ParsedGmailMessage;
  notes: MeetingNotesEmail;
  document: DocContent | undefined;
}): CorpusRecord | undefined {
  const outcome = meetingOutcome({ document, message, notes });
  return outcome.kind === "projected" ? outcome.record : undefined;
}

/**
 * What projecting ONE recognised meeting-notes email produced: its record, or which of the three refusals
 * {@link projectMeetingTranscript} documents stopped it. The refusals are tested in that order, so a mail with
 * no send time reads `undated` whatever its document holds.
 */
export type MeetingProjectionOutcome =
  | { readonly kind: "projected"; readonly messageId: string; readonly record: CorpusRecord }
  | { readonly kind: "undated"; readonly messageId: string }
  | { readonly kind: "unread"; readonly messageId: string }
  | { readonly kind: "summary-only"; readonly messageId: string };

/**
 * Project one recognised meeting-notes email and say why when it produced no record — the per-message answer
 * `gmail clear-meeting-notes` cards a kept mail by, from the exact code a refresh stores a transcript with, so the
 * two can never disagree about what a transcript is. Pure.
 *
 * @param message the parsed carrier email, already recognised by `isMeetingNotesEmail`
 * @param document the linked document, when one was read
 * @returns the record, or the refusal that stopped it
 */
export function meetingProjection({
  message,
  document,
}: {
  message: ParsedGmailMessage;
  document: DocContent | undefined;
}): MeetingProjectionOutcome {
  return meetingOutcome({ document, message, notes: readMeetingNotesEmail({ message }) });
}

/**
 * A transcript record's title. The meeting's own title, lifted from the notes email's subject, comes first;
 * a subject that carried none leaves the linked document's title, and a document with no title leaves none.
 */
function transcriptTitle({ notes, document }: { notes: MeetingNotesEmail; document: DocContent }): string | undefined {
  if (notes.meetingTitle !== undefined) {
    return notes.meetingTitle;
  }
  return document.title;
}

/**
 * A transcript record's url. The Google Doc the notes email linked holds the transcript, so it comes first; an
 * email that linked no document is cited by its own Gmail permalink.
 */
function transcriptUrl({ notes, message }: { notes: MeetingNotesEmail; message: ParsedGmailMessage }): string {
  if (notes.documentUrl !== undefined) {
    return notes.documentUrl;
  }
  return gmailPermalink({ id: message.id });
}

/** {@link meetingProjection} over an already-read {@link MeetingNotesEmail}. Pure. */
function meetingOutcome({
  message,
  notes,
  document,
}: {
  message: ParsedGmailMessage;
  notes: MeetingNotesEmail;
  document: DocContent | undefined;
}): MeetingProjectionOutcome {
  if (message.sentAtIso === undefined) {
    return { kind: "undated", messageId: message.id };
  }
  if (document === undefined) {
    return { kind: "unread", messageId: message.id };
  }
  const transcript = transcriptBlock({ document });
  if (transcript === undefined) {
    return { kind: "summary-only", messageId: message.id };
  }
  const body = meetingBody({ transcript: transcript.text });
  const documentText = document.tabs.map((tab) => tab.text).join("\n");
  const roster = mergeAttendees({
    fromDocument: documentAttendees({ text: documentText }),
    fromEmail: notes.attendees,
  });
  const title = transcriptTitle({ document, notes });
  const record: CorpusRecord = {
    attrs: {
      attendeeCount: roster.attendeeCount,
      documentTabs: document.tabs.length,
      // How the transcript was recognised, and on what evidence — so a record whose extraction looks thin
      // is visible as thin in the corpus rather than only in the pass that wrote it.
      transcriptFoundBy: transcript.foundBy,
      transcriptChars: body.text.length,
      transcriptSpeakerLines: transcript.speakerLines,
      ...(roster.attendees.length > 0 ? { attendees: roster.attendees } : {}),
      ...(notes.meetingDateText !== undefined ? { meetingDate: notes.meetingDateText } : {}),
      ...(notes.documentUrl !== undefined ? { documentUrl: notes.documentUrl } : {}),
      ...(body.droppedChars > 0 ? { transcriptCharsDropped: body.droppedChars } : {}),
    },
    container: MEETING_BUCKET,
    kind: "transcript",
    refs: extractRefs({ text: body.text }),
    source: "gmail",
    // Suffixed rather than bare, so the transcript and any future record projected from the same carrier
    // email can never collide on the dedup key.
    sourceId: `${message.id}:meeting`,
    text: body.text,
    tsIso: message.sentAtIso,
    url: transcriptUrl({ message, notes }),
    ...(title !== undefined ? { title } : {}),
  };
  return { kind: "projected", messageId: message.id, record: stampVisibility({ record, visibility: "private" }) };
}

/**
 * Why one meeting produced no record — the three refusals {@link projectMeetingTranscript} can make,
 * counted rather than logged one line at a time.
 */
interface MeetingRefusals {
  /** Meetings whose carrier email carried no send time to date the record by. Mutated, so not readonly. */
  undated: number;
  /** Meetings whose linked document was not read — a moved doc, a revoked scope, a capped pass. */
  unread: number;
  /** Meetings whose document WAS read and carried only Gemini's summary. */
  summaryOnly: number;
}

/**
 * The lines a batch's refusals report, one per KIND rather than one per meeting.
 *
 * Aggregated because a full-history crawl refuses in the dozens, and sixty near-identical lines is a wall
 * that buries the run's other notes — the same reason the no-grant warning is one line and not one per
 * meeting. Each line says what it cost and what would recover it. Pure.
 *
 * @param refusals what the batch refused, by kind
 * @returns one warning per non-zero refusal kind
 */
function refusalWarnings({ refusals }: { refusals: MeetingRefusals }): readonly string[] {
  const lines: string[] = [];
  if (refusals.unread > 0) {
    lines.push(
      `${String(refusals.unread)} meeting(s) were not stored — their notes document could not be read, so ` +
        "there is no raw transcript to keep; the summary is deliberately not stored in its place. Fix the " +
        "document access (see the warnings above) and refresh again",
    );
  }
  if (refusals.summaryOnly > 0) {
    lines.push(
      `${String(refusals.summaryOnly)} meeting(s) were not stored — their notes document carries Gemini's ` +
        "summary and no transcript, which means the call was not transcribed; nothing recovers these but " +
        "turning transcription on for the meeting itself",
    );
  }
  if (refusals.undated > 0) {
    lines.push(`${String(refusals.undated)} meeting(s) were not stored — their carrier email has no send time`);
  }
  return lines;
}

/**
 * Project a batch of parsed messages, reporting which were declined and why.
 *
 * @param messages the parsed messages, in fetch order
 * @param meetingDocs the linked document per recognised notes email, keyed by message id; a message absent
 *   from it is a meeting whose transcript could not be had, and is REFUSED rather than stored as a summary
 * @returns the records, and one warning per message that could not be dated plus one per refusal kind
 */
export function projectGmailMessages({
  messages,
  meetingDocs,
}: {
  messages: readonly ParsedGmailMessage[];
  meetingDocs?: ReadonlyMap<string, DocContent>;
}): {
  records: readonly CorpusRecord[];
  warnings: readonly string[];
} {
  const records: CorpusRecord[] = [];
  const warnings: string[] = [];
  const refusals: MeetingRefusals = { summaryOnly: 0, undated: 0, unread: 0 };
  for (const message of messages) {
    // A recognised meeting-notes email projects as a MEETING and not also as a message. Projecting both
    // would put the same call in the corpus twice under two titles — `Notes: '…'` authored by Gemini, and
    // the meeting itself — and a reader has no way to tell which of the two an answer cited. A meeting
    // with no transcript projects as NEITHER: the email's own text is the summary the ruling excludes.
    if (isMeetingNotesEmail({ message })) {
      const outcome = meetingProjection({ document: meetingDocs?.get(message.id), message });
      if (outcome.kind === "projected") {
        records.push(outcome.record);
      } else {
        countRefusal({ outcome, refusals });
      }
      continue;
    }
    const record = projectGmailMessage({ message });
    if (record === undefined) {
      warnings.push(`message ${message.id}: no readable send time, so it was not projected`);
      continue;
    }
    records.push(record);
  }
  return { records, warnings: [...warnings, ...refusalWarnings({ refusals })] };
}

/**
 * Attribute one refused meeting to the reason {@link meetingProjection} gave.
 *
 * @param outcome the refusal the projection returned
 * @param refusals the batch's tally (mutated)
 */
function countRefusal({
  outcome,
  refusals,
}: {
  outcome: Exclude<MeetingProjectionOutcome, { kind: "projected" }>;
  refusals: MeetingRefusals;
}): void {
  switch (outcome.kind) {
    case "undated":
      refusals.undated += 1;
      return;
    case "unread":
      refusals.unread += 1;
      return;
    case "summary-only":
      refusals.summaryOnly += 1;
      return;
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
