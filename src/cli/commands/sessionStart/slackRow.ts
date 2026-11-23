/**
 * ONE BRONZE LINE, read into the handful of fields the Slack leg actually needs.
 *
 * Split out of `./slackRead` because it is a different job from scanning a corpus: everything here is pure
 * string and record work over a single line, with no filesystem, no home and no clock, and it is what the
 * scan's two passes call on every line that survives their prefilter.
 *
 * ## Three fields are taken from `sourceId` rather than from `raw`, and that is the redaction trap
 *
 * Bronze `raw.ts` and `raw.thread_ts` have their integer seconds replaced by a `[number]` placeholder, so a
 * thread key or an ordering timestamp rebuilt from those fields is only the six-digit fraction — it works,
 * and it collides. The record's own `sourceId` carries the real `channel:ts` and is what these read instead.
 *
 * ## The projected text is not the authored text, and treating them as one was a live defect
 *
 * The ingest resolves a Slack mention run to a display name, so `text` carries `@Ada Owner` where
 * `raw.text` carries `<@U…>`. MEASURED over four bronze files: 170 records carry the owner's
 * mention token in `raw.text` and ZERO carry it in `text`. {@link SlackRow.authoredText} is therefore a
 * field of its own rather than an alias, and {@link tagsOwner} is the only place a mention is tested.
 *
 * Pure — no I/O, no clock.
 */

import { parseJsonObject } from "../../../lib/jsonParse.js";
import { isRecord } from "../../../lib/parsers.js";
import type { PrLinkRef } from "../../../review/prLink.js";
import { authoredTextOf, findPrLinks, mentionRunsIn, slackHaystack } from "../../../review/prLink.js";

/**
 * One Slack bronze record, reduced to the fields this leg reads.
 *
 * {@link SlackRow.authoredText} and {@link SlackRow.pullRequests} are DERIVED at parse time rather than
 * the `raw` payload being retained, and that is deliberate: a held row would otherwise pin a whole Slack
 * payload — blocks, attachments, every reaction — for as long as its thread stays a candidate, which is
 * the one place this scan could grow badly over a multi-gigabyte corpus.
 */
export interface SlackRow {
  readonly sourceId: string;
  /** The message's OWN Slack timestamp, which is what orders a thread. See {@link isLaterThan}. */
  readonly ownTs: number;
  readonly author: string;
  readonly tsIso: string;
  readonly url: string;
  readonly text: string;
  readonly channelName: string | undefined;
  /**
   * The author's own words — `raw.text` where the record kept one, the projection otherwise.
   *
   * The projected {@link SlackRow.text} is NOT interchangeable with this, which is the defect that made
   * {@link threadsOf}'s mention test dead code. MEASURED over four bronze files: 170 records
   * carry the owner's mention token in `raw.text` and ZERO carry it in the projected `text`, because the
   * ingest resolves a mention run to a display name. Reproduce with
   * `grep '<@OWNER>' "$SLOPWEAVER_HOME"/corpus/bronze/slack/2026-09-13_2026-09-14.jsonl | jq -r 'select(.text|test("<@OWNER>")).sourceId' | wc -l`.
   */
  readonly authoredText: string;
  /**
   * Every pull request the record links, found across the WHOLE payload rather than the authored half.
   *
   * Discovery is the right mode here for `../../../review/prLink`'s own measured reason — 29.8% of linking
   * Slack records carry the URL only in `raw` — and it is safe because these numbers are used to RE-READ a
   * pull request live, never to attribute anything to the author.
   */
  readonly pullRequests: readonly PrLinkRef[];
  /** Everybody who ANSWERED the message with a reaction, each once — see {@link ANSWERING_REACTIONS}. */
  readonly answeringReactorIds: readonly string[];
}

/**
 * The reactions that answer an ask: a tick, a thumbs-up, an OK. MEASURED on the Slack bronze,
 * other people's reactions on the owner's messages were eyes ×2, joy ×2, sweat_smile ×2, pray ×1 and +1 ×1 — so "any
 * reaction" read a 👀 on the owner's question as its answer. A skin tone is read off first.
 */
