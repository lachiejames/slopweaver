/**
 * The Slack half of an `around` read: where a Slack row sits, the thread it is in, and the channel around it.
 *
 * Its own module rather than a section of `./disclose.ts` because every query here keys on the layout of a
 * Slack `source_id`, which no other source shares. `runAround` in `./disclose.ts` picks the band and builds
 * the page; what the read is for, and why none of it re-applies the search term, is that module's header.
 */

import { type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreReader } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { HEAD_COLUMNS, HEAD_JOINS, MAX_PEEK_CHARS, peekOf, type RecordPeek } from "./head.js";
import { numberOf, optionalText, requireText } from "./rows.js";

/**
 * Slack's own thread key for a row, read off the id the redactor never touches.
 *
 * ## Why this is not `content_slack.thread_ts`, which is the column for it
 *
 * `redactRecord.ts`'s `redactRecord` scrubs a record's `text`, `title`, `attrs` and `raw`, and
 * `redactText`'s `\d{9,}` pass rewrites any long digit run as `[number]` — so a Slack `ts`, whose epoch
 * half is ten digits, arrives in the store as `[number].857509`. `store/project.ts` promotes `messageTs`
 * and `threadTs` out of those scrubbed bags, so both columns carry the microsecond tail and nothing else.
 * MEASURED on the live store (1,219,817 rows, 709,059 Slack):
 *
 * ```sql
 * select count(*) filter (where position('[' in message_ts) > 0),
 *        count(*) filter (where message_ts ~ '^[0-9]+[.][0-9]+$'), count(*) from content_slack;
 * -- 662438 | 0 | 709059      -- 93.4% carved up, none intact
 * ```
 *
 * Joining a thread on the carved-up key groups by a six-digit tail, so two unrelated threads in one
 * channel whose roots share a tail are printed as ONE conversation with nothing marking it: **6,343 of
 * 230,704 thread keys merge two or more genuinely different threads, the worst merging eight, and 59,303
 * rows — 9.0% of the message+comment rows — sit in a merged group.** Reproduce with the `true_key` query
 * in `docs/store/thread-relations-and-detective-reads.md` § "The redacted Slack timestamp".
 *
 * `sourceId`, `url` and `container` are the three fields `redactRecord` never passes through a pass, and
 * `corpus/slack/project.ts` builds a reply's id as `<channel>:<threadTs>:reply:<replyTs>` and a top-level
 * message's as `<channel>:<messageTs>`. So part two is the thread's root timestamp either way — for a
 * reply it is its thread's, for a root it is its own, which IS its thread's. That is one expression rather
 * than a branch on kind, and it reads like a coincidence only because the id layout was chosen to make it
 * true. Verified intact on 426,196 of 426,196 replies and 236,160 of 236,160 messages.
 */
const SLACK_THREAD_TS: SQL = sql`split_part(content.source_id, ':', 2)`;

/**
 * The row's OWN Slack timestamp — a reply's own, never its thread's.
 *
 * The two layouts put it in different fields, which is the one place the id's shape does have to be
 * branched on. It is the channel walk's sort key and the thread's, because it is Slack's own total order
 * at microsecond resolution: `content.occurred_at` is second-resolution for Slack and 46,863
 * `(container_id, occurred_at)` pairs in this store hold more than one row, so ordering on it leaves the
 * tie to be broken by a random uuid.
 *
 * It sorts correctly as TEXT because the format is fixed-width `[0-9]{10}.[0-9]{6}`; it is never parsed
 * into a number, because a `ts` is an identity and a float would round its low digits away.
 */
const SLACK_MESSAGE_TS: SQL = sql`
  case when content.kind = 'comment' then split_part(content.source_id, ':', 4)
       else split_part(content.source_id, ':', 2) end
`;

/**
 * One top-level channel message beside the anchor's thread, carrying the affordance Slack itself shows.
 *
 * `replyCount` is what makes scrolling out of a thread useful rather than merely possible: a person
 * scanning a channel sees "7 replies" under a message and that is how a nearby conversation on the same
 * topic announces itself. Reading the number here costs nothing — it is already a promoted column.
 */
export interface ChannelNeighbour extends RecordPeek {
  /** How many replies Slack says this message has, from `content_slack.reply_count`. */
  readonly replyCount: number;
  /** Whether this is the root of the thread the anchor sits in — the row a reader scrolled out to. */
  readonly isAnchorThread: boolean;
}

/** Where one Slack row sits: its channel's container, its thread's root, and its own instant. */
export interface SlackAnchor {
  readonly containerId: string;
  readonly channelId: string;
  readonly threadTs: string;
  readonly messageTs: string;
}

