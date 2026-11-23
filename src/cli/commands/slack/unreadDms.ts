/**
 * The DM half of `slopweaver slack unread`: which conversations had traffic, each one's Slack read marker, the
 * messages past it, and the DM threads a person replied in — against injected seams, beside the activity half in
 * `./unreadRead.ts`, whose deadline, search and thread read it shares.
 *
 * `search.messages` `is:dm` and `is:mpim` name the conversations with traffic, and `conversations.info` answers each
 * one's read marker (`../../../live/slack/readMarker.ts`) — measured, 22 of 22 `is:dm` hits under `/archives/D`
 * (`slopweaver slack probe --method search.messages "query=is:dm after:<yyyy-mm-dd>" count=100
 * --count-where "messages.matches:permalink~/archives/D"`).
 */
import { formatIngestError } from "../../../lib/ingestError.js";
import { createConcurrencyLimiter } from "../../../lib/resilience.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { projectTopLevelMessages } from "../../../live/slack/projection.js";
import { isDirectConversation, mayHaveUnread, readMarkerOf, statesNotDirect } from "../../../live/slack/readMarker.js";
import type { SlackSearchMatch } from "../../../live/slack/searchMessages.js";
import type { UnreadDmRead, UnreadThreadRead } from "../../../live/slack/unreadRows.js";
import { liveThreadKey } from "../../../review/reviewConversation.js";
import { type AuthorResolver, afterDateOf } from "./taggedRead.js";
import {
  CONCURRENCY,
  halvesOf,
  type LegResult,
  type ReadDeadline,
  readThreads,
  type SlackUnreadSeams,
  searchAll,
  type ThreadCandidate,
  type Timed,
  underDeadline,
} from "./unreadRead.js";

/**
 * How many conversations' read markers are asked for at most, DM-shaped first, then newest traffic. Their workspace
 * named 53 over seven days, so 64 checks them all; a run past it is incomplete, never quietly capped.
 */
const DM_INFO_CAP = 64;

/** How many unread messages one DM's read takes; a DM with more says so, and Slack's own count says how many. */
const DM_HISTORY_LIMIT = 100;

/** How many DM threads a person replied in are read whole at most, newest reply first. */
const DM_THREAD_CAP = 8;

/**
 * The DM half: the conversations with traffic since `sinceIso`, each one's read marker, and the messages past it
 * for every one that has any.
 *
 * @param seams the live edges
 * @param ownerId their own Slack id
 * @param sinceIso the oldest traffic that names a conversation
 * @param nowMs the run's instant, the history read's upper bound
 * @param deadline the shared deadline
 * @param author who an author id is, so an app's DM-thread reply is never opened
 * @returns every unread DM read, the DM threads a person replied in, how many DMs' markers were told, the DM ids,
 *   what was not read, and whether the half is incomplete — a cap that left conversations unchecked included
 */
export async function readUnreadDms({
  seams,
  ownerId,
  sinceIso,
  nowMs,
  deadline,
  author,
}: {
  seams: SlackUnreadSeams;
  ownerId: string;
  sinceIso: string;
  nowMs: number;
  deadline: ReadDeadline;
  author: AuthorResolver;
}): Promise<
  LegResult<UnreadDmRead> & {
    readonly channels: ReadonlySet<string>;
    readonly checked: number;
    readonly threads: readonly UnreadThreadRead[];
  }
> {
  const after = afterDateOf({ sinceIso });
  const searched = await searchAll({
    deadline,
    queries: [`is:dm after:${after}`, `is:mpim after:${after}`],
    search: seams.search,
  });
  const { ordered, shapedDirect } = conversationsByTraffic({ matches: searched.matches.flat() });
  const limit = createConcurrencyLimiter({ concurrency: CONCURRENCY });
  const outcomes = await Promise.all(
    ordered
      .slice(0, DM_INFO_CAP)
      .map((channel) =>
        limit(() => underDeadline({ deadline, task: () => unreadDm({ channel, nowMs, ownerId, seams }) })),
      ),
  );
  const { read, known, residue: outcomeResidue } = foldDmOutcomes({ ordered, outcomes });
  const residue = [...searched.residue, ...outcomeResidue];
  if (ordered.length > DM_INFO_CAP) {
    residue.push(`${String(ordered.length - DM_INFO_CAP)} quieter DM(s) were not checked for unread messages`);
  }
  // A DM proven by its own flags, or one never checked that is shaped like a DM: what the activity half leaves to
  // this one. A private channel the cap left unchecked is not here, so its threads still reach the activity list.
  const channels = new Set(ordered.filter((channel) => known.has(channel) || shapedDirect.has(channel)));
  // Slack's read marker counts only top-level messages, so a reply under a DM message moves no count and no history
  // read sees it; the two searches above do.
  const threads = await readThreads({
    candidates: dmThreadCandidates({ author, channels, matches: searched.matches.flat(), ownerId }),
    cap: DM_THREAD_CAP,
    deadline,
    noun: "DM thread",
    seams,
  });
  residue.push(...threads.residue);
  const incomplete = residue.length > 0;
  residue.push(`a DM is checked only when it has a message since ${sinceIso}; one unread from before then is not seen`);
  return { channels, checked: known.size, incomplete, read, residue, threads: threads.read };
}

