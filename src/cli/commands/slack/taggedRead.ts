/**
 * The two reads behind `slopweaver slack tagged`: the corpus leg, one streaming pass over Slack bronze, and the
 * live leg, two paged `search.messages` calls on their USER token. Each hands `live/slack/taggedDocument.ts`
 * candidates with their author already resolved, so the document stays pure. The corpus leg also hands over each
 * channel's own crawl cursor, so a row's "no later word" holds only as far as its own channel was read.
 *
 * ## The corpus leg keeps EVERY tag, not the latest per thread
 *
 * `../sessionStart/slackRead.ts`'s pass one keeps only the latest tagging message per thread, because
 * `session-start` ranks threads. This verb lists messages, so it runs its own collector over the same
 * prefilter — a line is parsed only when it carries their id or a `\u` escape — and keys each tag on
 * `messageKeyOf`, which is what dedupes the copies overlapping window files hold of one message.
 *
 * ## The live leg judges every hit locally
 *
 * Search is a candidate generator. MEASURED on their workspace — `slopweaver slack probe --method
 * search.messages "query=<@U…> after:<yyyy-mm-dd>" count=100 --count-where "messages.matches:user~U…"` — 13 hits,
 * 5 of them their own messages. So a hit is kept only when its text carries a mention RUN of them (the same test
 * the corpus leg's `tagsOwner` applies), it is not their, and it lands inside the window. A second search,
 * `from:<@them>`, finds their own replies so a tag answered inside the corpus's lag reads as answered.
 */

import { readSlackChannelWatermarks } from "../../../corpus/slack/channelWatermark.js";
import { readWatermark } from "../../../corpus/watermark.js";
import { type SlackSearchMatch, type SlackSearchMessages, searchAllPages } from "../../../live/slack/searchMessages.js";
import type { OwnerTrail, TaggedCandidate, TaggedCorpusLeg, TaggedLiveLeg } from "../../../live/slack/taggedTypes.js";
import { mentionRunsIn } from "../../../review/prLink.js";
import { liveThreadKey } from "../../../review/reviewConversation.js";
import { authorIsHuman, displayNameOf, type MemberFacts } from "../sessionStart/slackPeople.js";
import { slackFiles } from "../sessionStart/slackRead.js";
import { messageKeyOf, slackRowOf, tagsOwner, threadKeyOf, unreadableWord } from "../sessionStart/slackRow.js";
import { scanFile } from "../sessionStart/slackScan.js";

/** How much of a tagging message a row quotes. Long enough to recognise, short enough not to be a wall. */
const QUOTE_CHARS = 140;

/** Search matches per page, Slack's own maximum. */
const SEARCH_PAGE_SIZE = 100;

/** The most search pages read per query; a result spanning more is reported incomplete, never truncated silently. */
const SEARCH_MAX_PAGES = 10;

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/** Slack's own account `USLACK`, which Slack reports as `is_bot: false`; `authorIsHuman` does not name it. */
const SLACK_ID = "USLACK";

/** Who wrote a tag, as a row needs it. */
interface AuthorFacts {
  readonly name: string;
  readonly isHuman: boolean;
  readonly known: boolean;
}

/** Resolve one author id to what a row needs. */
export type AuthorResolver = (args: { authorId: string }) => AuthorFacts;

/**
 * The resolver both legs use, over the members index and Slopweaver's own ids.
 *
 * @param members the members index
 * @param selfIds Slopweaver's own declared bot ids
 * @returns a resolver answering the name, whether the author is a person, and whether the index knows them
 */
