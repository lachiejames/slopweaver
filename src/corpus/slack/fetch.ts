/**
 * The impure Slack edge. Discovers every channel the token can read (`conversations.list`, paged),
 * then pages each channel's `conversations.history` over the window and every thread's
 * `conversations.replies`, shaping raw payloads defensively into the clean items `project.ts` consumes.
 * The `@slack/web-api` `WebClient` is confined to `./api.ts` behind an injected `SlackApi` seam so the whole
 * orchestration here is unit-testable with a fake. Permalinks are constructed from the workspace URL + ts
 * (Slack's stable `archives/<channel>/p<ts>` form) rather than an extra call per message. File/image
 * attachments are shaped to REFS and never to bytes — but `shapeFile` also carries the whole upstream file
 * object through as `raw`, so `url_private` and friends DO reach bronze. See the `project.ts` module header
 * for why that retention is deliberate.
 *
 * This module is the thin public entry point: the `SlackApi` seam, the `SlackActivity` result shape and the
 * small pure helpers live here, while the actual work is split across three siblings this module orchestrates
 * — `discovery.ts` (workspace + user directory discovery), `channelRead.ts` (one conversation's history +
 * thread paging, with the mid-crawl flush that bounds memory) and `workspaceCrawl.ts` (the per-channel loop
 * that calls `channelRead.ts` once per discovered channel and folds the results together). The two
 * `response_metadata` readers, `slackNextCursor` and `slackScopesFromMetadata`, are exported from
 * `responseMetadata.ts` only and are not re-exported here; neither module imports the other.
 */
import { yyyyMmDdToEpochSeconds } from "../../lib/date.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { SourceProgress } from "../progress.js";
import type { ExportWindow } from "../types.js";
import { type ChannelDeadlineFactory, channelProgressDeadline, SLACK_CHANNEL_STALL_MS } from "./channelDeadline.js";
import type { SlackChannelSummary } from "./channelSummary.js";
import type { ChannelWatermarkEntry } from "./channelWatermark.js";
import { fetchSlackCurated } from "./curatedFetch.js";
import { discoverSlackWorkspace, discoverUsers } from "./discovery.js";
import type { SlackFetchError } from "./errors.js";
import type { SlackConversationLane } from "./lanes.js";
import type { SlackChannelItems, SlackCuratedItems } from "./project.js";
import type { ThreadCursors } from "./threadCursors.js";
import type { SlackNameMaps } from "./visibleProse.js";
import { type ChannelCrawlRun, crawlChannels } from "./workspaceCrawl.js";

/**
 * Choose the token to READ Slack with: a user token (full channel visibility) wins; a bot token is the
 * fallback but only sees bot-invited channels, so it comes with a limited-breadth warning. Pure — the
 * env/file lookups happen in the caller, so the precedence + warning are unit-testable.
 *
 * @param userToken the resolved Slack user token, if any
 * @param botToken the resolved Slack bot token, if any
 * @returns the read token (absent ⇒ neither configured) + a warning when falling back to the bot token
 */
export function resolveSlackReadToken({
  userToken,
  botToken,
}: {
  userToken: string | undefined;
  botToken: string | undefined;
}): { token?: string; warning?: string } {
  if (userToken !== undefined) {
    return { token: userToken };
  }
  if (botToken !== undefined) {
    return {
      token: botToken,
      warning:
        "slack: using a bot token — channel visibility is limited to bot-invited channels; set SLACK_USER_TOKEN for full read access",
    };
  }
  return {};
}

/** A page of channels from `conversations.list`. */
export interface SlackChannelsPage {
  readonly channels: readonly unknown[];
  readonly nextCursor?: string;
}

/**
 * A discovered channel + the privacy signal already present in its `conversations.list` payload. The
 * booleans drive the PR4.5 visibility stamp (a private channel / DM / mpim projects to `private`); they
 * were previously discarded. Absent ⇒ treated as a public channel.
 */