const ANSWERING_REACTIONS: ReadonlySet<string> = new Set([
  "+1",
  "ballot_box_with_check",
  "heavy_check_mark",
  "ok",
  "ok_hand",
  "thumbsup",
  "white_check_mark",
]);

/**
 * The ids an answering reaction's `users` names, each once, in the order Slack lists them.
 *
 * @param raw the record's raw Slack payload, whatever it holds
 * @returns the reactors, empty when the payload carries no answering reaction
 */
function answeringReactorIdsOf({ raw }: { raw: unknown }): readonly string[] {
  if (!isRecord(raw) || !Array.isArray(raw["reactions"])) {
    return [];
  }
  const ids = new Set<string>();
  for (const reaction of raw["reactions"]) {
    if (!isRecord(reaction) || typeof reaction["name"] !== "string") {
      continue;
    }
    const users = reaction["users"];
    if (!ANSWERING_REACTIONS.has(reaction["name"].split("::")[0]!) || !Array.isArray(users)) {
      continue;
    }
    for (const user of users) {
      if (typeof user === "string") {
        ids.add(user);
      }
    }
  }
  return [...ids];
}

/** A Slack `ts`: seconds, a point, then its sequence digits — a huddle, pin or canvas id holds something else there. */
const SLACK_TS = /^\d+\.\d+$/;

/**
 * The `channel:ts` a `sourceId` names, which is a thread's real key.
 *
 * A reply's id is `channel:parentTs:reply:ownTs` and a root message's is `channel:ownTs`, so the first two
 * segments identify the thread either way. MEASURED over the live Slack bronze (millions of lines, a
 * `JSON.parse` of each whose id fails this `ts`): all of the couple of thousand that fail are a huddle, pin, bookmark or canvas.
 *
 * @param sourceId the record's own id
 * @returns the key, or undefined when the id is not a channel and a Slack `ts`
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export function threadKeyOf({ sourceId }: { sourceId: string }): string | undefined {
  const parts = sourceId.split(":");
  const channel = parts[0];
  const ts = parts[1];
  if (channel === undefined || ts === undefined || channel.length === 0 || !SLACK_TS.test(ts)) {
    return undefined;
  }
  return `${channel}:${ts}`;
}

/**
 * The message's own Slack timestamp, taken from the last segment of its `sourceId`.
 *
 * A reply's id ends in its own `ts`; a root message's second segment IS its own `ts`. Either way the last
 * segment is the message's, which is the only field with enough precision to order a thread — see
 * {@link isLaterThan}.
 *
 * @param sourceId the record's own id
 * @returns the timestamp as a number, or `NaN` when the id carries no numeric tail
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export function ownTsOf({ sourceId }: { sourceId: string }): number {
  const parts = sourceId.split(":");
  // `split` on a non-empty separator always yields at least one element, so the tail is never absent.
  return Number(parts[parts.length - 1]!);
}

/**
 * Whether one message is later in its thread than another.
 *
 * **`tsIso` alone is not enough, and a unit case pins why.** Bronze stores `tsIso` at SECOND resolution
 * while Slack's own `ts` carries six more digits, so two messages seconds apart tie and the first one read
 * wins — which silently made a thread's last word its FIRST reply whenever a colleague answered inside the
 * same second the owner posted. Slack's own timestamp is the tiebreak because it is what Slack orders by; `tsIso`
 * stays the primary comparison because a `sourceId` from a future ingest shape might carry no numeric tail
 * at all.
 *
 * @param candidate the message being considered
 * @param held the latest message seen so far in the same thread
 * @returns whether the candidate is the later of the two
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export function isLaterThan({ candidate, held }: { candidate: SlackRow; held: SlackRow }): boolean {
  if (candidate.tsIso !== held.tsIso) {
    return candidate.tsIso > held.tsIso;
  }
  if (Number.isNaN(candidate.ownTs) || Number.isNaN(held.ownTs)) {
    return false;
  }
  return candidate.ownTs > held.ownTs;
}

/**
 * The `sourceId` a raw line carries, read by string scan rather than by parsing the line.
 *
 * **This is what makes the second pass affordable.** That pass has to look at EVERY line in the corpus,
 * and `JSON.parse` on a Slack bronze record is the expensive part — each one carries a whole `raw` payload
 * with blocks, attachments and reaction lists that this leg never reads. Extracting the one field that
 * decides whether a line matters costs a substring search, and a line whose thread is not in the candidate
 * set is then dropped without ever being parsed.
 *
 * @param line the raw JSONL line
 * @returns the `sourceId` value, or undefined when the line does not carry one
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export function rawSourceId({ line }: { line: string }): string | undefined {
  const at = line.indexOf('"sourceId":"');
  if (at < 0) {
    return undefined;
  }
  const from = at + '"sourceId":"'.length;
  const to = line.indexOf('"', from);
  return to < 0 ? undefined : line.slice(from, to);
}

/**
 * Whether a value is a real UTC ISO instant, the only shape `isLaterThan` may order by string comparison. A row
 * whose `tsIso` is any other string is refused, so a reader counts it as unreadable rather than letting a
 * nonsense stamp sort after every real reply.
 */