export function peopleResolver({
  members,
  selfIds,
}: {
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): AuthorResolver {
  return ({ authorId }) => ({
    isHuman: authorId !== SLACK_ID && authorIsHuman({ author: authorId, members, selfIds }),
    known: members.has(authorId),
    name: displayNameOf({ author: authorId, members }),
  });
}

/**
 * One message's text as a one-line quote.
 *
 * @param text the message text
 * @returns the quote
 */
function quoteOf({ text }: { text: string }): string {
  return text.replaceAll("\n", " ").trim().slice(0, QUOTE_CHARS);
}

/**
 * Raise one trail entry to a later message of their.
 *
 * @param into the map to raise
 * @param key the thread or conversation
 * @param ownTs their message's own Slack `ts`
 */
function raise({ into, key, ownTs }: { into: Map<string, number>; key: string; ownTs: number }): void {
  const held = into.get(key);
  if (held === undefined || ownTs > held) {
    into.set(key, ownTs);
  }
}

/** A trail being filled in. */
interface TrailBuilder {
  readonly byThread: Map<string, number>;
  readonly byDm: Map<string, number>;
}

/**
 * Record one message of their on a trail.
 *
 * @param trail the trail to fill
 * @param threadKey the thread it sits in
 * @param channelId the conversation it sits in
 * @param ownTs its own Slack `ts`
 */
function recordOwnerWord({
  trail,
  threadKey,
  channelId,
  ownTs,
}: {
  trail: TrailBuilder;
  threadKey: string;
  channelId: string;
  ownTs: number;
}): void {
  raise({ into: trail.byThread, key: threadKey, ownTs });
  if (channelId.startsWith("D")) {
    raise({ into: trail.byDm, key: channelId, ownTs });
  }
}

/**
 * How far the corpus reaches: its pooled watermark, capped by the furthest any one channel was crawled.
 *
 * The pooled value alone is not trusted. An ingest that fetched nothing banks its window's END, a bare day after
 * today, unclamped (`corpus/ingestSource.ts`), so a pooled watermark can sit in the future and hide the unread
 * tail since the last crawl. No channel can hold a message later than its own cursor, so the furthest cursor is
 * a ceiling the pooled value may not pass.
 *
 * @param pooled the pooled Slack watermark, undefined when the corpus carries none
 * @param channelReach channel id → that channel's own crawl cursor
 * @returns the reach, undefined when the pooled watermark is absent
 */
function corpusReach({
  pooled,
  channelReach,
}: {
  pooled: string | undefined;
  channelReach: ReadonlyMap<string, string>;
}): string | undefined {
  let furthest: string | undefined;
  for (const cursor of channelReach.values()) {
    if (furthest === undefined || cursor > furthest) {
      furthest = cursor;
    }
  }
  if (pooled === undefined || furthest === undefined || pooled <= furthest) {
    return pooled;
  }
  return furthest;
}

/** What the corpus pass accumulates across every file. */
interface CorpusCollector {
  readonly candidates: Map<string, TaggedCandidate>;
  readonly trail: TrailBuilder;
  unparsed: number;
}

/**
 * Fold one bronze line into the collector: a tag of them in the window becomes a candidate, a word of their joins
 * the trail, and a line carrying their id that does not parse is counted.
 *
 * @param line one raw JSONL line
 * @param ownerId their own Slack id
 * @param sinceIso the oldest message that counts
 * @param nowIso the newest message that counts
 * @param author resolves each tag's author
 * @param into the collector to fold into
 */
function collectLine({
  line,
  ownerId,
  sinceIso,
  nowIso,
  author,
  into,
}: {
  line: string;
  ownerId: string;
  sinceIso: string;
  nowIso: string;
  author: AuthorResolver;
  into: CorpusCollector;
}): void {
  if (!line.includes(ownerId) && !line.includes("\\u")) {
    return;
  }
  const row = slackRowOf({ line });
  if (row === undefined) {
    into.unparsed += Number(unreadableWord({ keys: undefined, line }));
    return;
  }
  if (row.tsIso < sinceIso || row.tsIso > nowIso) {
    return;
  }
  const threadKey = threadKeyOf({ sourceId: row.sourceId });
  if (threadKey === undefined) {
    into.unparsed += Number(row.author === ownerId || tagsOwner({ ownerId, row }));
    return;
  }
  // Both segments exist because `threadKeyOf` built this key from exactly two non-empty ones.
  const channelId = threadKey.split(":")[0]!;
  if (row.author === ownerId) {
    recordOwnerWord({ channelId, ownTs: row.ownTs, threadKey, trail: into.trail });
    return;
  }
  const messageKey = messageKeyOf({ sourceId: row.sourceId });
  if (!tagsOwner({ ownerId, row }) || into.candidates.has(messageKey)) {
    return;
  }
  const facts = author({ authorId: row.author });
  into.candidates.set(messageKey, {
    authorId: row.author,
    authorIsHuman: facts.isHuman,
    authorKnown: facts.known,
    authorName: facts.name,
    channelId,
    channelName: row.channelName,
    messageKey,
    ownTs: row.ownTs,
    permalink: row.url,
    text: quoteOf({ text: row.text }),
    threadKey,
    tsIso: row.tsIso,
  });
}

/**
 * The corpus leg: every tag of them inside the window, and every word of their that could answer one.
 *
 * @param home the state home to read
 * @param ownerId their own Slack id
 * @param sinceIso the oldest message that counts
 * @param nowIso the newest message that counts
 * @param author resolves each tag's author
 * @returns the leg, `unavailable` with the typed reason when the corpus could not be listed or read
 */
export function readTaggedCorpus({
  home,
  ownerId,
  sinceIso,
  nowIso,
  author,
}: {
  home: string;
  ownerId: string;
  sinceIso: string;
  nowIso: string;
  author: AuthorResolver;
}): TaggedCorpusLeg {
  const listed = slackFiles({ home });
  if ("refusal" in listed) {
    return { kind: "unavailable", reason: `the Slack corpus could not be listed: ${listed.refusal.message}` };
  }
  // `slackFiles` reads a missing directory as an ordinary empty list, which is right for `session-start` and
  // wrong here: zero files read is not zero tags, and this verb never prints an empty all-clear.
  if (listed.paths.length === 0) {
    return { kind: "unavailable", reason: "this home holds no Slack corpus, so nothing was read" };
  }
  const into: CorpusCollector = { candidates: new Map(), trail: { byDm: new Map(), byThread: new Map() }, unparsed: 0 };
  for (const path of listed.paths) {
    const failed = scanFile({
      onLine: ({ line }) => {
        collectLine({ author, into, line, nowIso, ownerId, sinceIso });
      },
      path,
    });
    if (failed !== undefined) {
      return { kind: "unavailable", reason: `a Slack corpus file could not be read: ${failed.message}` };
    }
  }
  const { candidates, trail, unparsed } = into;
  const channelReach = new Map<string, string>();
  for (const [channelId, entry] of readSlackChannelWatermarks({ home })) {
    channelReach.set(channelId, entry.cursor);
  }
  return {
    candidates: [...candidates.values()],
    channelReach,
    kind: "read",
    newestIso: corpusReach({ channelReach, pooled: readWatermark({ home, source: "slack" }) }),
    trail,
    unparsed,
  };
}

/**
 * Whether a live hit lands inside the window.
 *
 * @param match the hit
 * @param sinceIso the oldest message that counts
 * @param nowIso the newest message that counts
 * @returns true when its instant is known and inside the window
 */
function inWindow({ match, sinceIso, nowIso }: { match: SlackSearchMatch; sinceIso: string; nowIso: string }): boolean {
  return match.tsIso !== "" && match.tsIso >= sinceIso && match.tsIso <= nowIso;
}

/**
 * A live hit's text with each mention run named, so a quote reads `@Alex` rather than a raw id.
 *
 * @param text the hit's raw text
 * @param author resolves each mentioned id
 * @returns the text with every `<@U…>` replaced by `@name`
 */
function namedMentions({ text, author }: { text: string; author: AuthorResolver }): string {
  return text.replaceAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_whole, id: string) => `@${author({ authorId: id }).name}`);
}

