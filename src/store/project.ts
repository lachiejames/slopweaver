/**
 * The pure projection from one `CorpusRecord` to the rows it becomes.
 *
 * This is the whole of what ingest has to get right, and none of it touches a database — which is why it
 * lives here rather than inside the loader. A projection is a function of a record, so it is testable
 * over every source with no Postgres, no fixture home and no mock, and the loader that calls it is left
 * with nothing but batching and a connection.
 *
 * ## Why the container string is stored whole, and the per-source field is derived from it
 *
 * Bronze's `container` is source-shaped rather than uniform — `owner/repo` for GitHub, `slack/C0SY…` for
 * Slack, `linear/INS` for Linear, a bare `notion`, and `mail/updates` for the mailbox, whose prefix is
 * not even its own source name. MEASURED by reading one record from each source's bronze:
 * `head -1 ~/.slopweaver/corpus/bronze/<source>/*.jsonl`. So the row keeps the string VERBATIM as its
 * native id, which is reversible and unambiguous for every source at once, and each source's own columns
 * are read out of it by a rule written down per source rather than guessed by splitting on a separator
 * that four of the six do not use the same way.
 *
 * ## Why a GitHub row's stored id is not the id bronze wrote
 *
 * MEASURED over the first 8,000 records of each source's `compact.jsonl`: GitHub's bronze
 * `sourceId` is `#<number>`, which is unique inside a repository and **not** across them. Fifteen pairs
 * in that slice are the same `#n` in two different repositories — `#6` is an issue in
 * `acme/1password-scim-gcp` and a different issue in `acme/baseline-acme-flow`, each with
 * its own URL. Every other source was clean at the same scale: Slack, Linear, Notion, `self` and the
 * mailbox had zero cross-container collisions in 8,000 records each.
 *
 * The store's identity is `(source, source_id)`, so stored verbatim those two issues become ONE row and
 * the second silently overwrites the first. So a GitHub row's `sourceId` is qualified with its
 * repository — `acme/acme-admin#<number>` — which is what an id for that record always should have
 * been. Reproduce the collision with a scan for repeated `sourceId` values carrying different
 * `container` values, per source.
 *
 * ## Where the source payload goes: columns first, and the envelope beside them
 *
 * `metadata` on the content row carries the record's cross-references and whatever of its projected
 * attributes no per-source column claimed. It does NOT carry the payload: the payload belongs in a proper
 * table that aligns the database schema with the reality of what a platform gives us. That was measured
 * rather than argued: over 4,000 records of each source, `raw` was between a third and two thirds of record
 * bytes, and its largest keys were mostly the body a SECOND time — every one of GitHub's over ten million
 * `body` bytes and Linear's millions of `description`/`body` bytes was verbatim inside the record's own `text`. So what a
 * reader filters, joins or indexes on is a real column on a real per-source table
 * ({@link ./schema/sourceRows}), never a key of a bag.
 *
 * The payload itself lands one place and exactly one place: the `raw` envelope on that same per-source
 * table, written by {@link envelope}. Its whole job is that
 * promoting the NEXT column is a projection over a table this store already holds rather than a refetch
 * from a provider — read {@link ./schema/sourceRows.rawEnvelope} for why that is worth its bytes. Two
 * consequences bind this module: a projector never has to decide whether a field is "worth keeping",
 * because nothing is lost either way; and every promoted column below stays derivable from the envelope
 * sitting next to it, which is what makes a reload from bronze and a backfill from the store the same
 * shape of work.
 */
import type { CorpusRecord } from "../corpus/types.js";

import { err, ok, type Result } from "../lib/result.js";

import { names, num, obj, str, when } from "./bagReaders.js";
import { authorIsBot } from "./botAuthor.js";
import { StoreErrors, type StoreRowRefusedError } from "./errors.js";
import { parentSourceId } from "./parentSourceId.js";
import type { NewContainerRow } from "./schema/container.js";
import type { containerKindEnum, contentKindEnum, visibilityEnum } from "./schema/enums.js";
import { contentSourceEnum } from "./schema/enums.js";
import type {
  NewContentGithubRow,
  NewContentLinearRow,
  NewContentNotionRow,
  NewContentSlackRow,
} from "./schema/sourceRows.js";
import { slackMessageTs, slackReactionCount, slackThreadTs } from "./slackColumns.js";
import { slackTimestampsOf } from "./slackIds.js";

/**
 * A content row with its two foreign keys still unresolved, because ids are the database's to mint.
 *
 * @internal
 */