export interface SlackChannelRef {
  readonly id: string;
  readonly name?: string;
  readonly isPrivate?: boolean;
  readonly isIm?: boolean;
  readonly isMpim?: boolean;
  /**
   * Whether the TOKEN making this call is a member of the channel — absent (not `false`) when
   * `conversations.list` omitted the field, which it does for every `im` row (a DM has no membership
   * concept; the bot is inherently a participant in every DM `conversations.list` ever returns for it).
   * A bot token's own `conversations.list` can list a public channel it has never joined and cannot read
   * history from at all — this is the field that tells the two apart.
   */
  readonly isMember?: boolean;
  /**
   * Whether Slack has archived this conversation. Absent ⇒ live. Discovery asks for archived channels
   * deliberately (see `api.ts`'s `exclude_archived: false`), so this is the flag that keeps a finished
   * project's channel citable AS finished rather than reading like current activity.
   */
  readonly isArchived?: boolean;
  /**
   * When Slack created the channel, in epoch seconds, off the same `conversations.list` row. Absent when the row
   * carried none. What lets a live sweep tell a channel opened in the last hours from one years old
   * (`../../incident/detect.ts`) without a second call.
   */
  readonly createdEpochSeconds?: number;
  /** The user id that created the channel, when the row carries one — an incidents.io channel names its app user. */
  readonly creator?: string;
  /** The channel's topic text, when it has one — incidents.io writes the incident's reference (`INC-98`) there. */
  readonly topic?: string;
}

/**
 * A page of messages from `conversations.history`/`.replies`.
 *
 * `hasMore` is Slack's own "there is more after this page" flag, carried separately from `nextCursor`
 * because the two can disagree. A cursor-only loop treats "no cursor" as completion, so a response with
 * `has_more: true` and no cursor reads as a finished thread — which is how a prefix gets reported as the
 * whole conversation. `live/slack/pagination.ts` cross-checks the pair and refuses that contradiction;
 * the best-effort ingest lanes ignore it, which is why this is OPTIONAL and additive.
 */
export interface SlackMessagesPage {
  readonly messages: readonly unknown[];
  readonly nextCursor?: string;
  readonly hasMore?: boolean;
}

/** A page of workspace members from `users.list`. */
interface SlackUsersPage {
  readonly members: readonly unknown[];
  readonly nextCursor?: string;
}

/** A page of raw files from `files.list` (used for the durable canvas-discovery path). */
interface SlackFilesPage {
  readonly files: readonly unknown[];
  readonly nextCursor?: string;
}

/**
 * Injected Slack seam. Raw shapes stay `unknown`; the fetch parses them defensively. The curated methods
 * (`pins`/`bookmarks`/`files`) are OPTIONAL — a best-effort lane whose absence or failure degrades to a
 * warning, never a fatal error (so a missing scope never sinks the message crawl).
 */