/** A Slack timestamp as Slack writes it, used to tell a real one from a `pin`/`file` id's second field. */
const CLEAN_TS = /^[0-9]{10}\.[0-9]{6}$/;

/**
 * Resolve a Slack address to the one row it names.
 *
 * A caller pasting `<channel>:<ts>` may mean a top-level message, whose `source_id` is exactly that, or a
 * REPLY, whose `source_id` is `<channel>:<thread>:reply:<ts>` and therefore does not equal what was typed.
 * Both are looked for, and the channel narrows the scan either way.
 *
 * ## Why the tie is broken on the EXACT id and never on the kind
 *
 * The second disjunct is deliberately loose, and a `file` row's id is `<channel>:<ts>:file:<id>` sharing
 * the timestamp of the message that carried the attachment — so a message and its file both match. Sorting
 * that tie by `content.kind` resolves it alphabetically, and `file` sorts BEFORE `message`, which would
 * hand back the attachment every time a caller pasted the id of a message with one. The exact-id match is
 * the one that cannot be a near miss, so it wins; only when nothing matched exactly does the loose arm
 * decide, and there the reply layout is the only other id whose ts field can equal what was typed.
 *
 * @param reader anything a read can run against
 * @param channelId the conversation the message is in
 * @param messageTs the message's own timestamp
 * @returns the row's id, or `null` when the store holds no such message
 */
export async function resolveSlackAddress({
  reader,
  channelId,
  messageTs,
}: {
  reader: StoreReader;
  channelId: string;
  messageTs: string;
}): Promise<string | null> {
  const rows = await reader.db.execute(sql`
    select content.id::text as id
    from content_slack
    join content on content.id = content_slack.content_id
    where content_slack.channel_id = ${channelId}
      and (content.source_id = ${`${channelId}:${messageTs}`} or ${SLACK_MESSAGE_TS} = ${messageTs})
    order by (content.source_id = ${`${channelId}:${messageTs}`}) desc, content.source_id asc
    limit 1
  `);
  const row = [...rows][0];
  return row === undefined ? null : requireText({ key: "id", row });
}

/**
 * Where a row sits in Slack, when it is a Slack row whose id carries real coordinates.
 *
 * Returns nothing for a Slack row whose id is not one of the two message layouts — a `pin` is
 * `<channel>:pin:<ts>` and a `file` is `<channel>:<ts>:file:<id>`, so part two is not always a timestamp
 * and a caller must not be handed one that is not.
 *
 * @param reader anything a read can run against
 * @param id the anchor's own row id
 * @returns the anchor's Slack coordinates, or nothing when it has none
 */
export async function slackAnchorOf({ reader, id }: { reader: StoreReader; id: string }): Promise<SlackAnchor | null> {
  const rows = await reader.db.execute(sql`
    select content_slack.channel_id as "channelId",
      content.container_id::text as "containerId",
      ${SLACK_THREAD_TS} as "threadTs",
      ${SLACK_MESSAGE_TS} as "messageTs"
    from content
    join content_slack on content_slack.content_id = content.id
    where content.id = ${id}::uuid
  `);
  const row = [...rows][0];
  if (row === undefined) {
    return null;
  }
  const containerId = optionalText({ key: "containerId", row });
  const threadTs = requireText({ key: "threadTs", row });
  const messageTs = requireText({ key: "messageTs", row });
  if (containerId === null || !CLEAN_TS.test(threadTs) || !CLEAN_TS.test(messageTs)) {
    return null;
  }
  return { channelId: requireText({ key: "channelId", row }), containerId, messageTs, threadTs };
}

/**
 * Every message in one Slack thread, oldest first, keyed on the id rather than on the redacted column.
 *
 * MEASURED on the busiest channel in the store (53,597 rows of 1,219,817): **81 ms**, on
 * `idx_content_container_time` rather than a sequential scan, returning the thread's real 174 rows.
 * Reproduce:
 *
 * ```sql
 * explain (analyze, buffers) select content.id from content
 *  where content.container_id = '<the channel>'::uuid
 *    and split_part(content.source_id, ':', 2) = '<the thread root ts>';
 * ```
 *
 * The container narrows and the id expression corrects, which is the same division of labour the trigram
 * indexes on `content` are declared for. An expression index over `split_part` would turn the correcting
 * filter into a seek too; that is a schema change and its own row, not a thing to do inside this read.
 *
 * `message` and `comment` are the two kinds a conversation is made of, and the filter is the same
 * reasoning {@link channelWindow} carries: a `file` row's id is `<channel>:<ts>:file:<id>`, sharing part
 * two with the message that carried the attachment, so admitting it prints that message twice — once as
 * itself and once as `File: F060ULJ6YU8`. MEASURED on `C0SYN000035:1696638100.198249`, which is one of
 * many. A `pin` and a `canvas` are excluded by the key itself rather than by this filter, since neither
 * id's second field is a timestamp at all.
 *
 * @param reader anything a read can run against
 * @param slack where the anchor sits in Slack
 * @param chars how much of each body to show
 * @returns the thread, or the store's own typed failure
 */
