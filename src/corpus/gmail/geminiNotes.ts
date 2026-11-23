/**
 * Recognising a Gemini / Google Meet meeting-notes email, and reading the meeting out of it.
 *
 * ## Why a meeting is not an email
 *
 * Google Meet mails the owner after a call: a fixed sender, a subject naming the meeting and its date, an
 * inline summary, and a LINK to the Google Doc holding the full notes and the transcript. Ingested as an
 * ordinary message that is a record whose author is "Gemini", whose title is `Notes: '…'` and whose text is
 * a summary — so "what did we decide in the working group" retrieves a notification rather than a
 * meeting, and the transcript, which is the part worth having, is not in the corpus at all.
 *
 * So a recognised notes email projects to its own kind (`transcript`) with the meeting's own title, the
 * meeting's own date, its attendees, and the document's text as the record body. The email is then no
 * longer projected as a message: it is the CARRIER, and keeping both would put the same meeting in the
 * corpus twice under two titles, which is worse than either alone.
 *
 * ## Recognition is by SENDER, and the subject only shapes what is read
 *
 * Both recognised senders are addresses only Google can send from, so a subject-only match would be
 * spoofable by anyone who can mail the owner — and this lane follows a link with the owner's credential,
 * which is precisely the operation not to perform on attacker-chosen input. The subject then supplies the
 * meeting's title and date, and a subject that does not parse costs those two fields rather than the
 * record: the document link is still the document link.
 *
 * ## Attendees are gathered, never inferred
 *
 * Three sources, in order of trust: the document's own attendee line, the bracketed owners Gemini writes
 * against each suggested next step (`[Ada Owner] Develop …`), and nothing else. The `To:` header is
 * deliberately NOT used — a notes email is addressed to the mailbox that received it and the other guests
 * are not on it, so reading attendance from it would report every meeting as having exactly one attendee.
 * A name this cannot find is absent rather than guessed; `identity-exact-match-only` applies to a meeting
 * roster exactly as it applies to a mention.
 *
 * Pure: no I/O, no clock.
 */
import type { ParsedGmailMessage } from "../../live/gmail/parse.js";

/**
 * The senders whose mail is a meeting artefact.
 *
 * Measured on the owner's mailbox: 59 messages from `gemini-notes@google.com` (subject
 * `Notes: '<title>' <date>`) and 1 from `meetings-noreply@google.com` (subject
 * `Meeting records: '<title>' <date>`). Reproduce with
 * `slopweaver gmail list --query "from:gemini-notes@google.com" --limit 100`.
 *
 * @internal — the data behind {@link isMeetingNotesEmail}; every caller asks that question, not this list.
 */
export const MEETING_NOTES_SENDERS: readonly string[] = ["gemini-notes@google.com", "meetings-noreply@google.com"];

/** The subject prefixes those senders use, each followed by the quoted meeting title and its date. */
const SUBJECT_PREFIXES: readonly string[] = ["Notes:", "Meeting records:"];

/**
 * How many attendees are stored on one record.
 *
 * The same reasoning as the mail projection's own recipient bound: a roster this long is a company-wide
 * call where the SIZE is the signal and the roll is noise. `attendeeCount` carries the size
 * unconditionally, so a truncated list never reads as a complete one.
 */
export const MAX_STORED_ATTENDEES = 40;

/** What a recognised notes email says about its meeting, before the document is read. */
export interface MeetingNotesEmail {
  /** The message the meeting was recognised from. */
  readonly messageId: string;
  /** The meeting's own title, from the subject's quoted half — never the subject itself. */
  readonly meetingTitle: string | undefined;
  /** The date the subject names, as written (`D Mon YYYY`); the record's instant comes from the message. */
  readonly meetingDateText: string | undefined;
  /** The Google Doc holding the notes and transcript, when the email linked one. */
  readonly documentUrl: string | undefined;
  /** The inline summary — the email body, which is real content even when the document cannot be read. */
  readonly summary: string;
  /** Attendees named by the bracketed owners of the suggested next steps. */
  readonly attendees: readonly string[];
}

/**
 * The bare address inside a `From:` header, lower-cased.
 *
 * Split by index rather than by pattern for the reason {@link ../../corpus/gmail/project} gives at length:
 * the obvious regex backtracks polynomially and this repo's `redos-check` gate refuses it, correctly, for
 * text that arrives from anyone who can send mail. RFC 5322 comments — `(Google Meet)`, before or after the
 * address, bare or angled — are dropped first, then the LAST COMPLETE angle address is taken wherever it sits (a
 * stray `<` or `>` around it changes nothing), with its whitespace and quote marks dropped. Pure.
 *
 * @param header the raw `From:` value, or undefined when the message carried none
 * @returns the address, lower-cased, or undefined when there is no header
 */
export function senderAddress({ header }: { header: string | undefined }): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const trimmed = withoutComments({ header }).trim();
  const address = withoutSpaceOrQuotes({ text: lastAngleAddress({ text: trimmed }) }).toLowerCase();
  return address.length === 0 ? undefined : address;
}

