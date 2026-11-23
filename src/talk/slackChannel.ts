/**
 * One Slack channel read LIVE from the name on the owner's screen, shaped for the console voice — the core of
 * `slopweaver talk slack-channel`.
 *
 * The owner's ask: when they tell the voice to read this Slack channel, it looks at their screen, sees which channel
 * they are looking at, calls whatever tools it needs to get the entire channel history and summarises it back. Without
 * it, the voice's only route to a channel was the corpus, by an id the Slack app never shows, hours behind.
 *
 * Three decisions, each the answer to a way the read would otherwise be wrong:
 *
 * - **The name resolves LIVE, exactly, or not at all.** One complete walk of the channels lane (`conversations.list`,
 *   three pages at 1000 — `fetchCompleteSlackLane`'s measurement) finds every channel the token can see; one
 *   exact match is read, two are refused as ambiguous, none is refused with the nearest names as suggestions. A
 *   near name is never read in its place: reading the wrong channel and summarising it confidently is worse than
 *   saying which names are close. A link or id skips the walk and is checked by `conversations.info` instead.
 * - **"The entire history" is the newest {@link SLACK_CHANNEL_HISTORY_LIMIT} top-level messages**, one
 *   `conversations.history` page, each with its reply count — never every reply, which is one more call per thread
 *   and cannot fit the console's 20 s tool deadline on a busy channel. The answer says so in its first sentence, and
 *   says whether older messages exist, so the voice never calls a window the whole channel. A thread the owner wants is
 *   one `slack_open` away on the permalink each message carries.
 * - **Nothing is written and no attachment is fetched** — a file is named, never downloaded, the line that keeps
 *   `slack read-thread` off the voice's `verb` list (`./modelReads.ts`).
 */
import { stringSimilarity } from "#lib/editDistance.js";
import { formatIngestError, type IngestError, toIngestError } from "#lib/ingestError.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result, type ResultAsync } from "#lib/result.js";
import { slackTsFromEpochMs } from "#lib/slackTs.js";
import type { SlackApi, SlackMessagesPage } from "../corpus/slack/fetch.js";
import type { SlackNameMaps } from "../corpus/slack/visibleProse.js";
import { fetchCompleteSlackLane } from "../live/slack/channelPagination.js";
import { parseSlackChannelAddress, type SlackChannelAddress } from "./slackChannelAddress.js";
import { type SlackChannelAnswer, type SlackChannelRead, slackChannelAnswer } from "./slackChannelAnswer.js";
import { type SlackChannelError, SlackChannelErrors } from "./slackChannelErrors.js";

/** How many top-level messages one read takes: one `conversations.history` page. */
const SLACK_CHANNEL_HISTORY_LIMIT = 50;

/** How many conversations one `conversations.list` page asks for — see `fetchCompleteSlackLane` for the measurement. */
const LIST_PAGE_SIZE = 1000;

/** How many near names a not-found answer suggests. */
const MAX_NEAREST = 5;

/** How alike a name must be to be suggested at all (1 is identical). */
const NEAREST_FLOOR = 0.5;

/** The injected edges of one live read. */
export interface SlackChannelDeps {
  readonly api: Pick<SlackApi, "history" | "listChannels" | "workspaceUrl">;
  /** `conversations.info`, which names what an id or link points at and proves the token may read it. */
  readonly info: (args: { channel: string }) => ResultAsync<unknown, IngestError>;
  readonly maps: SlackNameMaps;
  readonly nowMs: () => number;
}

/**
 * Read the channel the owner's words name — a name off their screen, a Slack link, or an id — newest top-level messages first.
 *
 * @param channel what names the channel, as the voice passed it
 * @param deps the Slack read seam, `conversations.info`, the name maps and the clock
 * @param maxBytes the ceiling on the serialised messages
 * @param botToken whether the read runs on the bot token, which sees no private channel it was not invited to
 * @param warnings notices about the read to carry through, such as that bot-token fallback
 * @returns the answer, or the one reason the channel could not be read
 */
export async function readSlackChannel({
  channel,
  deps,
  maxBytes,
  botToken,
  warnings,
}: {
  channel: string;
  deps: SlackChannelDeps;
  maxBytes: number;
  botToken: boolean;
  warnings: readonly string[];
}): Promise<Result<SlackChannelAnswer, SlackChannelError>> {
  const address = parseSlackChannelAddress({ input: channel });
  if (address.isErr()) {
    return err(address.error);
  }
  const resolved = await resolveChannel({ address: address.value, botToken, deps });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const workspace = await workspaceOf({ address: address.value, api: deps.api });
  if (workspace.isErr()) {
    return err(workspace.error);
  }
  const readAtMs = deps.nowMs();
  let page: Awaited<ReturnType<SlackChannelDeps["api"]["history"]>>;
  try {
    page = await deps.api.history({
      channel: resolved.value.id,
      latest: slackTsFromEpochMs({ ms: readAtMs }),
      oldest: "0",
      pageSize: SLACK_CHANNEL_HISTORY_LIMIT,
    });
  } catch (error: unknown) {
    const why = formatIngestError({ error: toIngestError({ error, operation: "slack.conversations.history" }) });
    return err(SlackChannelErrors.historyFailed({ channel: resolved.value.label, why }));
  }
  return ok(
    slackChannelAnswer({
      channel: resolved.value,
      hasMore: olderMessagesExist({ page }),
      maps: deps.maps,
      maxBytes,
      rawMessages: page.messages,
      readAtIso: new Date(readAtMs).toISOString(),
      warnings,
      workspace: workspace.value,
    }),
  );
}

