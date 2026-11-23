/**
 * Whether the owner has posted in a Slack thread since one message — the check `slopweaver slack replied` runs,
 * and the one `handover currency` runs in-process for an ask whose done-check is that verb.
 *
 * A row is done when a command that had to return success says so: a Slack message from the owner after this
 * timestamp in that thread, in that channel. So this answers three ways, never two: the owner REPLIED (with the
 * reply's own link as the evidence), has NOT YET, or the read COULD NOT CHECK — and an unreadable thread is never
 * reported as "not yet", because a check that could not run reads could-not-check, never still-a-problem.
 *
 * "After" is Slack `ts` against Slack `ts`, the message the link names against every later one. An ISO instant floors
 * to the second (`slackTsToIso`), so a check bounded by one would count the anchor message itself as the owner's
 * reply the moment the row was written whenever the anchor is the owner's own message.
 *
 * A one-to-one DM is read as a conversation too: there the owner answers at the top level rather than in a thread, which
 * `slack tagged`'s `answeredSince` (`./taggedDocument.ts`) already treats as an answer.
 */
import type { SlackApi } from "../../corpus/slack/fetch.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsFromEpochMs, slackTsToIso } from "../../lib/slackTs.js";
import { fetchCompleteSlackHistory, fetchCompleteSlackThread } from "./pagination.js";
import { parseSlackThreadPermalink, type SlackThreadTarget, slackAskPermalink } from "./permalink.js";
import { projectSlackThread } from "./projection.js";
import { compareSlackTimestamps } from "./selection.js";
import { redirectedTarget } from "./threadRedirect.js";
import type { VisibleSlackMessage } from "./types.js";

/** The most pages a DM's top-level read since the anchor walks; a reply there is days, not thousands of messages. */
const DM_MAX_PAGES = 5;

/** What one check of a thread found. */
export type OwnerReply =
  | {
      readonly kind: "replied";
      /** The reply's own Slack `ts`. */
      readonly ts: string;
      readonly atIso: string;
      /** A link to the reply itself — the evidence a card prints. */
      readonly permalink: string;
    }
  | { readonly kind: "not-yet"; readonly readAtIso: string }
  | { readonly kind: "could-not-check"; readonly why: string };

/** One message as this check needs it: its own `ts` and who wrote it. */
export interface AuthoredTs {
  readonly ts: string;
  readonly userId: string | undefined;
}

/**
 * The earliest message of the owner's strictly after the anchor, or `undefined` when the owner has posted none.
 *
 * @param messages every message the read returned, in any order
 * @param ownerUserId the owner's Slack user id
 * @param afterTs the anchor message's own `ts`; a message AT it is the anchor, never a reply
 * @returns the reply's `ts`, or `undefined`
 */
export function firstOwnerReplyTs({
  messages,
  ownerUserId,
  afterTs,
}: {
  messages: readonly AuthoredTs[];
  ownerUserId: string;
  afterTs: string;
}): string | undefined {
  const ownerTimestamps = messages
    .filter((message) => message.userId === ownerUserId)
    .filter((message) => compareSlackTimestamps({ left: message.ts, right: afterTs }) > 0)
    .map((message) => message.ts)
    .toSorted((left, right) => compareSlackTimestamps({ left, right }));
  return ownerTimestamps[0];
}

/**
 * A raw `conversations.history` message as {@link AuthoredTs}, or `undefined` when it carries no `ts`.
 *
 * @param raw one message as Slack returned it
 * @returns its `ts` and author
 */
function authoredOfRaw({ raw }: { raw: unknown }): AuthoredTs | undefined {
  if (!isRecord(raw) || typeof raw["ts"] !== "string") {
    return undefined;
  }
  const user = raw["user"];
  return { ts: raw["ts"], userId: typeof user === "string" ? user : undefined };
}

/**
 * Read one thread whole, following a bare reply link to its root once — the read `talk slack-after` and this check
 * share, so a link means the same thread to both.
 *
 * @param permalink the Slack message link
 * @param api the Slack read seam
 * @returns the thread the link resolved to and every message in it, projected, or why it could not be read whole
 */