export interface SlackApi {
  workspaceUrl: () => Promise<string | undefined>;
  /**
   * `conversations.list` for ONE lane. `lane` is required rather than defaulted on purpose: a default is
   * exactly what let the combined type string stand for years, so every caller states which conversation
   * class it is asking for and a new one cannot silently inherit the wrong set.
   */
  listChannels: (args: {
    lane: SlackConversationLane;
    cursor?: string;
    pageSize?: number | undefined;
  }) => Promise<SlackChannelsPage>;
  listUsers: (args: { cursor?: string; pageSize?: number | undefined }) => Promise<SlackUsersPage>;
  history: (args: {
    channel: string;
    oldest: string;
    latest: string;
    cursor?: string;
    pageSize?: number | undefined;
    /** Slack's `inclusive` — include the message AT `oldest`; off by default, so `oldest` is exclusive. */
    inclusive?: boolean | undefined;
    /** Slack's `include_all_metadata` — off by default; a caller reading `metadata` back must opt in. */
    includeAllMetadata?: boolean | undefined;
    /** Opt into the shared Tier 3 throttle for an interactive multi-page read. Bulk crawl callers omit it. */
    paced?: boolean | undefined;
  }) => Promise<SlackMessagesPage>;
  replies: (args: {
    channel: string;
    ts: string;
    oldest: string;
    cursor?: string;
    pageSize?: number | undefined;
    /** Slack's `include_all_metadata` — off by default; a caller reading `metadata` back must opt in. */
    includeAllMetadata?: boolean | undefined;
  }) => Promise<SlackMessagesPage>;
  /**
   * `files.info` — one file id to its metadata, including the `url_private_download` a Block Kit
   * `slack_file: { id }` reference does not carry.
   *
   * REQUIRED rather than optional, unlike the curated trio below. Those degrade to a warning by design; this
   * one is the only route to an attachment the reader can plainly see, so a seam that could be absent would
   * force its consumer to have a silent do-nothing branch — the defect class, not a convenience.
   */
  filesInfo: (args: {
    fileId: string;
    /**
     * Slack's undeclared `include_transcription` — the switch that makes a `huddle_transcript` file return
     * its WORDS inline under `file.huddle_transcription` instead of only its metadata. Off by default: it
     * is the difference between a metadata lookup and reading a recorded conversation, so a caller opts in.
     */
    includeTranscription?: boolean;
  }) => Promise<{ file: unknown }>;
  /**
   * `auth.test` → the scopes Slack says this token holds, off the `x-oauth-scopes` response header.
   *
   * `undefined` means the set could NOT be established, which is a different claim from a token holding
   * nothing — see `./responseMetadata.ts`'s `slackScopesFromMetadata`. REQUIRED for the same reason `filesInfo` is: a consumer
   * forced to branch on an absent seam would report every read as scope-verified without having checked.
   */
  grantedScopes: () => Promise<readonly string[] | undefined>;
  pins?: (args: { channel: string }) => Promise<{ items: readonly unknown[] }>;
  bookmarks?: (args: { channel: string }) => Promise<{ bookmarks: readonly unknown[] }>;
  /**
   * `files.list` — the workspace-wide file walk the curated canvas/huddle lane discovers through.
   *
   * `types` is Slack's own filter and it is NOT optional decoration here: a workspace's files are
   * overwhelmingly images, and this method returns them newest-first, so an unfiltered walk spends its whole
   * page budget on screenshots and finds no canvas at all. Measured: 6,736 files in the
   * workspace, of which the first 400 unfiltered held 3 canvases and no huddle; `types=spaces` returns 197
   * canvases, huddle notes among them, carrying `is_huddle_canvas` and `huddle_transcript_file_id`.
   *
   * `cursor` is a PAGE NUMBER as a string, not a Slack cursor. `files.list` is the one method in this seam
   * that pages by ordinal (`paging.pages`) rather than by `next_cursor`, and it is spelled as a cursor so
   * the shared `collectCursorPages` walk works unchanged — the alternative was a second paging primitive
   * for one method.
   */
  files?: (args: {
    cursor?: string;
    pageSize?: number | undefined;
    types?: string | undefined;
  }) => Promise<SlackFilesPage>;
}

/** A `YYYY-MM-DD` window bound → Slack epoch-seconds string (`oldest`/`latest` share this shape). */
function dateToEpoch({ date, fallback }: { date: string; fallback: string }): string {
  const seconds = yyyyMmDdToEpochSeconds({ date });
  return seconds === undefined ? fallback : String(seconds);
}

/**
 * The Slack `[oldest, latest]` epoch-seconds bounds for an export window (an unparseable bound falls back
 * to the widest sentinel, matching the historical behaviour). Pure.
 *
 * @param window the export window
 * @returns the Slack `oldest`/`latest` bounds
 */
export function slackWindowBounds({ window }: { window: ExportWindow }): { oldest: string; latest: string } {
  return {
    latest: dateToEpoch({ date: window.until, fallback: "9999999999" }),
    oldest: dateToEpoch({ date: window.since, fallback: "0" }),
  };
}

/**
 * The id→display-name map for discovered channels (used to resolve cross-channel `<#Cxxx>` mentions). Pure.
 *
 * @param discovered every discovered channel
 * @returns the id→name map (channels without a name are omitted)
 */
export function channelNameMap({
  discovered,
}: {
  discovered: readonly { id: string; name?: string }[];
}): Record<string, string> {
  const names: Record<string, string> = {};
  for (const channel of discovered) {
    if (channel.name !== undefined) {
      names[channel.id] = channel.name;
    }
  }
  return names;
}