/** The text inside the last complete `<…>` pair holding no other `<`, or the whole text when there is none. */
function lastAngleAddress({ text }: { text: string }): string {
  let open = -1;
  let found: string | undefined;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === "<") {
      open = at;
    } else if (text[at] === ">" && open !== -1) {
      found = text.slice(open + 1, at);
      open = -1;
    }
  }
  if (found === undefined) {
    return text;
  }
  return found;
}

/**
 * An address with its folding whitespace and quote marks dropped: neither can be part of the address itself, so
 * `gemini-notes (x) @google.com` and `"gemini-notes"@google.com` both read as `gemini-notes@google.com`.
 */
function withoutSpaceOrQuotes({ text }: { text: string }): string {
  let kept = "";
  for (const char of text) {
    if (char !== '"' && char.trim().length > 0) {
      kept += char;
    }
  }
  return kept;
}

/**
 * A header with every parenthesised comment removed, in one linear scan: a `(` inside a quoted display name is
 * text, a backslash escapes the next character, and comments nest. An unclosed comment drops the rest.
 */
function withoutComments({ header }: { header: string }): string {
  let kept = "";
  let scan: CommentScan = { depth: 0, quoted: false };
  for (const token of headerTokens({ header })) {
    const step = commentStep({ scan, token });
    if (step.keep) {
      kept += token;
    }
    scan = step.scan;
  }
  return kept;
}

/** Where a comment scan stands: how deep in nested comments, and whether inside a quoted display name. */
interface CommentScan {
  readonly depth: number;
  readonly quoted: boolean;
}

/** A header's characters, a backslash and the character it escapes kept together as one token. */
function headerTokens({ header }: { header: string }): readonly string[] {
  const tokens: string[] = [];
  for (let at = 0; at < header.length; at += 1) {
    if (header[at] === "\\") {
      tokens.push(header.slice(at, at + 2));
      at += 1;
    } else {
      tokens.push(header[at]!);
    }
  }
  return tokens;
}

/**
 * One token's effect on the scan, and whether it survives. A quote toggles only outside a comment, so while quoted
 * the scan is never inside one and a `(` is text.
 */
function commentStep({ scan, token }: { scan: CommentScan; token: string }): { scan: CommentScan; keep: boolean } {
  const { depth, quoted } = scan;
  if (token.length > 1) {
    return { keep: depth === 0, scan };
  }
  if (depth === 0 && token === '"') {
    return { keep: true, scan: { depth, quoted: !quoted } };
  }
  if (quoted) {
    return { keep: true, scan };
  }
  if (token === "(") {
    return { keep: false, scan: { depth: depth + 1, quoted } };
  }
  if (token === ")" && depth > 0) {
    return { keep: false, scan: { depth: depth - 1, quoted } };
  }
  return { keep: depth === 0, scan };
}

/**
 * Whether a message is a meeting-notes email from one of the two recognised senders.
 *
 * @param message the parsed message
 * @returns true when this message is a meeting artefact rather than correspondence
 */
export function isMeetingNotesEmail({ message }: { message: ParsedGmailMessage }): boolean {
  const address = senderAddress({ header: message.from });
  return address !== undefined && isMeetingNotesSender({ address });
}

/**
 * Whether a bare, lower-cased sender address is one of the recognised meeting senders — the same question
 * {@link isMeetingNotesEmail} asks, for a caller holding only the address (`gmail triage`, which holds this mail
 * out of every group because `gmail clear-meeting-notes` owns it).
 *
 * @param address the sender address, lower-cased
 * @returns true when mail from it is a meeting artefact
 */
export function isMeetingNotesSender({ address }: { address: string }): boolean {
  return MEETING_NOTES_SENDERS.includes(address);
}

/**
 * Split `Notes: 'Some Meeting' D Mon YYYY` into its title and its date text.
 *
 * Both halves are optional results rather than defaults: a subject Google changes the shape of should cost
 * the two fields it names and nothing else, and a title invented from the whole subject would put
 * `Notes: '…'` in front of every meeting in the corpus. Pure.
 *
 * @param subject the raw `Subject:` value, when the message carried one
 * @returns the meeting title and the date as written, each absent when the subject did not carry it
 */
export function parseMeetingSubject({ subject }: { subject: string | undefined }): {
  meetingTitle: string | undefined;
  meetingDateText: string | undefined;
} {
  if (subject === undefined) {
    return { meetingDateText: undefined, meetingTitle: undefined };
  }
  const prefix = SUBJECT_PREFIXES.find((candidate) => subject.startsWith(candidate));
  if (prefix === undefined) {
    return { meetingDateText: undefined, meetingTitle: undefined };
  }
  const rest = subject.slice(prefix.length).trim();
  const open = rest.indexOf("'");
  const close = rest.lastIndexOf("'");
  if (open === -1 || close <= open) {
    return { meetingDateText: undefined, meetingTitle: undefined };
  }
  const title = rest.slice(open + 1, close).trim();
  const date = rest.slice(close + 1).trim();
  return {
    meetingDateText: date.length === 0 ? undefined : date,
    meetingTitle: title.length === 0 ? undefined : title,
  };
}

