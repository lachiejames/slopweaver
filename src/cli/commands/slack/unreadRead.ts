/**
 * The live reads behind `slopweaver slack unread`, against injected seams so each is driven by plain fakes: the
 * activity half here, the DM half in `./unreadDms.ts`, and the deadline, search and thread read both share.
 *
 * ## Why live, and not `slack owed`'s corpus read
 *
 * MEASURED: `slopweaver slack owed` took 26 s wall and the Slack corpus lagged by seven hours. The console kills a voice tool at 20 s (`site/lib/talkToolsList.ts`), and what is unread sits almost entirely
 * in the seven hours the corpus has not crawled. So both halves read Slack now, and each reuses a reader that
 * already exists rather than standing up a third detector:
 *
 * - **DMs**: Slack's own read marker, per conversation (`./unreadDms.ts`).
 * - **Activity**: `slack tagged`'s live leg (`./taggedRead.ts`) — its `<@them>` search and its `from:<@them>` search,
 *   judged by its own `liveCandidatesOf` and `liveTrailOf` — names the threads they spoke in and the ones they were
 *   tagged in; each is read whole by the same fetch `talk slack-after` uses, and `slack owed`'s classifier says
 *   whether it is for them (`../../../live/slack/unreadRows.ts`).
 *
 * ## A deadline, and what it leaves
 *
 * Every per-conversation call runs under what is left of one deadline. A read that has not answered by then is
 * counted into the residue as not read in time, and the document is `incomplete` — never an empty all-clear.
 */
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { createConcurrencyLimiter, withTimeout } from "../../../lib/resilience.js";
import type { ResultAsync } from "../../../lib/result.js";
import { fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import { projectSlackThread } from "../../../live/slack/projection.js";
import { type SlackSearchMatch, type SlackSearchMessages, searchAllPages } from "../../../live/slack/searchMessages.js";
import type { UnreadThreadRead } from "../../../live/slack/unreadRows.js";
import { type AuthorResolver, afterDateOf, liveCandidatesOf, liveTrailOf } from "./taggedRead.js";

/** Search matches per page, Slack's own maximum. */
const SEARCH_PAGE_SIZE = 100;

/** The most search pages read per query; a result spanning more is named in the residue. */
const SEARCH_MAX_PAGES = 3;

/** How many threads are read whole at most, newest first. 33 messages of their in 3.5 days, 24 in threads. */
const THREAD_CAP = 24;

/** The most pages one thread's read walks; a longer thread is named in the residue rather than read past the deadline. */
const THREAD_MAX_PAGES = 4;

/** How many Slack calls run at once — under the Tier 3 burst `conversations.replies` and `.info` share. */
export const CONCURRENCY = 8;

/** The live edges one read needs: their own token's search, the read marker, the thread and history reads. */
export interface SlackUnreadSeams {
  readonly search: SlackSearchMessages;
  readonly info: (args: { channel: string }) => ResultAsync<unknown, IngestError>;
  readonly api: Pick<SlackApi, "replies" | "history">;
  /** The workspace origin permalinks are built on, from `auth.test`. */
  readonly workspace: string;
}

/** A deadline every per-conversation call shares. */
export interface ReadDeadline {
  /** Milliseconds left, read from the caller's clock. */
  readonly remainingMs: () => number;
}

/** What one half read, and what it could not. */
export interface LegResult<T> {
  readonly read: readonly T[];
  readonly residue: readonly string[];
  readonly incomplete: boolean;
}

/** One task's outcome under the deadline. */
export type Timed<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "late" }
  | { readonly kind: "failed"; readonly why: string };

/** One thread either half will read whole. */
export interface ThreadCandidate {
  readonly channelId: string;
  readonly threadTs: string;
  readonly channelName: string | undefined;
  /** A thread inside a DM or group DM, said as one rather than as a channel. */
  readonly direct: boolean;
  /** The newest instant that made it a candidate, as a Slack `ts` number, for ordering. */
  readonly latest: number;
  readonly taggedFromTs: string | undefined;
}

/**
 * Run one task under what is left of the deadline.
 *
 * @param deadline the shared deadline
 * @param task the call to make
 * @returns its value, that it ran out of time, or why it threw
 */