/**
 * Concatenate two warning lists (neither mutated). Pure.
 *
 * @param base the warnings so far
 * @param extra the warnings to append
 * @returns a new list; both inputs are left alone
 */
export function mergeSlackWarnings({
  base,
  extra,
}: {
  base: readonly string[];
  extra: readonly string[];
}): readonly string[] {
  return [...base, ...extra];
}

/**
 * Select the channels to fetch: an explicit id allowlist (drops the rest), else every discovered channel.
 * Pure.
 *
 * @param discovered every channel discovery returned
 * @param channelFilter an optional explicit id allowlist
 * @returns the selected channels
 */
export function selectChannels({
  discovered,
  channelFilter,
}: {
  discovered: readonly SlackChannelRef[];
  channelFilter: readonly string[] | undefined;
}): readonly SlackChannelRef[] {
  if (channelFilter === undefined) {
    return discovered;
  }
  const filter = new Set(channelFilter);
  return discovered.filter((channel) => filter.has(channel.id));
}

/**
 * Commit ONE conversation's items, called the moment that conversation has been read to the end.
 *
 * This is the durability seam, and the grain is deliberate. `ingestOneWithDeps` fetches a whole window and
 * then writes once, which for a 603-conversation epoch-wide Slack crawl is a ~36-hour job holding everything
 * in memory and betting the machine does not restart. Measured, that bet lost twice in one day
 * and kept zero records both times. A conversation is the natural commit boundary: it is what the crawl
 * finishes, what the per-channel watermark marks, and what a restart can then skip.
 *
 * An `err` means the records did NOT reach disk, so the crawl must not record that conversation as visited —
 * see `workspaceCrawl.ts`'s `crawlOneChannel`. `maps` is passed because the id→name maps are built once per
 * refresh, before the crawl, and projection needs them to resolve `<@Uxxx>`/`<#Cxxx>` markup; `oldest` is
 * passed because the completion marker a commit writes has to say whether THIS read started at the Slack
 * epoch, which is the only thing that makes the conversation skippable on a later epoch-wide run.
 */
export type SlackChannelCommit = (args: {
  channel: SlackChannelRef;
  items: SlackChannelItems;
  maps: SlackNameMaps;
  /** The Slack `oldest` this conversation was actually read from, as epoch seconds. */
  oldest: string;
  /**
   * The newest `tsIso` the WHOLE conversation yielded this run, `""` when it yielded none — including any
   * prefix a mid-crawl flush already banked and released.
   *
   * Carried rather than derived from `items`, because on a flushed conversation `items` is only the TAIL.
   * `conversations.history` is newest-first, so the tail's max is the OLDEST timestamp read, and a cursor
   * taken from it would sit below every row already on disk.
   */
  maxTsIso: string;
  /**
   * Top-level rows this conversation's history walk was served, present ONLY when that walk ran to the end
   * of the channel — so it is the channel's size, never a prefix's. Absent on a capped, stuck or bounded
   * read, and a commit that receives nothing leaves whatever count is already stored alone.
   */
  walkedMessages?: number;
}) => Result<{ written: number }>;

/**
 * Bank a PREFIX of one conversation, mid-crawl, so a conversation bigger than the heap can still reach disk.
 *
 * Deliberately a different type from {@link SlackChannelCommit}, and deliberately a NARROWER one: it carries
 * neither `oldest` nor `maxTsIso`, which are the only two inputs a completion marker or a cursor advance has.
 * So an implementation cannot write either, and this is enforced by the compiler rather than by a comment or
 * a reviewer — a partial commit that read as backfilled would remove the conversation from the coverage gap
 * list forever while most of it was still unread, which is silently worse than the loud out-of-memory kill
 * this whole flush replaces. See `channelRead.ts`'s `flushWithinChannel`.
 */
export type SlackChannelPartialCommit = (args: {
  channel: SlackChannelRef;
  items: SlackChannelItems;
  maps: SlackNameMaps;
}) => Result<{ written: number }>;