export async function readCompleteThread({
  permalink,
  api,
}: {
  permalink: string;
  api: Pick<SlackApi, "replies">;
}): Promise<Result<{ readonly target: SlackThreadTarget; readonly messages: readonly VisibleSlackMessage[] }>> {
  const parsed = parseSlackThreadPermalink({ permalink });
  if (parsed.isErr()) {
    return err([parsed.error.message]);
  }
  let target = parsed.value;
  let fetched = await fetchCompleteSlackThread({ api, channel: target.channel, threadTs: target.threadTs });
  if (fetched.isErr()) {
    return err([fetched.error.message]);
  }
  const redirect = redirectedTarget({ rawMessages: fetched.value.rawMessages, target });
  if (redirect !== undefined) {
    target = redirect;
    fetched = await fetchCompleteSlackThread({ api, channel: target.channel, threadTs: target.threadTs });
    if (fetched.isErr()) {
      return err([fetched.error.message]);
    }
  }
  const projected = projectSlackThread({ rawMessages: fetched.value.rawMessages, target });
  if (projected.isErr()) {
    return err([projected.error.message]);
  }
  return ok({ messages: projected.value.messages, target });
}

/**
 * A one-to-one DM's top-level messages since the anchor, unparsed, where a person answers outside any thread. Any
 * other conversation has none to read, which is an empty read rather than a skipped one.
 *
 * @param target the thread the link resolved to
 * @param oldestTs a Slack `ts` to read from in place of the link's own, or absent to read from the link's
 * @param deps the Slack read seam and the clock
 * @returns the raw messages read, or why the DM would not read whole
 */
export async function dmTopLevelRaw({
  target,
  oldestTs,
  deps,
}: {
  target: SlackThreadTarget;
  oldestTs?: string | undefined;
  deps: { readonly api: Pick<SlackApi, "history">; readonly nowMs: () => number };
}): Promise<{ kind: "read"; rawMessages: readonly unknown[] } | { kind: "unreadable"; why: string }> {
  if (!target.channel.startsWith("D")) {
    return { kind: "read", rawMessages: [] };
  }
  let oldest = target.addressedTs;
  if (oldestTs !== undefined) {
    oldest = oldestTs;
  }
  const history = await fetchCompleteSlackHistory({
    api: deps.api,
    channel: target.channel,
    latest: slackTsFromEpochMs({ ms: deps.nowMs() }),
    maxPages: DM_MAX_PAGES,
    oldest,
  });
  if (history.isErr()) {
    return { kind: "unreadable", why: `the direct message could not be read whole: ${history.error.message}` };
  }
  return { kind: "read", rawMessages: history.value.rawMessages };
}

/**
 * {@link dmTopLevelRaw}, each message reduced to its `ts` and author.
 *
 * @param target the thread the link resolved to
 * @param oldestTs a Slack `ts` to read from in place of the link's own
 * @param deps the Slack read seam and the clock
 * @returns the messages read, or why the DM would not read whole
 */
async function dmTopLevel({
  target,
  oldestTs,
  deps,
}: {
  target: SlackThreadTarget;
  oldestTs: string | undefined;
  deps: { readonly api: Pick<SlackApi, "history">; readonly nowMs: () => number };
}): Promise<{ kind: "read"; authored: readonly AuthoredTs[] } | { kind: "unreadable"; why: string }> {
  const read = await dmTopLevelRaw({ deps, oldestTs, target });
  if (read.kind === "unreadable") {
    return read;
  }
  const authored = read.rawMessages.map((raw) => authoredOfRaw({ raw }));
  // A message with no `ts` cannot be placed before or after the anchor, and it may be the owner's reply: the read is not whole.
  const torn = authored.filter((message) => message === undefined).length;
  if (torn > 0) {
    return { kind: "unreadable", why: `the direct message returned ${String(torn)} message(s) with no Slack ts` };
  }
  return { authored: authored.filter((message): message is AuthoredTs => message !== undefined), kind: "read" };
}

/**
 * Check whether the owner has posted in the thread a link names, after the message it names.
 *
 * @param permalink the Slack message link — the ask's own anchor
 * @param ownerUserId the owner's Slack user id, or `null` when the profile records none (a could-not-check, named)
 * @param deps the Slack read seam and the clock
 * @returns replied with the reply's link, not yet, or could not check with the reason
 */
