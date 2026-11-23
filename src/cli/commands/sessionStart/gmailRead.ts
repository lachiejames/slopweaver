/**
 * The Gmail leg's effectful read: two live listings, paired on Gmail's own thread id.
 *
 * ## Two calls, and the second window is deliberately wider than the first
 *
 * One listing is the owner's inbox over the run's window. The other is what the owner SENT, over a window several times
 * longer, and the asymmetry is the fix for a defect this leg had while it was being written. Matching both
 * over fourteen days lost a real thread the owner had written into three weeks earlier — the reply is recent, the owner's
 * side of the conversation is not, and a symmetric window can only ever see conversations that started
 * inside it.
 *
 * ## Metadata only, and no body is ever read
 *
 * `gmail list` returns sender, subject, snippet and labels. That is everything the ranking reads, so this
 * leg never calls `gmail read` and never pulls a message body into the process. What a row quotes is
 * Gmail's own snippet.
 *
 * ## One page, and it says so when there was more
 *
 * The door's listing is a single page capped at 100, by design rather than by omission. When Gmail's own
 * estimate exceeds what came back, that is carried to the reader as a stated limit instead of a silently
 * short list — the `audit run` defect class, where a partial answer printed as a whole one.
 */

import { err, type Result } from "../../../lib/result.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import type { GmailListingEntry } from "../../../live/gmail/read.js";
import { readGmailListing } from "../../../live/gmail/read.js";
import type { MailMessage } from "../../../sessionStart/gmailLeg.js";
import { gmailLeg, outstandingThreads } from "../../../sessionStart/gmailLeg.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import { resolveHome } from "../../optionParsers.js";

/** How far back the inbox is read. Matches the Slack leg's window so the two legs agree about "recent". */
export const INBOX_WINDOW_DAYS = 14;

/**
 * How far back the owner's own sent mail is read.
 *
 * Wider than the inbox window on purpose. A reply landing today can belong to a thread the owner last wrote in
 * months ago, and pairing both over the same window would drop exactly those — the oldest, and most
 * overdue, conversations in the set.
 */
export const SENT_WINDOW_DAYS = 180;

/** The most messages one listing page may carry, which is the door's own ceiling. */
const PAGE_LIMIT = 100;

/**
 * The one seam this read performs its effects through, so the pairing is testable with a plain fake.
 *
 * @internal the contract between this read and the verb's own shell.
 */
export interface GmailListSeam {
  readonly list: (args: {
    home: string | undefined;
    query: string;
    limit: number;
  }) => Promise<Result<{ entries: readonly GmailListingEntry[]; resultSizeEstimate: number | undefined }, GmailError>>;
}

/**
 * What one Gmail read produced, including why it produced nothing when it did.
 *
 * @internal the contract between this read and the verb's own shell.
 */
export interface GmailRead {
  /** The threads that survived, already mapped to ranker input. */
  readonly inputs: readonly RankInput[];
  /** How many inbox messages were read, so the verb can say what fraction became rows. */
  readonly inboxRead: number;
  /** How many threads were answered after the owner's last word, before any item was built. */
  readonly answeredAfterOwner: number;
  /** What this leg could not see, in the words the verb prints. */
  readonly couldNotSee: readonly string[];
  /** The typed reason the leg produced nothing, present ONLY when a listing actually failed. */
  readonly refusal?: GmailError;
}

/**
 * Reduce a listing entry to the fields the pure leg reads.
 *
 * @param entry one row of a `gmail list` page
 * @returns the message
 */
export function toMailMessage({ entry }: { entry: GmailListingEntry }): MailMessage {
  return {
    from: entry.from,
    labelIds: entry.labelIds,
    sentAtIso: entry.sentAtIso,
    snippet: entry.snippet,
    subject: entry.subject,
    threadId: entry.threadId,
  };
}

/**
 * The Gmail search expression for one window of one mailbox side.
 *
 * Built here rather than inlined so both queries are visible in one place and a test can pin them. Gmail's
 * `newer_than` takes a bare day count with a `d` suffix.
 *
 * @param scope which side of the mailbox to read
 * @param days how far back to look
 * @returns the query, exactly as the Gmail search box takes it
 */
export function mailQuery({ scope, days }: { scope: "inbox" | "sent"; days: number }): string {
  return `in:${scope} newer_than:${String(days)}d`;
}

/**
 * The limit line a page owes its reader when Gmail says more matched than came back.
 *
 * @param label which listing this describes, in the words a reader sees
 * @param read how many rows came back
 * @param estimate Gmail's own estimate of how many matched
 * @returns the line, or undefined when the page was complete
 */