export async function underDeadline<T>({
  deadline,
  task,
}: {
  deadline: ReadDeadline;
  task: () => Promise<T>;
}): Promise<Timed<T>> {
  const remainingMs = deadline.remainingMs();
  if (remainingMs <= 0) {
    return { kind: "late" };
  }
  try {
    return { kind: "done", value: await withTimeout({ task, timeoutMs: remainingMs }) };
  } catch (error) {
    if (deadline.remainingMs() <= 0) {
      return { kind: "late" };
    }
    return { kind: "failed", why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Every page of two searches, side by side, with the residue line for each that stopped short.
 *
 * @param search the live search seam
 * @param queries the queries to run
 * @param deadline the shared deadline
 * @returns every match, one list per query in the order asked, and why any search stopped short
 */
export async function searchAll({
  search,
  queries,
  deadline,
}: {
  search: SlackSearchMessages;
  queries: readonly string[];
  deadline: ReadDeadline;
}): Promise<{ matches: readonly (readonly SlackSearchMatch[])[]; residue: readonly string[] }> {
  const runs = await Promise.all(
    queries.map((query) =>
      underDeadline({
        deadline,
        task: () => searchAllPages({ count: SEARCH_PAGE_SIZE, maxPages: SEARCH_MAX_PAGES, query, search }),
      }),
    ),
  );
  const residue: string[] = [];
  const matches = runs.map((run, index) => {
    const query = queries[index]!;
    if (run.kind === "late") {
      residue.push(`the search \`${query}\` did not answer in time, so what it would have found is not listed`);
      return [];
    }
    if (run.kind === "failed") {
      residue.push(`the search \`${query}\` failed (${run.why}), so what it would have found is not listed`);
      return [];
    }
    if (!run.value.receipt.complete) {
      residue.push(`the search \`${query}\` stopped short: ${run.value.receipt.stoppedBecause}`);
    }
    return run.value.matches;
  });
  return { matches, residue };
}

/**
 * The activity half: the threads they spoke in and the ones they were tagged in and has not answered, read whole.
 *
 * @param seams the live edges
 * @param ownerId their own Slack id
 * @param sinceIso the oldest word of their, or tag of them, that names a thread
 * @param nowIso the newest
 * @param author who an author id is
 * @param deadline the shared deadline
 * @returns every thread read, what was not, and whether the half is incomplete
 */
export async function readUnreadActivity({
  seams,
  ownerId,
  sinceIso,
  nowIso,
  author,
  deadline,
}: {
  seams: SlackUnreadSeams;
  ownerId: string;
  sinceIso: string;
  nowIso: string;
  author: AuthorResolver;
  deadline: ReadDeadline;
}): Promise<LegResult<UnreadThreadRead> & { readonly appTagsNotListed: number }> {
  const after = afterDateOf({ sinceIso });
  const searched = await searchAll({
    deadline,
    queries: [`<@${ownerId}> after:${after}`, `from:<@${ownerId}> after:${after}`],
    search: seams.search,
  });
  const tagMatches = searched.matches[0]!;
  const ownerMatches = searched.matches[1]!;
  const found = threadCandidates({ author, ownerMatches, nowIso, ownerId, sinceIso, tagMatches });
  const threads = await readThreads({ candidates: found.candidates, cap: THREAD_CAP, deadline, noun: "thread", seams });
  const residue = [...searched.residue, ...threads.residue];
  const incomplete = residue.length > 0;
  // An app's post names no author, as in `slack tagged`: not a person's word, so counted beside the status rather
  // than marked short. `incomplete` on a read listing nothing fails the verb, and one app tag must not lose an
  // all-clear (`slackUnreadAnswers`).
  if (found.authorless > 0) {
    residue.push(`${String(found.authorless)} tag hit(s) named no author, an app post, and are not listed`);
  }
  residue.push(
    `a thread is listed only when you spoke or were tagged in it since ${sinceIso}; one you only follow is not seen`,
  );
  return { appTagsNotListed: found.authorless, incomplete, read: threads.read, residue };
}

/**
 * The threads worth opening, newest first: every thread they spoke in, and every thread a person tagged them in that
 * they have not spoken in — `slack tagged`'s own judgement of both searches. A DM's threads are the DM half's.
 *
 * @param tagMatches the `<@them>` search's hits
 * @param ownerMatches the `from:<@them>` search's hits
 * @param ownerId their own Slack id
 * @param sinceIso the window's start
 * @param nowIso the window's end
 * @param author who an author id is
 * @returns the candidates, newest first, and how many tag hits named no author — an app post, never listed
 */
export function threadCandidates({
  tagMatches,
  ownerMatches,
  ownerId,
  sinceIso,
  nowIso,
  author,
}: {
  tagMatches: readonly SlackSearchMatch[];
  ownerMatches: readonly SlackSearchMatch[];
  ownerId: string;
  sinceIso: string;
  nowIso: string;
  author: AuthorResolver;
}): { readonly candidates: readonly ThreadCandidate[]; readonly authorless: number } {
  const names = new Map<string, string>();
  for (const match of [...tagMatches, ...ownerMatches]) {
    if (match.channelName !== "") {
      names.set(match.channelId, match.channelName);
    }
  }
  const trail = liveTrailOf({ matches: ownerMatches, nowIso, ownerId });
  const byKey = new Map<string, ThreadCandidate>();
  for (const [key, ownTs] of trail.byThread) {
    byKey.set(key, candidateOf({ key, latest: ownTs, names, taggedFromTs: undefined }));
  }
  const tags = liveCandidatesOf({ author, matches: tagMatches, nowIso, ownerId, sinceIso });
  for (const tag of tags.candidates.toSorted((a, b) => a.ownTs - b.ownTs)) {
    const held = byKey.get(tag.threadKey);
    if (!tag.authorIsHuman || (held !== undefined && held.taggedFromTs === undefined)) {
      continue;
    }
    const taggedFromTs = held === undefined ? tag.messageKey.split(":")[1]! : held.taggedFromTs;
    byKey.set(tag.threadKey, candidateOf({ key: tag.threadKey, latest: tag.ownTs, names, taggedFromTs }));
  }
  const candidates = [...byKey.values()]
    .filter((candidate) => !candidate.channelId.startsWith("D"))
    .toSorted((a, b) => b.latest - a.latest);
  return { authorless: tags.authorless, candidates };
}

/** One candidate from its `channel:rootTs` key. */
function candidateOf({
  key,
  latest,
  names,
  taggedFromTs,
}: {
  key: string;
  latest: number;
  names: ReadonlyMap<string, string>;
  taggedFromTs: string | undefined;
}): ThreadCandidate {
  const { channelId, threadTs } = halvesOf({ key });
  return { channelId, channelName: names.get(channelId), direct: false, latest, taggedFromTs, threadTs };
}

/**
 * The two halves of a `liveThreadKey` — `channel:rootTs`, so the first colon divides them.
 *
 * @param key the thread key
 * @returns the conversation id and the root's `ts`
 */
export function halvesOf({ key }: { key: string }): { channelId: string; threadTs: string } {
  const colon = key.indexOf(":");
  return { channelId: key.slice(0, colon), threadTs: key.slice(colon + 1) };
}

/**
 * Read each candidate whole under the deadline, up to a cap, and say in the residue what was not read.
 *
 * @param candidates the threads, newest first
 * @param cap how many are read at most; the rest are named as not opened
 * @param noun what one is called in the residue — "thread", "DM thread"
 * @param seams the live edges
 * @param deadline the shared deadline
 * @returns every thread read, and what was not
 */
export async function readThreads({
  candidates,
  cap,
  noun,
  seams,
  deadline,
}: {
  candidates: readonly ThreadCandidate[];
  cap: number;
  noun: string;
  seams: SlackUnreadSeams;
  deadline: ReadDeadline;
}): Promise<{ read: readonly UnreadThreadRead[]; residue: readonly string[] }> {
  const limit = createConcurrencyLimiter({ concurrency: CONCURRENCY });
  const outcomes = await Promise.all(
    candidates
      .slice(0, cap)
      .map((candidate) => limit(() => underDeadline({ deadline, task: () => readThread({ candidate, seams }) }))),
  );
  const read: UnreadThreadRead[] = [];
  const residue: string[] = [];
  let late = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === "late") {
      late += 1;
    } else if (outcome.kind === "failed") {
      residue.push(`a ${noun} could not be read: ${outcome.why}`);
    } else if (typeof outcome.value === "string") {
      residue.push(outcome.value);
    } else {
      read.push(outcome.value);
    }
  }
  if (late > 0) {
    residue.push(`${String(late)} ${noun}(s) were not read in time`);
  }
  if (candidates.length > cap) {
    residue.push(`${String(candidates.length - cap)} older ${noun}(s) were not opened`);
  }
  return { read, residue };
}

/**
 * One thread read whole and projected.
 *
 * @param candidate the thread
 * @param seams the live edges
 * @returns the thread, or a sentence saying why it could not be read whole
 */
async function readThread({
  candidate,
  seams,
}: {
  candidate: ThreadCandidate;
  seams: SlackUnreadSeams;
}): Promise<UnreadThreadRead | string> {
  const { channelId, threadTs } = candidate;
  const fetched = await fetchCompleteSlackThread({
    api: seams.api,
    channel: channelId,
    maxPages: THREAD_MAX_PAGES,
    threadTs,
  });
  if (fetched.isErr()) {
    return `a thread could not be read whole: ${fetched.error.message}`;
  }
  const target = {
    addressedReply: false,
    addressedTs: threadTs,
    channel: channelId,
    threadTs,
    workspace: seams.workspace,
  };
  const projected = projectSlackThread({ rawMessages: fetched.value.rawMessages, target });
  if (projected.isErr()) {
    return `a thread could not be projected: ${projected.error.message}`;
  }
  return {
    channelId,
    channelName: candidate.channelName,
    direct: candidate.direct,
    messages: projected.value.messages,
    taggedFromTs: candidate.taggedFromTs,
  };
}
