/**
 * Read every Gemini meeting-notes mail one query names — the inbox, or with `--audit` the whole mailbox — in full,
 * for `gmail clear-meeting-notes`.
 *
 * The query is built from the corpus lane's own sender list (`../../corpus/gmail/geminiNotes.ts`), so "a mail this
 * verb clears" and "a mail a refresh projects to a transcript" are one definition. Messages are fetched `full`
 * because the document link lives in the HTML part. Pages are followed until the bound, and a bound reached with
 * a page still left is REPORTED as `complete: false` — a verb proving "every transcript so far" must not read one
 * page as the whole mailbox.
 *
 * Effectful only through the injected {@link GmailApi}.
 */
import { MEETING_NOTES_SENDERS } from "../../corpus/gmail/geminiNotes.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "./api.js";
import type { GmailError } from "./errors.js";
import { type ParsedGmailMessage, parseGmailMessage } from "./parse.js";
import { MAX_LIST_LIMIT } from "./read.js";

/** How many meeting-notes mails one run reads when the caller names no `--limit`. */
export const DEFAULT_CLEAR_MEETING_NOTES_LIMIT = 100;

/**
 * The most one run will read. The whole mailbox held 60 such mails when measured (`MEETING_NOTES_SENDERS`'s
 * measurement), so an `--audit` at this bound reads every one with room to grow, and a mailbox past it is reported
 * as incomplete rather than read without end.
 */
export const MAX_CLEAR_MEETING_NOTES_LIMIT = 500;

/** Which mail a run reads. */
export type MeetingNotesScope = "inbox" | "anywhere";

/** What one read produced. */
export interface MeetingNotesMail {
  /** Every parsed meeting-notes mail, in the order Gmail listed them. */
  readonly messages: readonly ParsedGmailMessage[];
  /** False when the bound was reached with mail still matching — the read is one slice, not the whole set. */
  readonly complete: boolean;
  /**
   * The LISTED id of each message Gmail answered with no id or thread id, or under a different id, so it could not
   * be judged at all — kept by id so the run names each one rather than counting it.
   */
  readonly unparsed: readonly string[];
  /** The Gmail query the read ran. */
  readonly query: string;
}

/**
 * The Gmail query for meeting-notes mail in one scope. Pure.
 *
 * @param scope `inbox` for what is waiting, `anywhere` for the whole mailbox's history
 * @returns the search expression
 */
export function meetingNotesQuery({ scope }: { scope: MeetingNotesScope }): string {
  const senders = MEETING_NOTES_SENDERS.map((address) => `from:${address}`).join(" ");
  return `in:${scope} {${senders}}`;
}

/**
 * Append each listed id not already read. An id listed twice is read once, because every judgement downstream is
 * keyed by message id and a second copy would share the first one's proof.
 */
function appendUnseen({ ids, listed }: { ids: string[]; listed: readonly string[] }): void {
  for (const id of listed) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
}

/**
 * Read up to `limit` meeting-notes mails in one scope, each in full.
 *
 * @param api the injected Gmail seam
 * @param scope which mail to read
 * @param limit the most messages to read, already validated against {@link MAX_CLEAR_MEETING_NOTES_LIMIT}
 * @returns the parsed mails and whether the read covered every match, or the Gmail failure that stopped it
 */
export async function readMeetingNotesMail({
  api,
  scope,
  limit,
}: {
  api: GmailApi;
  scope: MeetingNotesScope;
  limit: number;
}): Promise<Result<MeetingNotesMail, GmailError>> {
  const query = meetingNotesQuery({ scope });
  const ids: string[] = [];
  let pageToken: string | undefined;
  let complete = true;
  do {
    const page = await api.listMessageIds({
      labelIds: [],
      limit: Math.min(MAX_LIST_LIMIT, limit - ids.length),
      pageToken,
      query,
    });
    if (page.isErr()) {
      return err(page.error);
    }
    appendUnseen({ ids, listed: page.value.ids });
    pageToken = page.value.nextPageToken;
    if (pageToken !== undefined && ids.length >= limit) {
      complete = false;
      break;
    }
  } while (pageToken !== undefined);
  const messages: ParsedGmailMessage[] = [];
  const unparsed: string[] = [];
  for (const id of ids) {
    const message = await api.getMessage({ format: "full", id });
    if (message.isErr()) {
      return err(message.error);
    }
    const parsed = parseGmailMessage({ message: message.value });
    // A message answered under another id than the one asked for is not judged: every judgement downstream is
    // keyed by that id, so it would borrow another mail's proof.
    if (parsed === undefined || parsed.id !== id) {
      unparsed.push(id);
    } else {
      messages.push(parsed);
    }
  }
  return ok({ complete, messages, query, unparsed });
}