/**
 * The DM threads worth opening, newest reply first: one per thread where a PERSON replied after their own newest
 * word there that the searches found. An app's reply, or a thread they answered last, could never make a row, so
 * neither spends the cap. Each is judged like any activity thread — news after their last word there, or, in one they
 * never spoke in, from its root, a DM thread being addressed to them whole.
 *
 * @param matches every hit of the two DM searches
 * @param channels the conversations that are DMs
 * @param ownerId their own Slack id
 * @param author who an author id is — an app's reply is never a candidate
 * @returns the candidates, newest first
 */
export function dmThreadCandidates({
  matches,
  channels,
  ownerId,
  author,
}: {
  matches: readonly SlackSearchMatch[];
  channels: ReadonlySet<string>;
  ownerId: string;
  author: AuthorResolver;
}): readonly ThreadCandidate[] {
  const byKey = new Map<string, ThreadCandidate>();
  const ownerNewest = new Map<string, number>();
  for (const match of matches) {
    if (!channels.has(match.channelId)) {
      continue;
    }
    const key = liveThreadKey({ channelId: match.channelId, permalink: match.permalink, ts: match.ts });
    const { threadTs } = halvesOf({ key });
    const latest = Number(match.ts);
    if (match.userId === ownerId) {
      const owned = ownerNewest.get(key);
      if (owned === undefined || latest > owned) {
        ownerNewest.set(key, latest);
      }
      continue;
    }
    const held = byKey.get(key);
    const isPersonReply = threadTs !== match.ts && author({ authorId: match.userId }).isHuman;
    if (isPersonReply && (held === undefined || latest > held.latest)) {
      byKey.set(key, {
        channelId: match.channelId,
        channelName: undefined,
        direct: true,
        latest,
        taggedFromTs: threadTs,
        threadTs,
      });
    }
  }
  return [...byKey.entries()]
    .filter(([key, candidate]) => {
      const owned = ownerNewest.get(key);
      return owned === undefined || owned < candidate.latest;
    })
    .map(([, candidate]) => candidate)
    .toSorted((a, b) => b.latest - a.latest);
}

/**
 * Whether a search hit's conversation is shaped like a DM — a `D` id, or a group DM's `mpdm-` name — before
 * `conversations.info` is asked. Only an ordering hint: a private channel is told apart by its own flags.
 *
 * @param match one search hit
 * @returns true when the id or name says DM
 */
function looksDirect({ match }: { match: SlackSearchMatch }): boolean {
  return match.channelId.startsWith("D") || match.channelName.startsWith("mpdm-");
}

/**
 * The conversations the DM searches named, in the order their markers are asked: one that looks like a DM ahead of
 * one that may be a private channel `is:mpim` also matched, so those never spend the cap, then newest traffic first.
 * `conversations.info` still decides which is which.
 */
function conversationsByTraffic({ matches }: { matches: readonly SlackSearchMatch[] }): {
  readonly ordered: readonly string[];
  readonly shapedDirect: ReadonlySet<string>;
} {
  const newest = new Map<string, { tsIso: string; direct: boolean }>();
  for (const match of matches) {
    const held = newest.get(match.channelId);
    if (match.channelId !== "" && (held === undefined || match.tsIso > held.tsIso)) {
      newest.set(match.channelId, { direct: looksDirect({ match }), tsIso: match.tsIso });
    }
  }
  const ordered = [...newest.entries()]
    .toSorted(([, a], [, b]) => {
      if (a.direct !== b.direct) {
        return a.direct ? -1 : 1;
      }
      return a.tsIso > b.tsIso ? -1 : 1;
    })
    .map(([channel]) => channel);
  const shapedDirect = new Set([...newest.entries()].filter(([, held]) => held.direct).map(([channel]) => channel));
  return { ordered, shapedDirect };
}

