/**
 * The rest of the disclosure ladder: enumerate a shape, peek at a record, open it whole, read around it.
 * `hits`, the one that still searches, lives in `./hits.ts`; the three reading rungs are here.
 *
 * A probe answers "how many, and where" and stops there deliberately. These four are what a detective
 * spends the answer on, in increasing order of what each one costs to read:
 *
 * | verb     | what it hands back                                       | when a detective reaches for it            |
 * | -------- | -------------------------------------------------------- | ------------------------------------------ |
 * | `hits`   | one page of a shape's records, as one line each           | a cell too wide for the probe to enumerate |
 * | `peek`   | a window CENTRED ON THE MATCH, not the head of the body  | deciding whether a record is worth opening |
 * | `open`   | the whole stored record                                   | a record that earned it                    |
 * | `around` | its neighbours in the same thread or container            | the hit was the lead, not the answer       |
 *
 * ## Two decisions here that the lap-two result turns on
 *
 * **`peek` centres the window on the match.** A fixed prefix is the failure mode it exists to avoid: a
 * Slack alert whose first 200 characters are a template header looks identical to every other alert, and
 * the one line that distinguishes it is 2 kB in. The test is whether a reader can judge the match: a search for the number 17,000
 * that lands on a support-tool notification is probably not about a pull request numbered 17,000, and the window has to cover
 * the match for that judgement to be possible at all.
 *
 * **`around` does NOT re-apply the keyword.** This is the whole reason the detective arm beat the ranked
 * arms in lap two: it found two live blockers that were in thread REPLIES, and no reply contained the
 * search term. A context read that keeps the search predicate returns the hit again and calls it context,
 * which looks like it worked and reaches nothing new. `aroundStatement` takes an anchor and a window and
 * has no term parameter at all, so the property is structural rather than remembered.
 *
 * **Only `hits` is human-only by default; `peek`, `open` and `around` show bots.** The bot filter sits
 * on the SEARCH rungs, the way Slack's own "exclude automations" is a search filter while
 * the channel still shows the bot's post. The three reading rungs are addressed by an id the detective
 * already chose, and `around` shows Slack the way a human sees it — a person scrolling a
 * thread sees the alert that started it, and a context window with it cut out would be the same
 * looks-like-context failure the paragraph above describes.
 */
import { sql } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreReader } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import type { SlackAddress } from "../slackIds.js";
import {
  type ChannelNeighbour,
  channelWindow,
  resolveSlackAddress,
  type SlackAnchor,
  slackAnchorOf,
  threadWindow,
} from "./aroundSlack.js";
import {
  HEAD_COLUMNS,
  HEAD_JOINS,
  headOf,
  idArray,
  MAX_PEEK_CHARS,
  peekOf,
  type RecordHead,
  type RecordOpen,
  type RecordPeek,
} from "./head.js";
import { numberOf, requireText } from "./rows.js";

export type { RecordOpen, RecordPeek } from "./head.js";

/** How much of a body a peek shows around the match when the caller names no width. */
export const DEFAULT_PEEK_CHARS = 320;

/**
 * A window of each named record's body, centred on the first occurrence of a term when one is given.
 *
 * The window is cut in SQL rather than by fetching the body and slicing it in TypeScript, so a 400 kB
 * Notion page costs the bytes of its window and not the bytes of the page. `position` returns 0 when the
 * term is absent, and `greatest(…, 1)` turns that into "start at the beginning" rather than an error —
 * a record selected by its TITLE legitimately has no occurrence in its body.
 *
 * @param reader anything a read can run against
 * @param ids the records to peek at
 * @param match the term to centre each window on, or nothing for the head of the body
 * @param chars how wide the window is
 * @returns one peek per record that exists, or the store's own typed failure
 */
export async function runPeek({
  reader,
  ids,
  match,
  chars,
}: {
  reader: StoreReader;
  ids: readonly string[];
  match: string | undefined;
  chars: number;
}): Promise<Result<readonly RecordPeek[], StoreError>> {
  const width = Math.min(chars, MAX_PEEK_CHARS);
  const centre = match === undefined ? sql`1` : sql`greatest(position(lower(${match}) in lower(content.body)), 1)`;
  const from = sql`greatest(${centre}::int - ${Math.floor(width / 2)}, 1)`;
  try {
    const rows = await reader.db.execute(sql`
      select ${HEAD_COLUMNS},
        ${from} as "from",
        length(content.body) as "bodyChars",
        substring(content.body from ${from} for ${width}) as excerpt
      from content ${HEAD_JOINS}
      where content.id = any(${idArray({ ids })})
      order by content.occurred_at desc
    `);
    return ok(
      [...rows].map((row) => ({
        ...headOf({ row }),
        bodyChars: numberOf({ key: "bodyChars", row }),
        excerpt: requireText({ key: "excerpt", row }),
        from: numberOf({ key: "from", row }),
      })),
    );
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store peek" }));
  }
}

