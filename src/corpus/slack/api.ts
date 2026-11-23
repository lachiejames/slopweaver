/**
 * The live `@slack/web-api` seam construction — the ONE place a real READ `WebClient` is built. Every
 * factory wraps ONE raw SDK call, routed through {@link safeProviderCall} (the shared 429 block + typed
 * error) and re-surfaced by `orThrow`, so the `fetchSlackActivity` orchestration in `fetch.ts`
 * (channel/thread warnings, fatal discovery) runs against the injected {@link SlackApi} unchanged.
 *
 * ## Why the client surfaces its own rate limits (PR5.2.1b)
 *
 * A default-constructed `WebClient` uses `rejectRateLimitedCalls: false` and a ten-retry policy, so the
 * SDK PAUSES its own queue, sleeps `Retry-After` and retries internally — so a 429 never reaches this
 * program at all. Measured against the real workspace: a ten-minute crawl slice made 633
 * calls and absorbed 29 such 429s, roughly 290 seconds of wall clock, entirely invisibly. Two consequences,
 * both bad: the shared block could never fire for Slack because it never saw a rate limit, and the SDK's
 * ten retries sat UNDER the door's four for a hidden multiplier of up to forty attempts.
 *
 * So the read client opts out of both. `rejectRateLimitedCalls: true` makes a 429 throw
 * `WebAPIRateLimitedError` (carrying `retryAfter`, and a `code` that {@link ../../lib/ingestError} must
 * know — it has no `status`), and `retries: 0` leaves the attempt budget to the one place that owns it. The
 * POSTING client in `writeApi.ts` is deliberately NOT changed by this: its at-most-once guarantee is
 * argued from a `retries: 0` client plus `retryMode: "never"`, and is left exactly as PR5.1 left it.
 */
import { WebClient } from "@slack/web-api";