/**
 * Whether a history page leaves older messages unread. Slack's `has_more` and its next cursor can disagree
 * (`live/slack/pagination.ts` refuses that contradiction on a full walk), so EITHER one saying more exist is taken:
 * a window wrongly called the whole channel is the failure this read exists to avoid.
 *
 * @param page the one `conversations.history` page read
 * @returns true when Slack's flag or a non-empty next cursor says older messages exist
 */
export function olderMessagesExist({ page }: { page: SlackMessagesPage }): boolean {
  const cursor = page.nextCursor;
  return page.hasMore === true || (cursor !== undefined && cursor.length > 0);
}

/** Which channel an address names, read live: by an exact name off the channel list, or by `conversations.info`. */
async function resolveChannel({
  address,
  deps,
  botToken,
}: {
  address: SlackChannelAddress;
  deps: SlackChannelDeps;
  botToken: boolean;
}): Promise<Result<SlackChannelRead, SlackChannelError>> {
  if (address.kind === "id") {
    const info = await deps.info({ channel: address.channel });
    if (info.isErr()) {
      return err(
        SlackChannelErrors.infoFailed({ channel: address.channel, why: formatIngestError({ error: info.error }) }),
      );
    }
    return channelFromInfo({ body: info.value, channel: address.channel, maps: deps.maps });
  }
  const listed = await fetchCompleteSlackLane({ api: deps.api, lane: "channels-and-dms", pageSize: LIST_PAGE_SIZE });
  if (listed.isErr()) {
    return err(SlackChannelErrors.listFailed({ why: listed.error.message }));
  }
  const named = listed.value.channels.filter(
    (ref) => ref.isIm !== true && ref.isMpim !== true && ref.name !== undefined,
  );
  const exact = named.filter((ref) => ref.name!.toLowerCase() === address.name);
  const [only, second] = exact;
  if (only === undefined) {
    const nearest = nearestNames({ name: address.name, names: named.map((ref) => ref.name!) });
    return err(SlackChannelErrors.notFound({ botToken, name: address.name, nearest }));
  }
  if (second !== undefined) {
    return err(SlackChannelErrors.ambiguous({ count: exact.length, name: address.name }));
  }
  return ok({
    id: only.id,
    isArchived: only.isArchived === true,
    isPrivate: only.isPrivate === true,
    label: `#${only.name!}`,
  });
}

/**
 * The channel a `conversations.info` answer describes. A DM is named by the person in it, from the local member rows;
 * a body naming no conversation is a failure, never a channel with no name.
 */
function channelFromInfo({
  body,
  channel,
  maps,
}: {
  body: unknown;
  channel: string;
  maps: SlackNameMaps;
}): Result<SlackChannelRead, SlackChannelError> {
  const described = isRecord(body) ? body["channel"] : undefined;
  if (!isRecord(described)) {
    return err(SlackChannelErrors.infoFailed({ channel, why: "Slack's answer described no conversation" }));
  }
  const flags = {
    isArchived: described["is_archived"] === true,
    isPrivate: described["is_private"] === true,
  };
  if (described["is_im"] === true) {
    const user = typeof described["user"] === "string" ? maps.userNames[described["user"]] : undefined;
    const label = user === undefined ? "a DM" : `a DM with ${user}`;
    return ok({ ...flags, id: channel, isPrivate: true, label });
  }
  if (described["is_mpim"] === true) {
    return ok({ ...flags, id: channel, isPrivate: true, label: "a group DM" });
  }
  const name = described["name"];
  if (typeof name !== "string" || name.length === 0) {
    return err(SlackChannelErrors.infoFailed({ channel, why: "Slack's answer named no channel" }));
  }
  return ok({ ...flags, id: channel, label: `#${name}` });
}

/** The workspace origin permalinks are built on: the link's own, else the token's, off `auth.test`. */
async function workspaceOf({
  address,
  api,
}: {
  address: SlackChannelAddress;
  api: Pick<SlackApi, "workspaceUrl">;
}): Promise<Result<string, SlackChannelError>> {
  if (address.kind === "id" && address.workspace !== undefined) {
    return ok(address.workspace);
  }
  let url: string | undefined;
  try {
    url = await api.workspaceUrl();
  } catch (error: unknown) {
    return err(
      SlackChannelErrors.workspaceUnknown({
        why: formatIngestError({ error: toIngestError({ error, operation: "slack.auth.test" }) }),
      }),
    );
  }
  if (url === undefined) {
    return err(SlackChannelErrors.workspaceUnknown({ why: "auth.test answered with no url" }));
  }
  return ok(new URL(url).origin);
}

/**
 * The names closest to one that matched nothing, closest first — suggestions only.
 *
 * @param name the name the owner named, lowercased
 * @param names every channel name the token can see
 * @returns at most {@link MAX_NEAREST}, each at least {@link NEAREST_FLOOR} alike, or containing the name whole
 */
export function nearestNames({ name, names }: { name: string; names: readonly string[] }): readonly string[] {
  return [...new Set(names)]
    .map((candidate) => {
      const lower = candidate.toLowerCase();
      const contains = lower.includes(name) || name.includes(lower);
      return { candidate, score: contains ? 1 : stringSimilarity({ left: name, right: lower }) };
    })
    .filter((entry) => entry.score >= NEAREST_FLOOR)
    .toSorted((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))
    .slice(0, MAX_NEAREST)
    .map((entry) => entry.candidate);
}