function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return false;
  }
  // The shape alone admits 9999-99-99T99:99:99Z; a real instant round-trips to the same second.
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

/**
 * Read one bronze line into the fields this leg needs, or refuse it.
 *
 * A line that will not parse is skipped rather than counted, the same contract every other bronze reader
 * keeps: one malformed record never aborts a scan over millions of good ones.
 *
 * @param line the raw JSONL line
 * @returns the row, or undefined when it is not a usable Slack record or is a reply's channel copy
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export function slackRowOf({ line }: { line: string }): SlackRow | undefined {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return undefined;
  }
  const fields = parsed.value;
  const attrs = fields["attrs"];
  const channel = isRecord(attrs) ? attrs["channel"] : undefined;
  const sourceId = fields["sourceId"];
  const author = fields["author"];
  const tsIso = fields["tsIso"];
  const url = fields["url"];
  if (!isMessageKind({ kind: fields["kind"] }) || typeof sourceId !== "string" || typeof author !== "string") {
    return undefined;
  }
  if (isBroadcastCopy({ record: fields })) {
    return undefined;
  }
  if (!isIsoInstant(tsIso)) {
    return undefined;
  }
  const text = typeof fields["text"] === "string" ? fields["text"] : "";
  const record = { raw: fields["raw"], text };
  return {
    author,
    authoredText: authoredTextOf({ record }),
    channelName: typeof channel === "string" ? channel : undefined,
    ownTs: ownTsOf({ sourceId }),
    pullRequests: findPrLinks({ haystack: slackHaystack({ record }) }),
    answeringReactorIds: answeringReactorIdsOf({ raw: fields["raw"] }),
    sourceId,
    text,
    tsIso,
    url: typeof url === "string" ? url : "",
  };
}

/**
 * Whether one message structurally tagged the owner.
 *
 * A literal `@handle` typed into prose is inert — it pings nobody — so only a mention RUN counts, which is
 * the distinction `../../../review/prLink.mentionRunsIn` already draws. Read over the AUTHORED text rather
 * than the whole payload, for that module's own attribution reason: an unfurled attachment quoting a
 * mention of the owner is not somebody tagging the owner.
 *
 * @param row the parsed record
 * @param ownerId the owner's own Slack id
 * @returns whether the author addressed the owner by name
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export function tagsOwner({ row, ownerId }: { row: SlackRow; ownerId: string }): boolean {
  return tagsUser({ row, userId: ownerId });
}

/**
 * Whether one message structurally tagged one given person, by {@link tagsOwner}'s rule.
 *
 * @param row the parsed record
 * @param userId the Slack id whose mention run to look for
 * @returns whether the author tagged that person
 */
export function tagsUser({ row, userId }: { row: SlackRow; userId: string }): boolean {
  return mentionRunsIn({ text: row.authoredText }).some((run) => run.id === userId);
}

/** The broadcast tokens that aim a message at the whole room rather than at whoever started the thread. */
const ROOM_BROADCAST = /<!(?:here|channel|everyone)\b/;

/**
 * Whether one message structurally names anybody at all — a person, a user group, or the room.
 *
 * The test that keeps an unaddressed question in the owner's own thread from reading as somebody else's ask: a `?`
 * naming a colleague is aimed at that colleague, and one naming nobody, under a root of the owner's, is aimed at the owner.
 * Read over the AUTHORED text for {@link tagsOwner}'s reason.
 *
 * @param row the parsed record
 * @returns whether the author tagged anybody, the owner included
 */