/**
 * Each named record whole, with the URLs its text linked to.
 *
 * "Whole" means the whole STORED record, which is not the whole provider object: ingest keeps the text,
 * the identity and the cross-references and discards the rest of the payload. A caller that needs a
 * field the store never kept goes to the provider through its own door verb, and the difference is worth
 * stating in an answer rather than papering over.
 *
 * @param reader anything a read can run against
 * @param ids the records to open
 * @returns one record per id that exists, or the store's own typed failure
 */
export async function runOpen({
  reader,
  ids,
}: {
  reader: StoreReader;
  ids: readonly string[];
}): Promise<Result<readonly RecordOpen[], StoreError>> {
  try {
    const rows = await reader.db.execute(sql`
      select ${HEAD_COLUMNS},
        content.body as body,
        coalesce(content.metadata -> 'refs', '[]'::jsonb) as refs
      from content ${HEAD_JOINS}
      where content.id = any(${idArray({ ids })})
      order by content.occurred_at desc
    `);
    return ok(
      [...rows].map((row) => ({
        ...headOf({ row }),
        body: requireText({ key: "body", row }),
        refs: Array.isArray(row["refs"]) ? row["refs"].map((ref) => String(ref)) : [],
      })),
    );
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store open" }));
  }
}

/**
 * Which neighbourhood an `around` read walks.
 *
 * `conversation` is first because it is the DEFAULT, and it is the default because it is the only one of
 * the three that answers the question a person actually holds — see {@link runAround}.
 */
export const AROUND_MODES = ["conversation", "thread", "container"] as const;

/** One neighbourhood an `around` read walks. */
export type AroundMode = (typeof AROUND_MODES)[number];

/** An anchor, the conversation it sits in, and the channel around that conversation. */
export interface AroundPage {
  readonly anchor: RecordHead;
  /** Every record in the walked band, the anchor included, oldest first. */
  readonly records: readonly RecordPeek[];
  /**
   * The top-level channel messages before and after the anchor's thread, oldest first.
   *
   * Empty for every mode but `conversation`, and empty there when the anchor is not a Slack row. Kept as
   * its own band rather than merged into `records` because the two are different things to a reader —
   * merging them is exactly what `--mode container` does, and what makes it unreadable.
   */
  readonly channel: readonly ChannelNeighbour[];
  /** Which neighbourhood was walked, after falling back when the anchor had no thread. */
  readonly mode: AroundMode;
  /** What this read could NOT establish — an empty list when there is nothing to say. */
  readonly limitations: readonly string[];
}

/**
 * Read what was being said around one record.
 *
 * ## What `conversation` is for, and why it is the default
 *
 * One verb that, given a Slack message or reply id, shows it IN CONTEXT the way a
 * human sees Slack — the whole thread it sits in AND the surrounding top-level channel messages, so a
 * detective can scroll up and out of a thread and spot the nearby conversation on the same topic.
 *
 * Neither of the two older modes answers that. `thread` returns the thread and nothing of the channel, so
 * there is no out to scroll to. `container` walks the channel's rows in time order with no top-level
 * filter, so every other thread's replies are interleaved with the channel's own messages — a reading
 * order that exists nowhere in Slack. `conversation` is both bands, kept apart, and a strict superset of
 * `thread`, which is why promoting it to the default costs a caller nothing.
 *
 * Nothing here filters on the term that found the anchor; see this module's header for why that is the
 * load-bearing property rather than an omission.
 *
 * @param reader anything a read can run against
 * @param id the anchor record
 * @param mode both bands, the thread alone, or the whole container in time order
 * @param before how many top-level messages before the anchor's thread
 * @param after how many after it
 * @param chars how much of each neighbour's body to show
 * @returns the anchor and its neighbours, or the store's own typed failure
 */
export async function runAround({
  reader,
  id,
  mode,
  before,
  after,
  chars,
}: {
  reader: StoreReader;
  id: string;
  mode: AroundMode;
  before: number;
  after: number;
  chars: number;
}): Promise<Result<AroundPage, StoreError>> {
  try {
    const anchors = await runPeek({ chars, ids: [id], match: undefined, reader });
    if (anchors.isErr()) {
      return err(anchors.error);
    }
    const anchor = anchors.value[0];
    if (anchor === undefined) {
      return err(StoreErrors.queryFailed({ cause: new Error(`no record ${id}`), what: "store around" }));
    }
    if (mode === "container") {
      const records = await containerWindow({ after, anchor, before, chars, reader });
      return records.isErr()
        ? err(records.error)
        : ok({ anchor, channel: [], limitations: [], mode: "container", records: records.value });
    }
    const slack = await slackAnchorOf({ id: anchor.id, reader });
    if (slack === null) {
      const fallback = await containerWindow({ after, anchor, before, chars, reader });
      return fallback.isErr()
        ? err(fallback.error)
        : ok({
            anchor,
            channel: [],
            limitations: [
              "the anchor is not a Slack message or reply, so it has no thread — read its container in time order instead",
            ],
            mode: "container",
            records: fallback.value,
          });
    }
    return await slackConversation({ after, anchor, before, chars, mode, reader, slack });
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store around" }));
  }
}