/** Every checked conversation's outcome folded into the DMs read, the ones proven DMs, and what was not read. */
function foldDmOutcomes({ ordered, outcomes }: { ordered: readonly string[]; outcomes: readonly Timed<DmOutcome>[] }): {
  readonly read: readonly UnreadDmRead[];
  readonly known: ReadonlySet<string>;
  readonly residue: string[];
} {
  const read: UnreadDmRead[] = [];
  const known = new Set<string>();
  const residue: string[] = [];
  let late = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.kind === "late") {
      late += 1;
    } else if (outcome.kind === "failed") {
      residue.push(`a DM could not be read: ${outcome.why}`);
    } else if (outcome.value.kind === "unknown") {
      residue.push(outcome.value.why);
    } else if (outcome.value.kind !== "not-direct") {
      known.add(ordered[index]!);
      if (outcome.value.kind === "unread") {
        read.push(outcome.value.read);
        residue.push(...unreadResidue({ outcome: outcome.value }));
      }
    }
  });
  if (late > 0) {
    residue.push(`${String(late)} DM(s) were not checked in time`);
  }
  return { known, read, residue };
}

/** What one unread DM's read left out: messages past the history page, and rows that would not project. */
function unreadResidue({ outcome }: { outcome: Extract<DmOutcome, { kind: "unread" }> }): readonly string[] {
  const lines: string[] = [];
  if (outcome.more) {
    lines.push(
      `a DM has more than ${String(DM_HISTORY_LIMIT)} unread messages; only the newest ${String(DM_HISTORY_LIMIT)} were read`,
    );
  }
  if (outcome.unreadable > 0) {
    lines.push(`${String(outcome.unreadable)} message(s) past a DM's read marker could not be read`);
  }
  return lines;
}

/** What one conversation's read-marker check found. */
type DmOutcome =
  | { readonly kind: "unread"; readonly read: UnreadDmRead; readonly more: boolean; readonly unreadable: number }
  | { readonly kind: "clear" }
  | { readonly kind: "not-direct" }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * One conversation's read marker and, when something is unread, the messages past it.
 *
 * @param seams the live edges
 * @param channel the conversation id
 * @param ownerId their own Slack id
 * @param nowMs the history read's upper bound
 * @returns what the check found: unread with its messages, clear, not a DM at all, or why it could not be told
 */
async function unreadDm({
  seams,
  channel,
  ownerId,
  nowMs,
}: {
  seams: SlackUnreadSeams;
  channel: string;
  ownerId: string;
  nowMs: number;
}): Promise<DmOutcome> {
  const body = await seams.info({ channel });
  if (body.isErr()) {
    return {
      kind: "unknown",
      why: `a DM's read marker could not be read: ${formatIngestError({ error: body.error })}`,
    };
  }
  if (!isDirectConversation({ body: body.value })) {
    // Passed over only on Slack's own word that it is not a DM; a body that does not say is a read not told.
    return statesNotDirect({ body: body.value })
      ? { kind: "not-direct" }
      : { kind: "unknown", why: "a conversation's kind could not be told: Slack's answer named no DM flags" };
  }
  const marker = readMarkerOf({ body: body.value });
  if (marker.isErr()) {
    return { kind: "unknown", why: `a DM's read marker could not be told: ${marker.error.message}` };
  }
  if (!mayHaveUnread({ marker: marker.value, ownerId })) {
    return { kind: "clear" };
  }
  const page = await seams.api.history({
    channel,
    latest: slackTsFromEpochMs({ ms: nowMs }),
    oldest: marker.value.lastRead,
    pageSize: DM_HISTORY_LIMIT,
  });
  const { messages, unreadable } = projectTopLevelMessages({
    channel,
    rawMessages: page.messages,
    workspace: seams.workspace,
  });
  const more = page.hasMore === true;
  // A group DM carries no count, so past its marker only somebody else's message makes it unread — and only a
  // page read whole, every row of it understood, can say none is.
  const onlyOwners = messages.every((message) => message.author.userId === ownerId);
  if (marker.value.unreadCount === undefined && onlyOwners && !more && unreadable === 0) {
    return { kind: "clear" };
  }
  return { kind: "unread", more, read: { marker: marker.value, messages }, unreadable };
}