/**
 * Everything one Slack activity crawl produced — the named counterpart to `LinearActivity`.
 *
 * `warnings` is where an incompletely-paged lane surfaces: channel discovery, a channel's history, a thread's
 * replies and the user directory each report a stuck cursor or a page ceiling here rather than returning a
 * prefix that reads as complete.
 */
export interface SlackActivity {
  /**
   * The conversations whose items this run STILL HOLDS — those no per-conversation commit banked, plus any
   * whose commit failed. On an unbounded `refresh` every conversation is committed as it finishes, so this is
   * empty and the memory the crawl carries is {@link channelSummaries} alone. On a bounded run (which has no
   * commit seam) it is every conversation, and the end-of-run bulk write is the only write.
   */
  readonly retainedChannels: readonly SlackChannelItems[];
  /**
   * Every conversation this crawl RECORDED, folded to `SlackChannelSummary` — whether a commit seam
   * banked it or not. This is what the curated lane, the per-channel watermark and the pooled cursor read
   * now that a banked conversation's items are gone.
   */
  readonly channelSummaries: readonly SlackChannelSummary[];
  /**
   * The newest `tsIso` the whole crawl saw, or `""` when it saw none.
   *
   * Carried explicitly because the pooled per-source cursor is computed from the records handed to the BULK
   * write, and a run that committed every conversation per-container hands it curated records only. Without
   * this the pooled Slack cursor would stall wherever it already sat, and every later incremental run would
   * re-read from there.
   */
  readonly maxTsIso: string;
  readonly warnings: readonly string[];
  readonly threadCursors: ThreadCursors;
  readonly maps: SlackNameMaps;
  readonly curated: SlackCuratedItems;
  /** Every conversation `conversations.list` returned, so a caller can report reach against what it crawled. */
  readonly discovered: readonly SlackChannelRef[];
  /**
   * The ids whose history was actually READ this run — the input to the per-channel backfill store. Distinct
   * from `channels`, which a caller cannot use for this: an entry there says a channel was read, but its
   * absence conflates "read and empty" with "the read threw", and only the second may be retried from scratch.
   */
  readonly visitedChannels: readonly string[];
  /**
   * The subset of {@link visitedChannels} whose history was read from the Slack EPOCH this run — i.e. the
   * conversations this crawl backfilled end to end.
   *
   * Separate from `visitedChannels` because a cursor cannot carry the distinction: a channel read over a
   * 90-day window and one read from the epoch both end up with a recent cursor, and only the second may be
   * resumed rather than re-read when a later epoch-wide request arrives. See
   * `channelWatermark.ChannelWatermarkEntry`.
   */
  readonly fullHistoryChannels: readonly string[];
  /**
   * Channel id → top-level rows a COMPLETED history walk was served this run.
   *
   * Only channels whose walk actually reached the end appear: a prefix is not a size, and the per-channel
   * lane decision (`threadOracle.chooseThreadDetectionLane`) reads this number as "how many pages walking
   * this channel would cost". A channel absent from it keeps whatever count it already had.
   */
  readonly channelMessageCounts: ReadonlyMap<string, number>;
  /**
   * The conversations this run ABANDONED because their progress deadline expired (`./channelDeadline.ts`).
   *
   * Carried apart from `warnings` because it is a coverage gap rather than advice: a run that skipped one of
   * these read less than its window, and a caller that folded it into a warning line exited 0 over a corpus it
   * had not refreshed (measured, finding `a-slack-corpus-refresh-can-stall-and-still`).
   */
  readonly abandonedChannels: readonly SlackChannelRef[];
}

/**
 * Assemble the constants every conversation's crawl reads, resolving the window to its Slack bounds once.
 *
 * @param window the export window
 * @param rest everything else `ChannelCrawlRun` needs — the injected seams, name maps, sinks and run size
 * @returns the bundle
 */
function channelCrawlRun({
  window,
  ...rest
}: Omit<ChannelCrawlRun, "bounds"> & { window: ExportWindow }): ChannelCrawlRun {
  return { bounds: slackWindowBounds({ window }), ...rest };
}