export async function readOwnerReply({
  permalink,
  ownerUserId,
  deps,
}: {
  permalink: string;
  ownerUserId: string | null;
  deps: { readonly api: Pick<SlackApi, "replies" | "history">; readonly nowMs: () => number };
}): Promise<OwnerReply> {
  return (await readOwnerReplyInThread({ deps, notBeforeTs: undefined, ownerUserId, permalink })).reply;
}

/**
 * {@link readOwnerReply}, also answering which thread the link resolved to, and, given `notBeforeTs`, counting the owner's
 * messages anywhere in that thread after it instead of after the message the link names — the console voice's "did
 * that send go out", where what the owner asked for is a message of theirs after the moment they asked, whichever
 * message of the thread the link happens to name (`../../talk/slackSendOutcome.ts`).
 *
 * @param permalink the Slack message link
 * @param ownerUserId the owner's Slack user id, or `null` when the profile records none (a could-not-check, named)
 * @param notBeforeTs a Slack `ts` the owner's message must be strictly after, in place of the link's own, or `undefined`
 * @param deps the Slack read seam and the clock
 * @returns what the check found, and the thread it read when it read one
 */
export async function readOwnerReplyInThread({
  permalink,
  ownerUserId,
  notBeforeTs,
  deps,
}: {
  permalink: string;
  ownerUserId: string | null;
  notBeforeTs: string | undefined;
  deps: { readonly api: Pick<SlackApi, "replies" | "history">; readonly nowMs: () => number };
}): Promise<{ readonly reply: OwnerReply; readonly target: SlackThreadTarget | undefined }> {
  if (ownerUserId === null) {
    return {
      reply: {
        kind: "could-not-check",
        why: "the profile records no Slack user id for you (slackBot.ownerUserId) — run `slopweaver profile`",
      },
      target: undefined,
    };
  }
  const thread = await readCompleteThread({ api: deps.api, permalink });
  if (thread.isErr()) {
    return {
      reply: { kind: "could-not-check", why: `the thread could not be read whole: ${thread.error.join("; ")}` },
      target: undefined,
    };
  }
  const { target, messages } = thread.value;
  const topLevel = await dmTopLevel({ deps, oldestTs: notBeforeTs, target });
  if (topLevel.kind === "unreadable") {
    return { reply: { kind: "could-not-check", why: topLevel.why }, target };
  }
  const authored: AuthoredTs[] = [
    ...messages.map((message) => ({ ts: message.ts, userId: message.author.userId })),
    ...topLevel.authored,
  ];
  const readAtIso = new Date(deps.nowMs()).toISOString();
  let afterTs = target.addressedTs;
  if (notBeforeTs !== undefined) {
    afterTs = notBeforeTs;
  }
  const ts = firstOwnerReplyTs({ afterTs, messages: authored, ownerUserId });
  if (ts === undefined) {
    return { reply: { kind: "not-yet", readAtIso }, target };
  }
  // A top-level DM answer is its own root, so its link carries no `thread_ts` pointing into a thread it is not in.
  const inThread = messages.some((message) => message.ts === ts);
  return { reply: repliedAt({ inThread, target, ts }), target };
}

/** The owner's reply at `ts`, linked into the thread when it is in one, or a could-not-check when `ts` is not a Slack `ts`. */
function repliedAt({ inThread, target, ts }: { inThread: boolean; target: SlackThreadTarget; ts: string }): OwnerReply {
  const atIso = slackTsToIso({ ts });
  if (atIso === undefined) {
    return { kind: "could-not-check", why: `Slack returned a reply whose ts "${ts}" is not a Slack timestamp` };
  }
  return {
    atIso,
    kind: "replied",
    permalink: slackAskPermalink({
      askIdentity: { channel: target.channel, messageTs: ts, threadTs: inThread ? target.threadTs : ts },
      workspaceUrl: target.workspace,
    }),
    ts,
  };
}

/**
 * The one line `slack replied` prints, and the line its derived done-check greps for (`^replied at `).
 *
 * @param reply what the check found
 * @param permalink the link the check was asked about
 * @returns the line
 */
export function ownerReplyLine({ reply, permalink }: { reply: OwnerReply; permalink: string }): string {
  if (reply.kind === "replied") {
    return `replied at ${reply.atIso}: ${reply.permalink}`;
  }
  if (reply.kind === "not-yet") {
    return `not yet: no message of yours after the one ${permalink} names, read ${reply.readAtIso}`;
  }
  return `could not check: ${reply.why}`;
}