export type ProjectedContent = {
  readonly source: (typeof contentSourceEnum.enumValues)[number];
  readonly sourceId: string;
  readonly kind: (typeof contentKindEnum.enumValues)[number];
  readonly url: string;
  readonly occurredAt: Date;
  readonly title: string | null;
  readonly body: string;
  readonly visibility: (typeof visibilityEnum.enumValues)[number];
  readonly metadata: Record<string, unknown>;
  /** The natural key of the row this one replies to — {@link parentSourceId}. Null when it starts a thread. */
  readonly parentSourceId: string | null;
  /** Whether the author is an automation — {@link ./botAuthor.authorIsBot}, the one rule. */
  readonly authorIsBot: boolean;
};

/**
 * The per-source side row a record projects to, still missing the content id the database will mint.
 *
 * A discriminated union rather than four optional fields, so a caller writing Slack rows cannot reach a
 * GitHub column and the loader's dispatch is a `switch` the compiler checks.
 *
 * @internal
 */
export type ProjectedSourceRow =
  | { readonly source: "slack"; readonly row: Omit<NewContentSlackRow, "contentId"> }
  | { readonly source: "github"; readonly row: Omit<NewContentGithubRow, "contentId"> }
  | { readonly source: "linear"; readonly row: Omit<NewContentLinearRow, "contentId"> }
  | { readonly source: "notion"; readonly row: Omit<NewContentNotionRow, "contentId"> };

/** Everything one bronze record becomes: its container, its author, its content and its source row. */
export interface ProjectedRecord {
  readonly container: NewContainerRow;
  readonly author: { readonly nativeId: string; readonly handle: string | null; readonly email: string | null } | null;
  readonly content: ProjectedContent;
  readonly sourceRow: ProjectedSourceRow | null;
}

/**
 * What kind of place each source's container is, so a channel and a repository stay distinguishable.
 *
 * Declared per source rather than inferred, because the container STRING carries no type — `notion` and
 * `work-console-state` are both bare words naming completely different kinds of place.
 */
const CONTAINER_KIND_BY_SOURCE = {
  calendar: "calendar",
  chatgpt: "chat",
  fathom: "recorder",
  github: "repository",
  gmail: "mailbox",
  linear: "team",
  notion: "workspace",
  outlook: "mailbox",
  "outlook-calendar": "calendar",
  self: "directory",
  slack: "channel",
} as const satisfies Record<
  (typeof contentSourceEnum.enumValues)[number],
  (typeof containerKindEnum.enumValues)[number]
>;

/**
 * The part of a container string after its final separator.
 *
 * @returns the last `/`-separated segment, or the whole string when there is no separator
 */
function lastSegment({ container }: { container: string }): string {
  // No separator is index -1, so the slice starts at 0 and keeps the whole string.
  return container.slice(container.lastIndexOf("/") + 1);
}

/**
 * The id the store addresses a record by, which for GitHub is not the one bronze wrote.
 *
 * See this module's header for the measurement: `#6` is not an id, it is an id within a repository, and
 * the store's uniqueness is over `(source, source_id)`. Qualifying it here rather than at the unique
 * index keeps `store detail --source github --id acme/acme-admin#<number>` addressing exactly one
 * thing, which a widened index would not.
 *
 * @param record the bronze record being projected
 * @returns the id to store, qualified by container for the one source that needs it
 */
function storedSourceId({ record }: { record: CorpusRecord }): string {
  if (record.source !== "github" || record.sourceId.includes("/")) {
    return record.sourceId;
  }
  return `${record.container}${record.sourceId}`;
}

/**
 * Whether this corpus source has a column in the store at all.
 *
 * `gold` is the one that does not — it is synthesised at query time from distilled markdown and never
 * persisted, so a record carrying it is refused rather than silently coerced.
 *
 * @returns whether the store's `content_source` enum has a word for this source
 */
function isStorableSource(value: string): value is (typeof contentSourceEnum.enumValues)[number] {
  return (contentSourceEnum.enumValues as readonly string[]).includes(value);
}

/**
 * Read one key off an untyped bag as a boolean.
 *
 * @param bag the untyped object
 * @param key which key to read
 * @returns the boolean, or `null` when absent or another type
 */
function bool({ bag, key }: { bag: Readonly<Record<string, unknown>> | undefined; key: string }): boolean | null {
  const value = bag?.[key];
  return typeof value === "boolean" ? value : null;
}