export function namesAnybody({ row }: { row: SlackRow }): boolean {
  return mentionRunsIn({ text: row.authoredText }).length > 0 || ROOM_BROADCAST.test(row.authoredText);
}

/** Whether an authorless record is recognisably not a person's message: not a message at all, or a bot's. */
function isNobodysWord({ record }: { record: Record<string, unknown> }): boolean {
  const kind = record["kind"];
  if (kind !== "comment" && kind !== "message") {
    return true;
  }
  const raw = record["raw"];
  return isRecord(raw) && typeof raw["bot_id"] === "string" && raw["bot_id"].length > 0;
}

/**
 * Whether a record is the channel copy of a reply sent "also to the channel". Slack stores that reply twice — in
 * its thread, and top-level under its own `ts` — and {@link threadKeyOf} would read the top-level copy as a thread
 * of its own holding one message, so the owner's broadcast reply read as an ask nobody answered while the real thread held
 * the answer (`../../../corpus/slack/threadOracle.ts` measured the same
 * phantom). The reply copy is read in its real thread, so this copy is nobody's missing word either. Every reader
 * of this file drops it, so `slack owed` and `session-start` lost the same phantom, a tag the owner had already answered.
 */
function isBroadcastCopy({ record }: { record: Record<string, unknown> }): boolean {
  const raw = record["raw"];
  return record["kind"] === "message" && isRecord(raw) && raw["subtype"] === "thread_broadcast";
}

/**
 * A message's own identity, `channel:ownTs`, which both copies of a broadcast reply share while their `sourceId`s
 * differ (`C:rootTs:reply:ts` and `C:ts`). The redacted `raw.thread_ts` cannot name the parent, so this is the join.
 *
 * @param sourceId either copy's id
 * @returns the channel and the last segment, the message's own `ts`
 */
export function messageKeyOf({ sourceId }: { sourceId: string }): string {
  const parts = sourceId.split(":");
  return `${parts[0]!}:${parts.at(-1)!}`;
}

/**
 * The answering reactors on a reply's CHANNEL copy, which {@link slackRowOf} drops. A thread reply is fetched once
 * and never re-read, while channel history is re-read every window, so a tick added later may sit only here.
 *
 * @param line the raw JSONL line
 * @returns the copy's {@link messageKeyOf} and its reactors, or undefined for any other line or a copy nobody ticked
 */
export function broadcastReactorsOf({
  line,
}: {
  line: string;
}): { readonly messageKey: string; readonly reactorIds: readonly string[] } | undefined {
  if (!line.includes('"thread_broadcast"')) {
    return undefined;
  }
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr() || !isBroadcastCopy({ record: parsed.value })) {
    return undefined;
  }
  const sourceId = parsed.value["sourceId"];
  const reactorIds = answeringReactorIdsOf({ raw: parsed.value["raw"] });
  if (typeof sourceId !== "string" || reactorIds.length === 0) {
    return undefined;
  }
  return { messageKey: messageKeyOf({ sourceId }), reactorIds };
}

/**
 * Whether a record kind is one somebody replies in — a huddle, pin, bookmark or canvas is nobody's reply.
 *
 * @param kind the record's own `kind` field, whatever it holds
 * @returns true for a comment or a message
 */
function isMessageKind({ kind }: { kind: unknown }): boolean {
  return kind === "comment" || kind === "message";
}

/**
 * Whether a line that is not a usable message could be a person's word this read is missing.
 *
 * Only such a line is counted as unparsed. A record with no author that is not a message — a file share, a
 * huddle, a canvas — or that is a BOT's message (`raw.bot_id`) is nobody's reply, and MEASURED on
 * the live corpus (`slopweaver slack owed --json`) a few thousand of them carry the owner's id, so counting them read every scan
 * as incomplete. An authorless `comment` or `message` with no bot id could be a person's reply with its author
 * lost, so it IS counted; the same measurement found none (`cat $SLOPWEAVER_HOME/corpus/bronze/slack/*.jsonl |
 * grep -v '"author"'`, then group by `kind` and `raw.bot_id`: all of the over a hundred thousand authorless messages carry a bot id).
 * A line of another thread is none of this read's business. A line that is not even JSON is counted.
 *
 * @param line the raw JSONL line
 * @param keys the threads pass one found, or undefined in pass one, where any thread qualifies
 * @returns true for a line that is not JSON, or a record carrying an author field in a qualifying thread or
 *   naming none
 */