/** The stock watchdog factory: the shipped stall window, no override. */
const defaultChannelDeadline: ChannelDeadlineFactory = () =>
  channelProgressDeadline({ timeoutMs: SLACK_CHANNEL_STALL_MS });

/** The stock clock the per-conversation ingest floor is capped by. A caller pins it to test the cap. */
const defaultNowIso = (): string => new Date().toISOString();

/**
 * The id→name maps this crawl resolves markup with.
 *
 * Channels and users come from this crawl's own reads; the USERGROUP map is handed in, because one built
 * from this crawl would be as complete as this crawl happened to be. The Slack atlas holds every group the
 * token can see and says what it cannot — see `atlas/slackWorkspace/names.ts`. Absent, a bare
 * `<!subteam^S…>` resolves to the generic `@group` exactly as it did before, which is a visible non-answer
 * rather than a wrong name.
 *
 * @param discovered every conversation discovery returned
 * @param userNames the id→name map `users.list` produced
 * @param usergroupHandles the atlas's own map, when there is one
 * @returns the maps, with the usergroup half present only when it was supplied
 */
function nameMaps({
  discovered,
  userNames,
  usergroupHandles,
}: {
  discovered: readonly { id: string; name?: string }[];
  userNames: Readonly<Record<string, string>>;
  usergroupHandles: Readonly<Record<string, string>> | undefined;
}): SlackNameMaps {
  return {
    channelNames: channelNameMap({ discovered }),
    userNames,
    ...(usergroupHandles !== undefined ? { usergroupHandles } : {}),
  };
}

/**
 * Crawl the workspace: discover channels, then page each one's messages and threads to exhaustion.
 *
 * @param api the injected Slack seam
 * @param window the export window
 * @param threadCursors the per-thread cursors from the last crawl, so only newer replies are re-fetched
 * @param channelCursors the per-channel backfill cursors — a channel ABSENT from this map has never been
 *   crawled at all, which is the state the pooled per-source watermark cannot express
 * @param backfillNewChannels whether a never-crawled channel is read from the EPOCH rather than from
 *   `window.since`. Default ON: the standing ruling is that everything reachable belongs in bronze, and a
 *   channel first seen after the pooled cursor advanced can be reached no other way. A caller that pinned an
 *   explicit window passes false, because then the window IS the request
 * @param channelFilter restrict the crawl to these channel ids; omit to crawl everything discovered
 * @param onProgress the heartbeat/preview sink — omitted when nothing is watching
 * @param onChannelCommit the per-conversation commit seam — omitted when the caller writes once at the end
 * @param onChannelPartialCommit the MID-conversation flush seam, which banks a prefix and lets it go so one
 *   conversation bigger than the heap can still reach disk — omitted when the caller writes once at the end.
 *   It claims nothing: see `SlackChannelPartialCommit`
 * @param maxItems per-lane fetch cap (`--fetch-cap`): caps channels, users, and messages per channel
 * @param channelDeadline arms each conversation's progress watchdog — a conversation that goes
 *   {@link SLACK_CHANNEL_STALL_MS} with no page, thread or flush is abandoned and the crawl moves on. A
 *   caller overrides it to change the window (the CLI reads `SLOPWEAVER_SLACK_STALL_MINUTES`) or, in a test,
 *   to trip a stall on demand rather than by waiting
 * @param usergroupHandles usergroup id → handle, from the Slack atlas — omitted leaves a bare usergroup
 *   mention rendering as the generic `@group`
 * @param nowIso the clock each conversation's ingest floor is capped by (`./reach.ts#planChannelOldest`),
 *   defaulting to the real one; a caller pins it to make the cap testable without waiting for a day to pass
 * @returns the shaped items plus warnings, or `err` when the workspace could not be resolved at all
 *
 * The id→name maps are built ONCE per refresh (channels from discovery, users from `users.list`) — the raw
 * material for pure `<#Cxxx>`/`<@Uxxx>` markup resolution in projection, and what the per-conversation
 * commit seam is handed so its projection matches the final one exactly. The USERGROUP map is the one
 * exception and arrives through `usergroupHandles`: it comes from the Slack atlas rather than from this
 * crawl, for the reason that field's own comment gives.
 */
