/**
 * The inbox walk behind `gmail triage`: every INBOX id, page by page up to a cap, then one `metadata` fetch per
 * message, folded by `./triage.ts`. Effectful only through the injected {@link GmailApi} and clock, so it is unit
 * tested against plain fakes.
 *
 * One `messages.get` per message is the cost, and it is the same cost `gmail list` pays per line: measured on the
 * owner's inbox, a whole reading was 60 messages in 26 sender groups, so one listing call and sixty
 * fetches. Reproduce it with `slopweaver gmail triage`, whose second line prints both counts.
 *
 * A `last-reply` rule (`./triageReplied.ts`), when the install switched it on, adds a SENT listing to the same cap —
 * ids and thread ids only, no fetch — and one `metadata` thread read per inbox thread that listing also names. A
 * thread whose owner reply sits past that cap is simply not seen as the owner's, so it is carded: the cap can only make
 * the rule archive less.
 *
 * A `passed-invite` rule (`./triagePassedInvite.ts`), when switched on, adds one more INBOX listing to the same cap,
 * narrowed by Gmail's own `filename:invite.ics` search — ids only, no fetch. An invite past that cap is not judged, so
 * it is carded. A rule left off costs neither call.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "./api.js";
import type { GmailError } from "./errors.js";
import type { GmailMessage } from "./parse.js";
import { buildGmailTriage, type GmailTriageDocument } from "./triage.js";
import { lastMessageIsOwners } from "./triageReplied.js";
import { type GmailTriagePolicy, structuralRuleOf } from "./triageRules.js";

/** How many ids one listing page asks for — Gmail's own maximum. */
const TRIAGE_PAGE_SIZE = 100;

/** The messages one reading fetches when the caller names no other cap — far above the owner's measured inbox. */
export const DEFAULT_TRIAGE_LIMIT = 500;

/** The most one reading will fetch. Past this an inbox is a backlog to clear by rule, not a page to card. */
export const MAX_TRIAGE_LIMIT = 2000;

/** The search naming inbox mail that carries Google Calendar's invite file — what makes a mail an invite. */
const INVITE_FILE_QUERY = "filename:invite.ics";

/** What one label walk found: ids and their thread ids positionally, and whether it reached the end. */
interface LabelWalk {
  readonly ids: readonly string[];
  readonly threadIds: readonly string[];
  readonly complete: boolean;
  readonly estimate: number | undefined;
}

/** Walk one label's ids, narrowed by a search when one is named, up to `limit`, saying whether it reached the end. */
async function walkLabelIds({
  api,
  label,
  limit,
  query,
}: {
  api: GmailApi;
  label: "INBOX" | "SENT";
  limit: number;
  query: string | undefined;
}): Promise<Result<LabelWalk, GmailError>> {
  const ids: string[] = [];
  const threadIds: string[] = [];
  let pageToken: string | undefined = undefined;
  let estimate: number | undefined = undefined;
  let pages = 0;
  while (ids.length < limit) {
    const listed = await api.listMessageIds({
      labelIds: [label],
      limit: Math.min(TRIAGE_PAGE_SIZE, limit - ids.length),
      pageToken,
      query,
    });
    if (listed.isErr()) {
      return err(listed.error);
    }
    // Gmail's estimate is for the whole query, so the first page's answer is the one kept.
    if (pages === 0) {
      estimate = listed.value.resultSizeEstimate;
    }
    pages += 1;
    ids.push(...listed.value.ids);
    threadIds.push(...listed.value.threadIds);
    pageToken = listed.value.nextPageToken;
    if (pageToken === undefined) {
      return ok({ complete: true, estimate, ids, threadIds });
    }
  }
  return ok({ complete: false, estimate, ids, threadIds });
}

/**
 * The inbox threads whose newest message is the owner's own reply: list the owner's SENT mail to the same cap, then read only the
 * inbox threads that listing also names. A thread read that fails fails the reading, as a message fetch does.
 */