import { absentAsEmpty } from "#lib/absent.js";
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { SDK_REPLACEMENT_ATTEMPTS, safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { SlackApi } from "./fetch.js";
import { SLACK_LANE_TYPES } from "./lanes.js";
import { slackNextCursor, slackScopesFromMetadata } from "./responseMetadata.js";
// `conversations.history` does NOT use PAGE_LIMIT. Its 999 is the oracle's own number and is defined beside
// the measurement that justifies it — see `./threadOracle.ts`.
import { HISTORY_PAGE_LIMIT } from "./threadOracle.js";

/** The Slack API page size when a per-lane {@link fetch.fetchSlackActivity} cap does not request a smaller one. */
const PAGE_LIMIT = 200;

/** What every read factory needs: the client to call through, and the workspace the quota is counted against. */
interface SlackSeam {
  readonly client: WebClient;
  readonly scopeId: string;
}

/** The live `conversations.history` seam method. */
function slackHistory({ client, scopeId }: SlackSeam): SlackApi["history"] {
  // A caller whose lane cap asks for no smaller page reads the oracle's own page size.
  return async ({
    channel,
    oldest,
    latest,
    cursor,
    pageSize = HISTORY_PAGE_LIMIT,
    inclusive,
    includeAllMetadata,
    paced,
  }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.conversations.history({
            channel,
            latest,
            limit: pageSize,
            oldest,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(inclusive === true ? { inclusive: true } : {}),
            ...(includeAllMetadata === true ? { include_all_metadata: true } : {}),
          }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.conversations.history",
        paced: paced === true,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return {
      messages: absentAsEmpty({ value: res.messages }),
      ...(typeof res.has_more === "boolean" ? { hasMore: res.has_more } : {}),
      ...slackNextCursor({ metadata: res.response_metadata }),
    };
  };
}

/** The live `conversations.list` seam method — ONE lane per call, never the whole type set at once. */
function slackListChannels({ client, scopeId }: SlackSeam): SlackApi["listChannels"] {
  return async ({ lane, cursor, pageSize = PAGE_LIMIT }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.conversations.list({
            // ARCHIVED CHANNELS INCLUDED, deliberately. `exclude_archived: true` was the connector's single
            // largest reach gap: MEASURED, the workspace holds 126 archived conversations, every
            // sampled one of which answers `conversations.history` for the user token — a fifth of everything
            // reachable, invisible to the corpus not because the token was refused but because discovery
            // never asked. A finished project's channel is archived precisely BECAUSE the work concluded,
            // which is what makes it worth reading.
            exclude_archived: false,
            limit: pageSize,
            // ONE lane. Asking for every type at once returns FEWER conversations than asking twice: with
            // `public_channel` in the list Slack serves zero `mpim` rows, to exhaustion. The measurement,
            // and why the caller pages each lane separately, is in `./lanes.ts`.
            types: SLACK_LANE_TYPES[lane],
            ...(cursor !== undefined ? { cursor } : {}),
          }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.conversations.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return {
      channels: absentAsEmpty({ value: res.channels }),
      ...slackNextCursor({ metadata: res.response_metadata }),
    };
  };
}

/** The live `users.list` seam method. */
function slackListUsers({ client, scopeId }: SlackSeam): SlackApi["listUsers"] {
  return async ({ cursor, pageSize = PAGE_LIMIT }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () => client.users.list({ limit: pageSize, ...(cursor !== undefined ? { cursor } : {}) }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.users.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return { members: absentAsEmpty({ value: res.members }), ...slackNextCursor({ metadata: res.response_metadata }) };
  };
}

/** The live `conversations.replies` seam method. */
function slackReplies({ client, scopeId }: SlackSeam): SlackApi["replies"] {
  return async ({ channel, ts, oldest, cursor, pageSize = PAGE_LIMIT, includeAllMetadata }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.conversations.replies({
            channel,
            limit: pageSize,
            oldest,
            ts,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(includeAllMetadata === true ? { include_all_metadata: true } : {}),
          }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.conversations.replies",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return {
      messages: absentAsEmpty({ value: res.messages }),
      ...(typeof res.has_more === "boolean" ? { hasMore: res.has_more } : {}),
      ...slackNextCursor({ metadata: res.response_metadata }),
    };
  };
}

/**
 * The live `files.info` seam method — an id to its metadata, and to a huddle's words when asked.
 *
 * `tier4` in `OPERATION_ENDPOINT_CLASS`, which is absent from `PACED_CLASSES`, so this is not throttled by
 * the registry. That is right for it: a thread references a handful of block-only files at most (MEASURED: a
 * handful of ids across well over a hundred thousand messages), and `blockFiles.ts` calls it serially and de-duplicated. It still waits on
 * the shared 429 block like every other call.
 *
 * The whole `file` object is handed back UNPARSED. Shaping belongs to `live/slack/projection.ts`, which
 * already owns the one set of rules for what a Slack file is, and duplicating any of them here is how the two
 * would drift.
 *
 * ## Why `apiCall` rather than `client.files.info`
 *
 * `include_transcription` is a REAL argument the Slack web client sends and `@slack/web-api` 8.0.0 does not
 * declare — `FilesInfoArguments` is an interface with no index signature, so an object literal carrying it
 * does not compile. `apiCall` is the SDK's own untyped door for exactly this, it is the same door
 * `slopweaver slack probe` measured the argument through, and routing BOTH calls through it keeps one code
 * path rather than a typed one and an untyped one that can drift. The response is read off an `isRecord`
 * guard for the same reason: `WebAPICallResult` declares `ok` and nothing else.
 */
function slackFilesInfo({ client, scopeId }: SlackSeam): SlackApi["filesInfo"] {
  return async ({ fileId, includeTranscription = false }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.apiCall("files.info", {
            file: fileId,
            ...(includeTranscription ? { include_transcription: true } : {}),
          }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.files.info",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return { file: isRecord(res) ? res["file"] : undefined };
  };
}

/** The live `auth.test` → workspace-url seam method. */
function slackWorkspaceUrl({ client, scopeId }: SlackSeam): SlackApi["workspaceUrl"] {
  return async () => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () => client.auth.test(),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.auth.test",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return typeof res.url === "string" && res.url.length > 0 ? res.url : undefined;
  };
}

/**
 * The live `auth.test` → granted-scopes seam method.
 *
 * The same call as {@link slackWorkspaceUrl} reading a different field, and deliberately a separate method
 * rather than a widened return: a consumer that wants the workspace URL should not have to think about
 * scopes, and a scope preflight that failed must be able to return "not established" without also having
 * failed to identify the workspace.
 *
 * A thrown call becomes `undefined`, not an empty list. `read-thread`'s preflight treats those as different
 * claims — see `live/slack/filePlan.ts#scopePreflight` — and collapsing them here would make a diagnostic
 * that timed out indistinguishable from a token Slack says holds nothing.
 */
function slackGrantedScopes({ client, scopeId }: SlackSeam): SlackApi["grantedScopes"] {
  return async () => {
    const result = await safeProviderCall({
      execute: () => client.auth.test(),
      maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
      operation: "slack.auth.test",
      paced: false,
      provider: "slack",
      retryMode: "transient",
      scopeId,
    });
    if (result.isErr()) {
      return undefined;
    }
    return slackScopesFromMetadata({ metadata: result.value.response_metadata });
  };
}

/** The live `pins.list` seam method (curated lane). */
function slackPins({ client, scopeId }: SlackSeam): NonNullable<SlackApi["pins"]> {
  return async ({ channel }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () => client.pins.list({ channel }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.pins.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return { items: absentAsEmpty({ value: res.items }) };
  };
}

/** The live `bookmarks.list` seam method (curated lane). */
function slackBookmarks({ client, scopeId }: SlackSeam): NonNullable<SlackApi["bookmarks"]> {
  return async ({ channel }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () => client.bookmarks.list({ channel_id: channel }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.bookmarks.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return { bookmarks: absentAsEmpty({ value: res.bookmarks }) };
  };
}

/**
 * The live `files.list` seam method (curated canvas-discovery lane). `files.list` uses legacy count/page
 * pagination, not cursors; canvases are few, so we fetch one generous page and surface no next cursor.
 */
function slackFiles({ client, scopeId }: SlackSeam): NonNullable<SlackApi["files"]> {
  return async ({ pageSize = PAGE_LIMIT, cursor, types }) => {
    // `files.list` pages by ORDINAL, so the shared cursor walk's opaque token is this method's page number.
    // See the seam's own docstring for why it is spelled as a cursor rather than as a second primitive.
    const page = cursor === undefined ? 1 : Number(cursor);
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.files.list({
            count: pageSize,
            page,
            ...(types !== undefined ? { types } : {}),
          }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.files.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    const pages = typeof res.paging?.pages === "number" ? res.paging.pages : 1;
    return {
      files: absentAsEmpty({ value: res.files }),
      // Absent on the last page, which is what ends the walk. Returning a cursor unconditionally would spin
      // forever, since page N+1 of an exhausted list answers `ok` with an empty array rather than failing.
      ...(Number.isFinite(page) && page < pages ? { nextCursor: String(page + 1) } : {}),
    };
  };
}

/**
 * The `search.messages` transport, for the review-state read's live Slack leg.
 *
 * It lives here rather than beside its own parser for one reason: this file is the ONE place a real Slack
 * READ client is constructed, so "what can this program talk to?" stays a single-file question. The parsing,
 * the typed failures and the method's own recall caveats are in `../../live/slack/searchMessages.ts`.
 *
 * @param token the Slack USER token — a bot token answers only for channels it was invited to
 * @returns a function taking the query and page size, returning Slack's raw body
 */
export function makeSlackSearchCall({
  token,
}: {
  token: string;
}): (args: { query: string; count: number; page: number }) => ResultAsync<unknown, IngestError> {
  // `search.messages` lives here rather than in its own module for one reason: this file is the ONE place a
  // real Slack READ client is constructed, so "what can this program talk to?" stays a single-file question.
  // Its parsing, its typed failures and its recall caveats live in `../../live/slack/searchMessages.ts`; only
  // the transport is here.
  // devlint: sdk-factory -- the ONE Slack READ client
  const client = new WebClient(token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const scopeId = scopeIdForToken({ token });
  return ({ query, count, page }) =>
    safeProviderCall({
      execute: () => client.search.messages({ count, page, query }),
      maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
      operation: "slack.search.messages",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    });
}

/**
 * The `conversations.info` transport, for `slack unread`'s DM leg: on the owner's USER token a DM answers with Slack's own
 * read marker (`last_read`, `unread_count_display`, `latest`), measured with `slopweaver slack probe
 * --method conversations.info channel=<a D… id> --shape-at channel`. Here for the same reason
 * {@link makeSlackSearchCall} is; the parsing is `../../live/slack/readMarker.ts`.
 *
 * @param token the Slack USER token — the read marker is the token holder's own
 * @returns a function taking one conversation id, returning Slack's raw body
 */
export function makeSlackConversationInfoCall({
  token,
}: {
  token: string;
}): (args: { channel: string }) => ResultAsync<unknown, IngestError> {
  // devlint: sdk-factory -- the ONE Slack READ client
  const client = new WebClient(token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const scopeId = scopeIdForToken({ token });
  return ({ channel }) =>
    safeProviderCall({
      execute: () => client.conversations.info({ channel }),
      maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
      operation: "slack.conversations.info",
      // A read, so off the tier3 write-lane pacing exactly as this file's other reads are: paced, thirty DMs'
      // markers were spaced ~1.5 s apart and a voice call's read ran out of time on the sixth.
      paced: false,
      provider: "slack",
      retryMode: "transient",
      scopeId,
    });
}

/**
 * Build the production Slack seam over a live `WebClient`. The only place a real Slack READ client is
 * constructed; everything else runs against {@link SlackApi}.
 *
 * @param token the Slack bot/user token
 * @returns the live Slack seam
 */
export function makeSlackApi({ token }: { token: string }): SlackApi {
  // `rejectRateLimitedCalls` + `retries: 0`: surface each 429 to the shared block instead of sleeping it
  // off inside the SDK, and leave the attempt budget to `safeProviderCall`. See the module comment.
  // devlint: sdk-factory -- the ONE Slack READ client
  const client = new WebClient(token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const seam: SlackSeam = { client, scopeId: scopeIdForToken({ token }) };
  return {
    bookmarks: slackBookmarks(seam),
    files: slackFiles(seam),
    filesInfo: slackFilesInfo(seam),
    grantedScopes: slackGrantedScopes(seam),
    history: slackHistory(seam),
    listChannels: slackListChannels(seam),
    listUsers: slackListUsers(seam),
    pins: slackPins(seam),
    replies: slackReplies(seam),
    workspaceUrl: slackWorkspaceUrl(seam),
  };
}