export async function fetchSlackActivity({
  api,
  window,
  threadCursors = {},
  channelCursors = new Map(),
  backfillNewChannels = true,
  channelFilter,
  onProgress,
  onChannelCommit,
  onChannelPartialCommit,
  maxItems,
  usergroupHandles,
  channelDeadline = defaultChannelDeadline,
  nowIso = defaultNowIso,
}: {
  api: SlackApi;
  window: ExportWindow;
  threadCursors?: ThreadCursors;
  channelCursors?: ReadonlyMap<string, ChannelWatermarkEntry>;
  backfillNewChannels?: boolean;
  channelFilter?: readonly string[];
  onProgress?: SourceProgress;
  onChannelCommit?: SlackChannelCommit;
  onChannelPartialCommit?: SlackChannelPartialCommit;
  maxItems?: number;
  usergroupHandles?: Readonly<Record<string, string>>;
  channelDeadline?: ChannelDeadlineFactory;
  nowIso?: () => string;
}): Promise<Result<SlackActivity, SlackFetchError>> {
  const discovery = await discoverSlackWorkspace({ api, ...(maxItems !== undefined ? { maxItems } : {}) });
  if (discovery.isErr()) {
    return err(discovery.error);
  }
  const { workspaceUrl, discovered, warnings: discoveryWarnings } = discovery.value;
  const users = await discoverUsers({ api, ...(maxItems !== undefined ? { maxItems } : {}) });
  const maps = nameMaps({ discovered, userNames: users.users, usergroupHandles });
  const selected = selectChannels({ channelFilter, discovered });
  const constants = { api, channelDeadline, maps, nowIso, threadCursors, total: selected.length, window, workspaceUrl };
  const seams = {
    ...(onProgress !== undefined ? { onProgress } : {}),
    ...(onChannelCommit !== undefined ? { onChannelCommit } : {}),
    ...(onChannelPartialCommit !== undefined ? { onChannelPartialCommit } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
  };
  const run = channelCrawlRun({ ...constants, ...seams });
  const crawl = await crawlChannels({ backfillNewChannels, channelCursors, run, selected });
  const curated = await fetchSlackCurated({
    api,
    channels: crawl.summaries,
    maps,
    workspaceUrl,
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  const base = [...discoveryWarnings, ...users.warnings];
  return ok(shapeSlackActivity({ base, crawl, curated, discovered, maps }));
}

/**
 * Assemble the crawl, the curated lane and the discovery facts into one {@link SlackActivity}. Pure.
 *
 * @param crawl what `workspaceCrawl.ts`'s `crawlChannels` produced
 * @param curated what the curated lane produced
 * @param discovered every conversation `conversations.list` returned
 * @param maps the id→name maps built once for this refresh
 * @param base the warnings raised before the crawl (discovery + the user directory)
 * @returns the activity
 */
function shapeSlackActivity({
  crawl,
  curated,
  discovered,
  maps,
  base,
}: {
  crawl: Awaited<ReturnType<typeof crawlChannels>>;
  curated: Awaited<ReturnType<typeof fetchSlackCurated>>;
  discovered: readonly SlackChannelRef[];
  maps: SlackNameMaps;
  base: readonly string[];
}): SlackActivity {
  return {
    abandonedChannels: crawl.abandoned,
    channelSummaries: crawl.summaries,
    curated: curated.items,
    discovered,
    channelMessageCounts: crawl.walkedMessages,
    fullHistoryChannels: crawl.fullHistory,
    maps,
    maxTsIso: crawl.maxTsIso,
    retainedChannels: crawl.retained,
    threadCursors: crawl.cursors,
    visitedChannels: crawl.visited,
    warnings: mergeSlackWarnings({ base: [...base, ...crawl.warnings], extra: curated.warnings }),
  };
}

export { SLACK_CHANNEL_FLUSH_ITEMS } from "./channelRead.js";
export type { SlackChannelSummary } from "./channelSummary.js";
export { summariseSlackChannel } from "./channelSummary.js";
export { channelsFromPage } from "./discovery.js";
