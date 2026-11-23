/**
 * The Gmail thread an ask row was born from, read off the row's own anchor or prose, so its card can chip the mail
 * and draw the thread live — the owner wants to see the actual email an ask about a vendor contact refers to. A Slack-born ask draws the
 * thread it replies in; an email-born one draws this one.
 *
 * No register carries a mail field. The inbox lane writes the ids into the question as `gmail <id>, thread <id>`,
 * and a corpus record's permalink is `https://mail.google.com/mail/u/0/#all/<id>` (`src/corpus/gmail/project.ts`).
 * Either names a thread `gmail read <id> --thread` can read, since that verb resolves a message id to its thread.
 */

/** A Gmail API id: sixteen lower-case hex digits, as every message and thread id the door has printed. */
const GMAIL_ID = "[0-9a-f]{16}";

/** A Gmail web address whose view path ends in a hex id — `#all/<id>`, `#inbox/<id>`, `#label/x/<id>`. */
const MAIL_URL = new RegExp(`https://mail\\.google\\.com/mail/[^\\s#]*#[^\\s]*?/(${GMAIL_ID})(?![0-9a-z])`, "g");

/** The prose shape that names the THREAD: `thread <id>`. */
const THREAD_WORD = new RegExp(`\\bthread (${GMAIL_ID})(?![0-9a-z])`, "g");

/** The prose shape that names one MESSAGE: `gmail <id>`. */
const MESSAGE_WORD = new RegExp(`\\b(?:gmail|message) (${GMAIL_ID})(?![0-9a-z])`, "g");

/** The mail thread a card draws: the id the live read takes, and the address its chip opens. */
export interface MailThreadRef {
  readonly id: string;
  readonly url: string;
}

/**
 * The address that opens a message or thread in Gmail's own web client, in the form the corpus already writes.
 *
 * @param id the message or thread id
 * @returns the address
 */
export function gmailAddressOf({ id }: { id: string }): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

/** The first id a pattern captures across the texts, in order. */
function firstCapture({ pattern, texts }: { pattern: RegExp; texts: readonly string[] }): string | undefined {
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const id = match.at(1);
      if (id !== undefined) {
        return id;
      }
    }
  }
  return undefined;
}

/**
 * The Gmail thread a row names. A thread id is preferred over a message id, because the read of a thread id is one
 * call and names the whole conversation; a Gmail address in the anchor outranks either, being the published one.
 *
 * @param anchor the row's published anchor, when it has one
 * @param texts the row's own words, the question first
 * @returns the thread to draw, or `undefined` when the row names no mail
 */
export function mailThreadOf({
  anchor,
  texts,
}: {
  anchor: string | undefined;
  texts: readonly string[];
}): MailThreadRef | undefined {
  const searches: readonly { pattern: RegExp; texts: readonly string[] }[] = [
    { pattern: MAIL_URL, texts: anchor === undefined ? [] : [anchor] },
    { pattern: THREAD_WORD, texts },
    { pattern: MAIL_URL, texts },
    { pattern: MESSAGE_WORD, texts },
  ];
  for (const search of searches) {
    const id = firstCapture(search);
    if (id !== undefined) {
      return { id, url: gmailAddressOf({ id }) };
    }
  }
  return undefined;
}

/**
 * The Gmail thread an ask's board row names — the message its offered mail replies to, then its anchor, then its
 * question, reason and summary — shared by the ask's own panel and a decision hand step's, so the two cannot drift.
 *
 * The reply target leads because it is the exact message the press answers, recorded as a field rather than read
 * out of prose: a vendor meeting card draws no mail at all once a recut takes the ids out of its words.
 *
 * @param row the board row's anchor and prose
 * @param replyTo the message the row's offered mail replies to, when it offers a reply
 * @returns the thread to draw, or `undefined` when the row names no mail
 */
export function askMailThread({
  row,
  replyTo,
}: {
  row: {
    readonly anchor: string | undefined;
    readonly question: string | undefined;
    readonly reason: string;
    /** A detached ask's read reason, drawn beneath its sentence and once inside it, so scanned with it. */
    readonly reasonWhy?: string;
    readonly summary: string | undefined;
  };
  replyTo: string | undefined;
}): MailThreadRef | undefined {
  if (replyTo !== undefined) {
    return { id: replyTo, url: gmailAddressOf({ id: replyTo }) };
  }
  const texts = [row.question, row.reason, row.reasonWhy, row.summary].filter((text) => text !== undefined);
  return mailThreadOf({ anchor: row.anchor, texts });
}