/**
 * The Slack half: the anchor's whole thread, and for `conversation` the channel around that thread.
 *
 * @param reader anything a read can run against
 * @param anchor the record to centre on
 * @param slack where that record sits in Slack
 * @param mode whether the channel band is wanted
 * @param before how many top-level messages before the thread
 * @param after how many after it
 * @param chars how much of each body to show
 * @returns the page, or the store's own typed failure
 */
async function slackConversation({
  reader,
  anchor,
  slack,
  mode,
  before,
  after,
  chars,
}: {
  reader: StoreReader;
  anchor: RecordPeek;
  slack: SlackAnchor;
  mode: AroundMode;
  before: number;
  after: number;
  chars: number;
}): Promise<Result<AroundPage, StoreError>> {
  const thread = await threadWindow({ chars, reader, slack });
  if (thread.isErr()) {
    return err(thread.error);
  }
  const rootPresent = thread.value.some((record) => record.sourceId === `${slack.channelId}:${slack.threadTs}`);
  const ingested = [
    "a thread is read from what was ingested — a reply the sync has not reached yet is not here and nothing marks its absence",
  ];
  const rootMissing = rootPresent
    ? []
    : [
        "the message this thread opens with was never ingested — these replies are keyed to it by id, so the thread is real and its first message is absent",
      ];
  if (mode === "thread") {
    return ok({
      anchor,
      channel: [],
      limitations: [...ingested, ...rootMissing],
      mode: "thread",
      records: thread.value,
    });
  }
  const channel = await channelWindow({ after, before, chars, reader, slack });
  if (channel.isErr()) {
    return err(channel.error);
  }
  return ok({
    anchor,
    channel: channel.value,
    limitations: [
      ...ingested,
      ...rootMissing,
      "the channel band is top-level MESSAGES only — what a person scrolling this channel sees. Every other thread's replies, and this channel's files, canvases and pins, are one `--mode container` read away",
    ],
    mode: "conversation",
    records: thread.value,
  });
}

/**
 * The records immediately before and after an anchor in its own container, whatever source it came from.
 *
 * The source-neutral walk, and the one a GitHub or Linear anchor gets: it keys on `(occurred_at, id)`
 * because those are the only ordering columns every source has. For a Slack anchor {@link channelWindow}
 * is the better read and `conversation` is what reaches it.
 *
 * @param reader anything a read can run against
 * @param anchor the record to centre on
 * @param before how many records before it
 * @param after how many after it
 * @param chars how much of each body to show
 * @returns the window, oldest first, or the store's own typed failure
 */
async function containerWindow({
  reader,
  anchor,
  before,
  after,
  chars,
}: {
  reader: StoreReader;
  anchor: RecordHead;
  before: number;
  after: number;
  chars: number;
}): Promise<Result<readonly RecordPeek[], StoreError>> {
  const width = Math.min(chars, MAX_PEEK_CHARS);
  try {
    const rows = await reader.db.execute(sql`
      with anchor as (select container_id, occurred_at, id from content where id = ${anchor.id}::uuid),
      window_rows as (
        (select content.id from content, anchor
          where content.container_id = anchor.container_id
            and (content.occurred_at, content.id) <= (anchor.occurred_at, anchor.id)
          order by content.occurred_at desc, content.id desc limit ${before + 1})
        union all
        (select content.id from content, anchor
          where content.container_id = anchor.container_id
            and (content.occurred_at, content.id) > (anchor.occurred_at, anchor.id)
          order by content.occurred_at asc, content.id asc limit ${after})
      )
      select ${HEAD_COLUMNS},
        1 as "from",
        length(content.body) as "bodyChars",
        substring(content.body from 1 for ${width}) as excerpt
      from content
      join window_rows on window_rows.id = content.id
      ${HEAD_JOINS}
      order by content.occurred_at asc
    `);
    return ok([...rows].map((row) => peekOf({ row })));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store around (container)" }));
  }
}

/**
 * Resolve what a caller typed into the row it addresses.
 *
 * Split from {@link runAround} because it is the only part of an `around` read that can fail on the
 * caller's own input rather than on the store, and it is what makes `--id` take the thing a person
 * actually holds — a Slack link — as well as the uuid a probe printed.
 *
 * @param reader anything a read can run against
 * @param address the parsed address
 * @returns the row's id, or the typed failure naming what was not found
 */
export async function resolveAroundAnchor({
  reader,
  address,
}: {
  reader: StoreReader;
  address: SlackAddress;
}): Promise<Result<string, StoreError>> {
  if (address.kind === "uuid") {
    return ok(address.id);
  }
  try {
    const found = await resolveSlackAddress({
      channelId: address.channelId,
      messageTs: address.messageTs,
      reader,
    });
    if (found === null) {
      return err(
        StoreErrors.queryFailed({
          cause: new Error(
            `the store holds no Slack message ${address.channelId}:${address.messageTs} — it may be outside the ingested window, or in a channel this connection cannot read`,
          ),
          what: "store around",
        }),
      );
    }
    return ok(found);
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store around (resolve)" }));
  }
}