/**
 * The live hits that are tags of them, as candidates.
 *
 * @param matches every hit the tag search returned
 * @param ownerId their own Slack id
 * @param sinceIso the oldest message that counts
 * @param nowIso the newest message that counts
 * @param author resolves each tag's author
 * @returns the candidates, one per message, and how many messages the hits named no author for
 */
export function liveCandidatesOf({
  matches,
  ownerId,
  sinceIso,
  nowIso,
  author,
}: {
  matches: readonly SlackSearchMatch[];
  ownerId: string;
  sinceIso: string;
  nowIso: string;
  author: AuthorResolver;
}): { readonly candidates: readonly TaggedCandidate[]; readonly authorless: number } {
  const candidates = new Map<string, TaggedCandidate>();
  const authorless = new Set<string>();
  for (const match of matches) {
    const messageKey = `${match.channelId}:${match.ts}`;
    const tagsTheOwner = mentionRunsIn({ text: match.text }).some((run) => run.id === ownerId);
    if (
      !inWindow({ match, nowIso, sinceIso }) ||
      match.userId === ownerId ||
      !tagsTheOwner ||
      candidates.has(messageKey)
    ) {
      continue;
    }
    if (match.userId === "") {
      authorless.add(messageKey);
      continue;
    }
    const facts = author({ authorId: match.userId });
    candidates.set(messageKey, {
      authorId: match.userId,
      authorIsHuman: facts.isHuman,
      authorKnown: facts.known,
      authorName: facts.name,
      channelId: match.channelId,
      channelName: match.channelName,
      messageKey,
      ownTs: Number(match.ts),
      permalink: match.permalink,
      text: quoteOf({ text: namedMentions({ author, text: match.text }) }),
      threadKey: liveThreadKey({ channelId: match.channelId, permalink: match.permalink, ts: match.ts }),
      tsIso: match.tsIso,
    });
  }
  return { authorless: authorless.size, candidates: [...candidates.values()] };
}