export function truncationLimit({
  label,
  read,
  estimate,
}: {
  label: string;
  read: number;
  estimate: number | undefined;
}): string | undefined {
  if (estimate === undefined || estimate <= read) {
    return undefined;
  }
  return `your ${label} was read one page deep, ${String(read)} of about ${String(estimate)} that Gmail says match, so this leg saw part of it rather than all`;
}

/**
 * An empty leg carrying the typed reason a listing failed.
 *
 * @param reason the sentence the verb prints under `could not see:`
 * @param refusal the typed error the listing returned
 * @returns the empty read
 */
function refusedRead({ reason, refusal }: { reason: string; refusal: GmailError }): GmailRead {
  return { answeredAfterOwner: 0, couldNotSee: [reason], inboxRead: 0, inputs: [], refusal };
}

/**
 * The limits a completed read owes its reader, whether or not it produced a single row.
 *
 * The copied-in line is unconditional on purpose. It is the leg's largest deliberate blind spot, and a
 * blind spot only stated when it happens to bite is one the reader learns about too late.
 *
 * @param inbox what the inbox listing returned
 * @param sent what the sent listing returned
 * @returns every limit line, in the order the verb prints them
 */
function readLimits({
  inbox,
  sent,
}: {
  inbox: { entries: readonly GmailListingEntry[]; resultSizeEstimate: number | undefined };
  sent: { entries: readonly GmailListingEntry[]; resultSizeEstimate: number | undefined };
}): readonly string[] {
  const lines = [
    truncationLimit({ estimate: inbox.resultSizeEstimate, label: "inbox", read: inbox.entries.length }),
    truncationLimit({ estimate: sent.resultSizeEstimate, label: "sent mail", read: sent.entries.length }),
    `your mail rows cover threads you wrote in within ${String(SENT_WINDOW_DAYS)} days — a thread you were only copied on is not read here, because nothing in it is yours to answer`,
  ];
  return lines.filter((line): line is string => line !== undefined);
}

/**
 * Read both sides of the mailbox live and turn the threads answered after the owner into ranker input.
 *
 * @param home the state home holding the mailbox grant
 * @param nowIso the run's own instant, supplied rather than read
 * @param seam the listing seam, injected so the pairing is testable without a mailbox
 * @returns the leg's input, or an empty leg carrying the typed reason it could not run
 */
export async function readGmailThreads({
  home,
  nowIso,
  seam,
}: {
  home: string | undefined;
  nowIso: string;
  seam: GmailListSeam;
}): Promise<GmailRead> {
  const inbox = await seam.list({
    home,
    limit: PAGE_LIMIT,
    query: mailQuery({ days: INBOX_WINDOW_DAYS, scope: "inbox" }),
  });
  if (inbox.isErr()) {
    return refusedRead({
      reason: `your mail is not here, the inbox could not be read: ${inbox.error.message}`,
      refusal: inbox.error,
    });
  }
  const sent = await seam.list({
    home,
    limit: PAGE_LIMIT,
    query: mailQuery({ days: SENT_WINDOW_DAYS, scope: "sent" }),
  });
  if (sent.isErr()) {
    return refusedRead({
      reason: `your mail is not here, your own sent mail could not be read: ${sent.error.message}`,
      refusal: sent.error,
    });
  }
  const threads = outstandingThreads({
    inbound: inbox.value.entries.map((entry) => toMailMessage({ entry })),
    sent: sent.value.entries.map((entry) => toMailMessage({ entry })),
  });
  return {
    answeredAfterOwner: threads.length,
    couldNotSee: readLimits({ inbox: inbox.value, sent: sent.value }),
    inboxRead: inbox.value.entries.length,
    inputs: gmailLeg({ nowIso, threads }),
  };
}

/**
 * The seam bound to the real mailbox.
 *
 * Kept apart from {@link readGmailThreads} so the pairing logic above needs no grant, no token and no
 * network to test. A home with no mailbox connected resolves no client, and the typed refusal that
 * produces travels back as this leg's stated reason rather than taking the whole list down.
 *
 * @returns the production listing seam
 */
export function productionGmailListSeam(): GmailListSeam {
  return {
    list: async ({ home, query, limit }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      const listing = await readGmailListing({
        account: bound.value.account,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        labelIds: [],
        limit,
        nowIso: () => new Date().toISOString(),
        query,
      });
      return listing.map((one) => ({
        entries: one.listing.entries,
        resultSizeEstimate: one.listing.resultSizeEstimate,
      }));
    },
  };
}
