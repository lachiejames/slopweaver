/**
 * The reader for `slopweaver gmail read <id> --thread --json` — the mail thread an email-born ask was born from,
 * read live when its card opens (the owner sees the actual email the ask refers to).
 *
 * The ENVELOPE is strict, as every reader here is: the mailbox, the thread id, at least one message and every
 * message's id, labels, body and authored text, or the whole reading is NOT MEASURED rather than a thread drawn
 * empty or with a message missing. The
 * headers a message may lack — a sender, a date, a subject — are read as absent, never invented.
 */

import { type Bag, bags, isBag, num, str, strings } from "../../lib/bag";

/** One message of the thread, as the card draws it. */
export interface MailMessage {
  readonly id: string;
  readonly from: string | undefined;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly sentAtIso: string | undefined;
  readonly subject: string | undefined;
  /** What its sender wrote, above the quoted history the verb cut. */
  readonly authored: string;
  /** The whole body, quoted history included — what "show trimmed content" opens. */
  readonly body: string;
  readonly quotedCharsDropped: number;
  readonly attachmentCount: number;
  /** A message Gmail holds as an unsent draft — the owner's reply, drawn the way Gmail draws one. */
  readonly draft: boolean;
}

/** The thread, as it stood when the card read it. */
export interface MailThread {
  /** The mailbox the grant is bound to — the account the "open in Gmail" address opens. */
  readonly account: string;
  readonly threadId: string;
  readonly readAtIso: string;
  /** Oldest first, as Gmail answers a thread. */
  readonly messages: readonly MailMessage[];
}

/** One message off the document, or `undefined` when its envelope will not read. */
function messageOf({ row }: { row: Bag }): MailMessage | undefined {
  const id = str({ bag: row, key: "id" });
  const labelIds = strings({ bag: row, key: "labelIds" });
  const to = strings({ bag: row, key: "to" });
  const cc = strings({ bag: row, key: "cc" });
  const authored = str({ bag: row, key: "authored" });
  const body = str({ bag: row, key: "body" });
  const quotedCharsDropped = num({ bag: row, key: "quotedCharsDropped" });
  const attachments = bags({ bag: row, key: "attachments" });
  if (
    id === undefined ||
    labelIds === undefined ||
    to === undefined ||
    cc === undefined ||
    authored === undefined ||
    body === undefined ||
    quotedCharsDropped === undefined ||
    attachments === undefined
  ) {
    return undefined;
  }
  return {
    attachmentCount: attachments.length,
    authored,
    body,
    cc,
    draft: labelIds.includes("DRAFT"),
    from: str({ bag: row, key: "from" }),
    id,
    quotedCharsDropped,
    sentAtIso: str({ bag: row, key: "sentAtIso" }),
    subject: str({ bag: row, key: "subject" }),
    to,
  };
}

/**
 * Read a `gmail read --thread --json` document.
 *
 * @param payload the parsed stdout
 * @returns the thread, or `undefined` when the payload is not one this card can draw truthfully
 */
export function readMailThread({ payload }: { payload: unknown }): MailThread | undefined {
  if (!isBag(payload) || payload["source"] !== "gmail") {
    return undefined;
  }
  const readAtIso = str({ bag: payload, key: "readAtIso" });
  const data = payload["data"];
  if (readAtIso === undefined || !isBag(data)) {
    return undefined;
  }
  const account = str({ bag: data, key: "account" });
  const threadId = str({ bag: data, key: "threadId" });
  const rows = bags({ bag: data, key: "messages" });
  // A thread with no message is not a thread Gmail holds: the verb's read answers `[]` for a thread response it
  // could not read, and drawing that would claim "no draft yet" off nothing measured. A message the verb could
  // not read is counted rather than shown, so any count above zero is a partial thread.
  const unread = num({ bag: data, key: "unreadMessages" });
  if (account === undefined || threadId === undefined || rows === undefined || rows.length === 0 || unread !== 0) {
    return undefined;
  }
  const messages: MailMessage[] = [];
  for (const row of rows) {
    const message = messageOf({ row });
    if (message === undefined) {
      return undefined;
    }
    messages.push(message);
  }
  return { account, messages, readAtIso, threadId };
}