async function repliedThreadsOf({
  api,
  inboxThreadIds,
  limit,
}: {
  api: GmailApi;
  inboxThreadIds: ReadonlySet<string>;
  limit: number;
}): Promise<Result<ReadonlySet<string>, GmailError>> {
  const sent = await walkLabelIds({ api, label: "SENT", limit, query: undefined });
  if (sent.isErr()) {
    return err(sent.error);
  }
  const candidates = [...new Set(sent.value.threadIds)].filter((threadId) => inboxThreadIds.has(threadId));
  const replied = new Set<string>();
  for (const threadId of candidates) {
    const thread = await api.getThread({ format: "metadata", id: threadId });
    if (thread.isErr()) {
      return err(thread.error);
    }
    if (lastMessageIsOwners({ thread: thread.value })) {
      replied.add(threadId);
    }
  }
  return ok(replied);
}

/**
 * Read the owner's inbox and group it by sender.
 *
 * A message that fails to fetch fails the reading rather than being skipped: a worklist silently missing a sender
 * would card an inbox as clearer than it is, and the transient class is already retried beneath this call.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param limit the most messages to fetch
 * @param nowIso the read timestamp source
 * @param policy this install's declared policy, read from its store before the walk; a lane it leaves off costs
 *   no extra Gmail call
 * @returns the triage document, or the typed reason the walk stopped
 */
export async function readGmailTriage({
  api,
  account,
  limit,
  nowIso,
  policy,
}: {
  api: GmailApi;
  account: string;
  limit: number;
  nowIso: () => string;
  policy: GmailTriagePolicy;
}): Promise<Result<GmailTriageDocument, GmailError>> {
  const walked = await walkLabelIds({ api, label: "INBOX", limit, query: undefined });
  if (walked.isErr()) {
    return err(walked.error);
  }
  const messages: GmailMessage[] = [];
  for (const id of walked.value.ids) {
    const fetched = await api.getMessage({ format: "metadata", id });
    if (fetched.isErr()) {
      return err(fetched.error);
    }
    messages.push(fetched.value);
  }
  const replied = await repliedThreadsUnder({ api, limit, policy, threadIds: walked.value.threadIds });
  if (replied.isErr()) {
    return err(replied.error);
  }
  const invites = await inviteFileIdsUnder({ api, limit, policy });
  if (invites.isErr()) {
    return err(invites.error);
  }
  return ok(
    buildGmailTriage({
      account,
      complete: walked.value.complete,
      inboxEstimate: walked.value.estimate,
      inviteFileIds: invites.value,
      messages,
      policy,
      readAtIso: nowIso(),
      repliedThreadIds: replied.value,
    }),
  );
}

/** The replied threads, walked only when the install switched `last-reply` on; else none, at no Gmail cost. */
async function repliedThreadsUnder({
  api,
  limit,
  policy,
  threadIds,
}: {
  api: GmailApi;
  limit: number;
  policy: GmailTriagePolicy;
  threadIds: readonly string[];
}): Promise<Result<ReadonlySet<string>, GmailError>> {
  if (structuralRuleOf({ kind: "last-reply", policy }) === undefined) {
    return ok(new Set());
  }
  return repliedThreadsOf({ api, inboxThreadIds: new Set(threadIds), limit });
}

/** The invite-file ids, searched only when the install switched `passed-invite` on; else none, at no Gmail cost. */
async function inviteFileIdsUnder({
  api,
  limit,
  policy,
}: {
  api: GmailApi;
  limit: number;
  policy: GmailTriagePolicy;
}): Promise<Result<ReadonlySet<string>, GmailError>> {
  if (structuralRuleOf({ kind: "passed-invite", policy }) === undefined) {
    return ok(new Set());
  }
  const invites = await walkLabelIds({ api, label: "INBOX", limit, query: INVITE_FILE_QUERY });
  if (invites.isErr()) {
    return err(invites.error);
  }
  return ok(new Set(invites.value.ids));
}