/** The keys each source's own columns claim, so `metadata` never stores the same fact twice. */
const CLAIMED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  github: ["state", "draft", "reviewDecision"],
  linear: [
    "team",
    "number",
    "priority",
    "priorityLabel",
    "state",
    "stateType",
    "assignee",
    "project",
    "cycle",
    "labels",
    "estimate",
    "startedAt",
    "completedAt",
  ],
  notion: ["chunkIndex", "chunkCount"],
  slack: ["channel", "threadTs"],
};

/**
 * What stays in `metadata` once the per-source columns have taken their share.
 *
 * Everything a column claimed is REMOVED rather than left beside it: a fact in two places is a fact that
 * can disagree with itself, and the column is the one a query reads.
 *
 * @param record the bronze record being projected
 * @returns the residual metadata, carrying the record's cross-references and its unclaimed attributes
 */
function metadataFor({ record }: { record: CorpusRecord }): Record<string, unknown> {
  const metadata: Record<string, unknown> = { refs: [...record.refs] };
  if (record.attrs === undefined) {
    return metadata;
  }
  const claimed = new Set(CLAIMED_ATTRS[record.source] ?? []);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.attrs)) {
    if (!claimed.has(key)) {
      rest[key] = value;
    }
  }
  if (Object.keys(rest).length > 0) {
    metadata["attrs"] = rest;
  }
  return metadata;
}

/**
 * The provider's object as the side table's `raw` envelope takes it.
 *
 * A COPY rather than the record's own object, for two reasons that both matter: `CorpusRecord.raw` is
 * `Readonly`, so the deep-readonly type is not assignable to the column's `Record<string, unknown>`; and
 * a projected row that aliased the record would keep the whole bronze line alive for as long as the batch
 * holds the row. `{}` for a record with no payload is the column's own `NOT NULL DEFAULT` said in
 * TypeScript — see {@link ./schema/sourceRows.rawEnvelope} for why an empty object rather than null.
 *
 * @param record the bronze record being projected
 * @returns the payload to store verbatim, or an empty object when bronze carried none
 */
function envelope({ record }: { record: CorpusRecord }): Record<string, unknown> {
  const raw = record.raw;
  return raw === undefined ? {} : { ...raw };
}

/**
 * Project a Slack record's own columns out of its ID, its payload and its container.
 *
 * ## The two timestamps come from the ID, and that is the load-bearing line here
 *
 * They used to come from `raw.ts` and `raw.thread_ts`, which is where Slack puts them — and both of those
 * have been through `redactRecord.ts`'s `redactRecord`, whose `\d{9,}` pass rewrites a ten-digit epoch as
 * `[number]`. MEASURED on a live store: over nine in ten of hundreds of thousands of stored
 * `message_ts` values and every one of the hundreds of thousands of non-null `thread_ts` values carried
 * `[number].<tail>` and nothing else, which made a thread key six digits wide and merged thousands of
 * distinct threads into fewer. `sourceId` is one of
 * the three fields redaction never touches, and `corpus/slack/project.ts` puts both timestamps in it —
 * so reading them here is both correct going forward and a HEAL: re-ingesting bronze already on disk
 * recovers every row without a provider refetch. {@link ./slackIds.slackTimestampsOf} is the layout.
 *
 * The payload is still where everything else comes from, and it is still the fallback for a Slack record
 * whose id is not one of the two message layouts — a `pin`, a `file`, a `canvas` — because those carry no
 * timestamp for the id to give.
 *
 * @param record the Slack bronze record
 * @returns the side row, or `null` when nothing carries a `ts` to address the message by
 */
function slackRow({ record }: { record: CorpusRecord }): ProjectedSourceRow | null {
  const raw = record.raw;
  const fromId = slackTimestampsOf({ sourceId: record.sourceId });
  const messageTs = slackMessageTs({ fromId, raw, sourceId: record.sourceId });
  const channelId = lastSegment({ container: record.container });
  if (messageTs.length === 0 || channelId.length === 0) {
    return null;
  }
  const files = raw?.["files"];
  const botId = str({ bag: raw, key: "bot_id" });
  return {
    row: {
      appId: str({ bag: raw, key: "app_id" }),
      botId,
      channelId,
      channelName: str({ bag: record.attrs, key: "channel" }),
      fileCount: Array.isArray(files) ? files.length : 0,
      isBot: botId !== null,
      messageTs,
      raw: envelope({ record }),
      reactionCount: slackReactionCount({ raw }),
      replyCount: num({ bag: raw, key: "reply_count" }) ?? 0,
      subtype: str({ bag: raw, key: "subtype" }),
      threadTs: slackThreadTs({ attrs: record.attrs, fromId, raw }),
    },
    source: "slack",
  };
}