/**
 * The placeholder Gemini writes when a next step belongs to everyone rather than to a person. It is not an
 * attendee, and storing it as one would put a person called "The group" in the people directory.
 */
const GROUP_OWNER = "the group";

/**
 * The people Gemini named as owning a suggested next step — `[Ada Owner] Develop …`.
 *
 * **One bracket may name more than one person**, and each is separately an attendee. Gemini writes
 * `[Ana Diaz, Bo Chen] Provide feedback…` when a step belongs to two of them, and keeping the bracket
 * whole minted a person who does not exist. MEASURED on the owner's bronze corpus: nine
 * composite names across the whole mailbox, one of which stood in one meeting's roster beside both
 * of the real people it had joined, taking that meeting's `attendeeCount` to 5 where four people
 * attended. Re-derive the class with
 * `grep -ho '"attendees":\[[^]]*\]' "$SLOPWEAVER_HOME"/corpus/bronze/gmail/*.jsonl | grep -o '"[^"]*, [^"]*"' | sort -u`.
 *
 * Splitting on the comma is the same idiom {@link documentAttendees} already applies to the document's own
 * attendee line, and it costs a display name that genuinely contains one — a surname-first `Smith, John`
 * becomes two names. That trade is deliberate rather than overlooked: Gemini writes first-then-last
 * display names, so the composite is the shape the corpus actually holds and the surname-first one is not.
 * The group placeholder is tested per NAME, so it drops out of a mixed bracket too.
 *
 * Bounded by a character class with no nesting, so it cannot backtrack over a long body. Names are
 * deduplicated preserving first-seen order. Pure.
 *
 * @param body the email body, as the plain-text part gave it
 * @returns the named owners, in first-seen order
 */
export function bracketedOwners({ body }: { body: string }): readonly string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(/^\[([^\]\n]{1,80})\]/gmu)) {
    const bracket = match[1];
    if (bracket === undefined) {
      continue;
    }
    for (const part of bracket.split(",")) {
      const name = part.trim();
      if (name.length > 0 && name.toLowerCase() !== GROUP_OWNER) {
        seen.add(name);
      }
    }
  }
  return [...seen];
}

/**
 * The first Google Docs link in a message's HTML part.
 *
 * FIRST rather than "the one that looks right": a Gemini notes email carries exactly one document link
 * (measured on a real message — its HTML part held one `href` in total), and a heuristic that ranked
 * several would be choosing between candidates that do not exist. Pure.
 *
 * @param links the message's HTML link targets
 * @returns the document URL, or undefined when the message linked none
 */
export function documentLink({ links }: { links: readonly string[] }): string | undefined {
  return links.find((link) => link.startsWith("https://docs.google.com/document/d/"));
}

/**
 * Read a recognised notes email into the meeting it describes.
 *
 * @param message the parsed message, already recognised by {@link isMeetingNotesEmail}
 * @returns what the email says about the meeting
 */
export function readMeetingNotesEmail({ message }: { message: ParsedGmailMessage }): MeetingNotesEmail {
  const subject = parseMeetingSubject({ subject: message.subject });
  return {
    attendees: bracketedOwners({ body: message.body }),
    documentUrl: documentLink({ links: message.htmlLinks }),
    meetingDateText: subject.meetingDateText,
    meetingTitle: subject.meetingTitle,
    messageId: message.id,
    summary: message.body,
  };
}

/**
 * The attendee line a Meet notes document writes, when it wrote one.
 *
 * Meet puts the roster on a line of the form `Attendees: A, B, C` (or `Participants:`). A document that
 * does not carry one contributes no attendees rather than a guess. Pure.
 *
 * @param text the document's text, tabs already joined
 * @returns the names, in document order
 */
export function documentAttendees({ text }: { text: string }): readonly string[] {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const label = ["Attendees:", "Participants:"].find((candidate) => trimmed.startsWith(candidate));
    if (label === undefined) {
      continue;
    }
    return trimmed
      .slice(label.length)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  }
  return [];
}

/**
 * Merge the attendee lists, document first, deduplicated case-insensitively and bounded.
 *
 * @param fromDocument the names the document's own attendee line gave
 * @param fromEmail the names the email's bracketed next-step owners gave
 * @returns the merged roster, and the count before the bound was applied
 */
export function mergeAttendees({
  fromDocument,
  fromEmail,
}: {
  fromDocument: readonly string[];
  fromEmail: readonly string[];
}): { attendees: readonly string[]; attendeeCount: number } {
  const seen = new Map<string, string>();
  for (const name of [...fromDocument, ...fromEmail]) {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, name);
    }
  }
  const all = [...seen.values()];
  return { attendeeCount: all.length, attendees: all.slice(0, MAX_STORED_ATTENDEES) };
}