/**
 * Their own live hits as a trail, so a tag they answered inside the corpus's lag reads as answered.
 *
 * @param matches every hit the `from:` search returned
 * @param ownerId their own Slack id
 * @param nowIso the newest message that counts
 * @returns the trail
 */
export function liveTrailOf({
  matches,
  ownerId,
  nowIso,
}: {
  matches: readonly SlackSearchMatch[];
  ownerId: string;
  nowIso: string;
}): OwnerTrail {
  const trail: TrailBuilder = { byDm: new Map(), byThread: new Map() };
  for (const match of matches) {
    if (match.userId !== ownerId || match.tsIso === "" || match.tsIso > nowIso) {
      continue;
    }
    recordOwnerWord({
      channelId: match.channelId,
      ownTs: Number(match.ts),
      threadKey: liveThreadKey({ channelId: match.channelId, permalink: match.permalink, ts: match.ts }),
      trail,
    });
  }
  return trail;
}

/**
 * The day `after:` must name for a search to include the window's first day — `after:` excludes the date it
 * names, the convention `./repeatsRead.ts` measured.
 *
 * @param sinceIso the window's start
 * @returns a `YYYY-MM-DD` date one day before it
 */
export function afterDateOf({ sinceIso }: { sinceIso: string }): string {
  return new Date(Date.parse(sinceIso) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * The live leg: a tag search and a search for their own replies, both paged to a bound.
 *
 * @param search the live search seam, on their user token
 * @param ownerId their own Slack id
 * @param sinceIso the oldest message that counts
 * @param nowIso the newest message that counts
 * @param author resolves each tag's author
 * @returns the leg, naming every search that stopped short
 */
export async function readTaggedLive({
  search,
  ownerId,
  sinceIso,
  nowIso,
  author,
}: {
  search: SlackSearchMessages;
  ownerId: string;
  sinceIso: string;
  nowIso: string;
  author: AuthorResolver;
}): Promise<TaggedLiveLeg> {
  const after = afterDateOf({ sinceIso });
  const read = async ({ query }: { query: string }): ReturnType<typeof searchAllPages> =>
    searchAllPages({ count: SEARCH_PAGE_SIZE, maxPages: SEARCH_MAX_PAGES, query, search });
  const tags = await read({ query: `<@${ownerId}> after:${after}` });
  const sent = await read({ query: `from:<@${ownerId}> after:${after}` });
  const incomplete = [tags.receipt, sent.receipt]
    .filter((receipt) => !receipt.complete)
    .map((receipt) => `${receipt.query}: ${receipt.stoppedBecause}`);
  const found = liveCandidatesOf({ author, matches: tags.matches, nowIso, ownerId, sinceIso });
  return {
    authorless: found.authorless,
    candidates: found.candidates,
    incomplete,
    kind: "read",
    trail: liveTrailOf({ matches: sent.matches, nowIso, ownerId }),
  };
}