/**
 * Project a GitHub record's own columns out of its payload and its container.
 *
 * @param record the GitHub bronze record
 * @returns the side row, or `null` when the container is not the `owner/repo` every GitHub row needs
 */
function githubRow({ record }: { record: CorpusRecord }): ProjectedSourceRow | null {
  const raw = record.raw;
  if (record.container.length === 0) {
    return null;
  }
  return {
    row: {
      assignees: names({ field: "login", items: raw?.["assignees"] }),
      authorAssociation: str({ bag: raw, key: "author_association" }),
      closedAt: when({ bag: raw, key: "closed_at" }),
      isDraft: bool({ bag: record.attrs, key: "draft" }) ?? bool({ bag: raw, key: "draft" }),
      labels: names({ field: "name", items: raw?.["labels"] }),
      number: num({ bag: raw, key: "number" }),
      raw: envelope({ record }),
      repo: record.container,
      reviewDecision: str({ bag: record.attrs, key: "reviewDecision" }),
      state: str({ bag: record.attrs, key: "state" }) ?? str({ bag: raw, key: "state" }),
    },
    source: "github",
  };
}

/**
 * Project a Linear record's own columns out of its payload, its attributes and its container.
 *
 * @param record the Linear bronze record
 * @returns the side row, or `null` when neither the attributes nor the container name a team
 */
function linearRow({ record }: { record: CorpusRecord }): ProjectedSourceRow | null {
  const raw = record.raw;
  const team = str({ bag: record.attrs, key: "team" }) ?? lastSegment({ container: record.container });
  if (team.length === 0) {
    return null;
  }
  const state = obj({ bag: raw, key: "state" });
  const assignee = obj({ bag: raw, key: "assignee" });
  return {
    row: {
      assignee: str({ bag: assignee, key: "displayName" }) ?? str({ bag: record.attrs, key: "assignee" }),
      completedAt: when({ bag: raw, key: "completedAt" }),
      cycle: str({ bag: record.attrs, key: "cycle" }),
      estimate: num({ bag: raw, key: "estimate" }),
      identifier: str({ bag: raw, key: "identifier" }) ?? str({ bag: record.attrs, key: "issue" }),
      labels: names({ field: "name", items: obj({ bag: raw, key: "labels" })?.["nodes"] }),
      number: num({ bag: raw, key: "number" }),
      priority: num({ bag: raw, key: "priority" }),
      priorityLabel: str({ bag: raw, key: "priorityLabel" }),
      project: str({ bag: record.attrs, key: "project" }),
      raw: envelope({ record }),
      startedAt: when({ bag: raw, key: "startedAt" }),
      state: str({ bag: state, key: "name" }) ?? str({ bag: record.attrs, key: "state" }),
      stateType: str({ bag: state, key: "type" }) ?? str({ bag: record.attrs, key: "stateType" }),
      team,
    },
    source: "linear",
  };
}

/**
 * Read the id out of Notion's parent object, whose key is named for the parent's own kind.
 *
 * `{"type":"block_id","block_id":"…"}` — the type IS the key holding the id, which is why this is a
 * lookup through the type rather than a fixed field name.
 *
 * @param parent the payload's `parent` object
 * @returns the parent's id, or `null` when the object does not name one
 */
function notionParentId({ parent }: { parent: Readonly<Record<string, unknown>> | undefined }): string | null {
  const kind = str({ bag: parent, key: "type" });
  return kind === null ? null : str({ bag: parent, key: kind });
}

/**
 * Project a Notion record's own columns out of its payload.
 *
 * @param record the Notion bronze record
 * @returns the side row, which every Notion record can produce because none of its columns is required
 */
function notionRow({ record }: { record: CorpusRecord }): ProjectedSourceRow {
  const raw = record.raw;
  const parent = obj({ bag: raw, key: "parent" });
  const icon = obj({ bag: raw, key: "icon" });
  const properties = obj({ bag: raw, key: "properties" });
  return {
    row: {
      chunkCount: num({ bag: record.attrs, key: "chunkCount" }),
      chunkIndex: num({ bag: record.attrs, key: "chunkIndex" }),
      icon: str({ bag: icon, key: "emoji" }) ?? str({ bag: icon, key: "type" }),
      isArchived: bool({ bag: raw, key: "is_archived" }) === true,
      lastEditedAt: when({ bag: raw, key: "last_edited_time" }),
      parentId: notionParentId({ parent }),
      parentKind: str({ bag: parent, key: "type" }),
      properties: properties === undefined ? {} : { ...properties },
      raw: envelope({ record }),
    },
    source: "notion",
  };
}