export function unreadableWord({ line, keys }: { line: string; keys: ReadonlySet<string> | undefined }): boolean {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return true;
  }
  const kind = parsed.value["kind"];
  if ((typeof kind === "string" && !isMessageKind({ kind })) || isBroadcastCopy({ record: parsed.value })) {
    return false;
  }
  // An author field that is there but not a string is a malformed message, which could be the reply this read
  // is missing; no author field at all is nobody's word only when the record says whose it is not.
  if (!("author" in parsed.value) && isNobodysWord({ record: parsed.value })) {
    return false;
  }
  const sourceId = parsed.value["sourceId"];
  if (keys === undefined || typeof sourceId !== "string") {
    return true;
  }
  const key = threadKeyOf({ sourceId });
  // An id naming no thread cannot rule a followed thread out.
  return key === undefined || keys.has(key);
}

/**
 * What the substring fast path may say about a line's `sourceId`, and only what it may say EXACTLY.
 *
 * `JSON.stringify` writes the corpus, so nearly every line spells its key one way, once, unescaped. A line
 * that does not — whitespace after the colon, a key or value carrying a `\u` escape or any backslash, the key
 * twice (`JSON.parse` keeps the last) — is `parse`, read whole, never dropped: a reply skipped here would
 * leave the owner's own word looking like the thread's last. `absent` needs the key to be unspellable on that line,
 * which without a `\u` escape means the literal `"sourceId"` is missing. MEASURED over the live
 * Slack bronze (`cat $SLOPWEAVER_HOME/corpus/bronze/slack/*.jsonl | grep -c '\\u'`): thousands of the
 * millions of lines carry a `\u`, so the lines this parses whole cost nothing that matters.
 *
 * @param line the raw JSONL line
 * @returns the id when the fast read is exact, `parse` when only a whole read can tell, `absent` when no
 *   spelling of the key is on the line
 */
function fastSourceId({
  line,
}: {
  line: string;
}): { kind: "exact"; sourceId: string } | { kind: "parse" } | { kind: "absent" } {
  const escaped = line.includes("\\u");
  const first = line.indexOf('"sourceId"');
  if (first < 0 && !escaped) {
    return { kind: "absent" };
  }
  const once = first >= 0 && line.indexOf('"sourceId"', first + 1) < 0;
  const sourceId = rawSourceId({ line });
  if (!escaped && once && sourceId !== undefined && !sourceId.includes("\\")) {
    return { kind: "exact", sourceId };
  }
  return { kind: "parse" };
}

/**
 * Whether a line may be a message in one of `keys`' threads — pass two's cheap filter, which answers false
 * only for a blank line or when {@link fastSourceId} reads one exact unwatched thread. Everything else is parsed
 * whole: an id naming no thread, and a line with no id at all, which is a reply this read could not place.
 * MEASURED: none of the millions of live Slack bronze lines lacks `"sourceId"`
 * (`cat $SLOPWEAVER_HOME/corpus/bronze/slack/*.jsonl | grep -vc '"sourceId"'`), so parsing them costs nothing.
 *
 * @param line the raw JSONL line
 * @param keys the threads the read follows
 * @returns false only for a line that provably belongs to no followed thread
 */
export function mayBelongTo({ line, keys }: { line: string; keys: ReadonlySet<string> }): boolean {
  const fast = fastSourceId({ line });
  if (fast.kind === "absent") {
    return line.trim().length > 0;
  }
  if (fast.kind === "parse") {
    return true;
  }
  const key = threadKeyOf({ sourceId: fast.sourceId });
  // An id naming no thread cannot rule the line out: it is parsed, and a message there is a reply this read lost.
  return key === undefined || keys.has(key);
}