export async function threadWindow({
  reader,
  slack,
  chars,
}: {
  reader: StoreReader;
  slack: SlackAnchor;
  chars: number;
}): Promise<Result<readonly RecordPeek[], StoreError>> {
  try {
    const rows = await reader.db.execute(sql`
      select ${HEAD_COLUMNS},
        1 as "from",
        length(content.body) as "bodyChars",
        substring(content.body from 1 for ${Math.min(chars, MAX_PEEK_CHARS)}) as excerpt
      from content
      ${HEAD_JOINS}
      where content.container_id = ${slack.containerId}::uuid
        and content.kind in ('message', 'comment')
        and ${SLACK_THREAD_TS} = ${slack.threadTs}
      order by ${SLACK_MESSAGE_TS} asc
    `);
    return ok([...rows].map((row) => peekOf({ row })));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store around (thread)" }));
  }
}

/**
 * The TOP-LEVEL channel messages before and after the anchor's thread, oldest first.
 *
 * This is the half that makes the read what a person sees. A channel in Slack is a list of top-level
 * messages, each with a reply count; the replies live behind them rather than beside them. So a reply is
 * never a neighbour here, and the window is centred on the anchor's THREAD ROOT rather than on the
 * anchor — scrolling out of a thread lands you where the thread hangs, which for a reply written days
 * after its root is a different place entirely.
 *
 * ## Why `kind = 'message'` and not `kind <> 'comment'`
 *
 * The other Slack kinds are not channel posts and two of them do not even carry a timestamp where a
 * message does. `corpus/slack/project.ts` writes a canvas as `canvas:<id>` and a pin as
 * `<channel>:pin:<ts>`, so {@link SLACK_MESSAGE_TS} reads `F0B6FPQVB6Y` and `pin` out of their second
 * field — which then sorts AFTER every real timestamp, because it is not a number. MEASURED before this
 * filter existed: a canvas last touched in May was printed as the newest message in a September channel.
 * A `file` row is the other half: it is the SAME post as the message that carried the attachment, sharing
 * its timestamp, so admitting it prints every image twice. One criterion removes both, and it is the
 * literal reading of what was asked for — the surrounding top-level channel messages.
 *
 * The keyset is Slack's own timestamp rather than `(occurred_at, id)`: see {@link SLACK_MESSAGE_TS} for
 * the 46,863 same-second pairs that make `occurred_at` a partial order here.
 *
 * @param reader anything a read can run against
 * @param slack where the anchor sits in Slack
 * @param before how many messages before the thread root
 * @param after how many after it
 * @param chars how much of each body to show
 * @returns the window, oldest first, or the store's own typed failure
 */
export async function channelWindow({
  reader,
  slack,
  before,
  after,
  chars,
}: {
  reader: StoreReader;
  slack: SlackAnchor;
  before: number;
  after: number;
  chars: number;
}): Promise<Result<readonly ChannelNeighbour[], StoreError>> {
  const width = Math.min(chars, MAX_PEEK_CHARS);
  try {
    const rows = await reader.db.execute(sql`
      with top_level as (
        select content.id, ${SLACK_MESSAGE_TS} as ts
        from content
        where content.container_id = ${slack.containerId}::uuid and content.kind = 'message'
      ),
      window_rows as (
        (select id from top_level where ts <= ${slack.threadTs} order by ts desc limit ${before + 1})
        union all
        (select id from top_level where ts > ${slack.threadTs} order by ts asc limit ${after})
      )
      select ${HEAD_COLUMNS},
        1 as "from",
        length(content.body) as "bodyChars",
        substring(content.body from 1 for ${width}) as excerpt,
        coalesce(content_slack.reply_count, 0) as "replyCount",
        (${SLACK_MESSAGE_TS} = ${slack.threadTs}) as "isAnchorThread"
      from content
      join window_rows on window_rows.id = content.id
      left join content_slack on content_slack.content_id = content.id
      ${HEAD_JOINS}
      order by ${SLACK_MESSAGE_TS} asc
    `);
    return ok(
      [...rows].map((row) => ({
        ...peekOf({ row }),
        isAnchorThread: row["isAnchorThread"] === true,
        replyCount: numberOf({ key: "replyCount", row }),
      })),
    );
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store around (channel)" }));
  }
}