/**
 * Project the per-source side row for whichever source this record came from.
 *
 * @param record the bronze record being projected
 * @returns the side row, or `null` for a source with no table and for a record its table cannot hold
 */
function sourceRowFor({ record }: { record: CorpusRecord }): ProjectedSourceRow | null {
  if (record.source === "slack") {
    return slackRow({ record });
  }
  if (record.source === "github") {
    return githubRow({ record });
  }
  if (record.source === "linear") {
    return linearRow({ record });
  }
  if (record.source === "notion") {
    return notionRow({ record });
  }
  return null;
}

/**
 * The address a record's payload holds for its author, when its platform gives one.
 *
 * Only the sources that actually carry an address are read, and each is read from where that platform
 * puts it — this is the field the identity ladder auto-links on, so a wrong one merges two people.
 *
 * @param record the bronze record being projected
 * @returns the author's email, or `null` when the platform did not supply one
 */
function authorEmail({ record }: { record: CorpusRecord }): string | null {
  if (record.source === "gmail") {
    return str({ bag: record.attrs, key: "from" });
  }
  const raw = record.raw;
  if (record.source === "github") {
    return str({ bag: obj({ bag: raw, key: "user" }), key: "email" });
  }
  if (record.source === "linear") {
    const user = obj({ bag: raw, key: "user" }) ?? obj({ bag: raw, key: "creator" });
    return str({ bag: user, key: "email" });
  }
  if (record.source === "slack") {
    return str({ bag: obj({ bag: obj({ bag: raw, key: "user_profile" }), key: "profile" }), key: "email" });
  }
  return null;
}

/**
 * Project one bronze record into the rows the store holds, or say exactly why it cannot be stored.
 *
 * Refuses rather than coerces, and the refusal names the record. Three things can make a record
 * unstorable and each is a real shape bronze can hold — a source the store has no column for, a container
 * string that is empty, and a source whose per-source table cannot be filled from what the record
 * carries. The last one matters because the store's deferred presence trigger would reject the content
 * row at commit anyway, so catching it here turns a whole-batch abort into one counted refusal.
 *
 * @param record the bronze record to project
 * @returns the container, author, content and side row, or the typed refusal
 */
export function projectRecord({ record }: { record: CorpusRecord }): Result<ProjectedRecord, StoreRowRefusedError> {
  const refuse = ({ reason }: { reason: string }): Result<ProjectedRecord, StoreRowRefusedError> =>
    err(StoreErrors.rowRefused({ reason, source: record.source, sourceId: record.sourceId }));

  if (!isStorableSource(record.source)) {
    return refuse({ reason: `the store has no column for source "${record.source}"` });
  }
  if (record.container.length === 0) {
    return refuse({ reason: "it names no container, and every row belongs to a place" });
  }

  const sourceRow = sourceRowFor({ record });
  const needsSourceRow = record.source === "slack" || record.source === "github" || record.source === "linear";
  if (needsSourceRow && sourceRow === null) {
    return refuse({ reason: `its payload and container "${record.container}" fill no ${record.source} row` });
  }

  const handle = record.author;
  return ok({
    author:
      handle === undefined || handle.length === 0 ? null : { email: authorEmail({ record }), handle, nativeId: handle },
    container: {
      kind: CONTAINER_KIND_BY_SOURCE[record.source],
      name: record.container,
      nativeId: record.container,
      source: record.source,
    },
    content: {
      authorIsBot: authorIsBot({
        authorNativeId: handle === undefined || handle.length === 0 ? null : handle,
        raw: record.raw,
        source: record.source,
      }),
      body: record.text,
      kind: record.kind,
      metadata: metadataFor({ record }),
      occurredAt: new Date(record.tsIso),
      parentSourceId: parentSourceId({
        parentComment: str({ bag: record.attrs, key: "parentComment" }),
        source: record.source,
        sourceId: storedSourceId({ record }),
      }),
      source: record.source,
      sourceId: storedSourceId({ record }),
      title: record.title ?? null,
      url: record.url,
      visibility: record.visibility ?? "public",
    },
    sourceRow,
  });
}
