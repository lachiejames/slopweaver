/**
 * Typed discriminated-union domain errors for `src/live/slack/**` — see `.claude/rules/error-handling.md`
 * for the shape. One file, sectioned by the module each union belongs to; each factory computes its own
 * `message` so a call site never hand-assembles the string a reader ultimately sees.
 *
 * `alertWindow.ts` and `fileDownloads.ts`'s destination-directory refusal are deliberately NOT every one of
 * their own union — see the module-level comments there for why a plain `readonly string[]` (or, for the
 * latter, a shared variant on {@link SlackFileDownloadError}) was judged the right size.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import type { SlackFileDownloadError } from "./downloadErrors.js";
import type { SlackNeighbourhoodError } from "./neighbourhoodErrors.js";
import type { SlackSelectionError } from "./selectionErrors.js";

// ---------------------------------------------------------------------------------------------------------
// permalink.ts — Slack permalink → thread identity parsing
// ---------------------------------------------------------------------------------------------------------

/** The text was not a URL at all. */
export interface PermalinkNotAUrlError {
  readonly code: "NOT_A_URL";
  readonly message: string;
}

/** The URL is real but not `https:`. */
export interface PermalinkNotHttpsError {
  readonly code: "NOT_HTTPS";
  readonly message: string;
}

/** The host is not a `*.slack.com` workspace. */
export interface PermalinkNotSlackHostError {
  readonly code: "NOT_SLACK_HOST";
  readonly message: string;
}

/** The path is not `/archives/<id>/p<ts>`. */
export interface PermalinkMalformedError {
  readonly code: "MALFORMED_PERMALINK";
  readonly message: string;
}

/** The path's conversation segment is not a `C`/`G`/`D` id. */
export interface PermalinkInvalidConversationIdError {
  readonly code: "INVALID_CONVERSATION_ID";
  readonly message: string;
}

/** The `p<ts>` path segment is not a permalink timestamp. */
export interface PermalinkInvalidTimestampError {
  readonly code: "INVALID_PERMALINK_TIMESTAMP";
  readonly message: string;
}

/** The link's `cid` query param disagrees with its own path channel. */
export interface PermalinkSelfContradictsError {
  readonly code: "LINK_SELF_CONTRADICTS";
  readonly message: string;
}

/** The `thread_ts` query param is not a Slack timestamp. */
export interface PermalinkInvalidThreadTsError {
  readonly code: "INVALID_THREAD_TS";
  readonly message: string;
}

/** Every failure `src/live/slack/permalink.ts` can produce. */
export type SlackPermalinkError =
  | PermalinkNotAUrlError
  | PermalinkNotHttpsError
  | PermalinkNotSlackHostError
  | PermalinkMalformedError
  | PermalinkInvalidConversationIdError
  | PermalinkInvalidTimestampError
  | PermalinkSelfContradictsError
  | PermalinkInvalidThreadTsError;

/** Factories for every {@link SlackPermalinkError} variant. */
export const SlackPermalinkErrors = {
  invalidConversationId: ({ channel }: { channel: string }): PermalinkInvalidConversationIdError => ({
    code: "INVALID_CONVERSATION_ID",
    message: `not a Slack conversation id: ${channel}`,
  }),
  invalidPermalinkTimestamp: ({ segment }: { segment: string }): PermalinkInvalidTimestampError => ({
    code: "INVALID_PERMALINK_TIMESTAMP",
    message: `not a Slack permalink timestamp: ${segment}`,
  }),
  invalidThreadTs: ({ threadParam }: { threadParam: string }): PermalinkInvalidThreadTsError => ({
    code: "INVALID_THREAD_TS",
    message: `thread_ts is not a Slack timestamp: ${threadParam}`,
  }),
  malformed: ({ pathname }: { pathname: string }): PermalinkMalformedError => ({
    code: "MALFORMED_PERMALINK",
    message: `not a Slack message permalink (expected /archives/<id>/p<ts>): ${pathname}`,
  }),
  notAUrl: ({ text }: { text: string }): PermalinkNotAUrlError => ({
    code: "NOT_A_URL",
    message: `not a URL: ${text}`,
  }),
  notHttps: ({ protocol }: { protocol: string }): PermalinkNotHttpsError => ({
    code: "NOT_HTTPS",
    message: `Slack permalinks are https; got ${protocol}//`,
  }),
  notSlackHost: ({ hostname }: { hostname: string }): PermalinkNotSlackHostError => ({
    code: "NOT_SLACK_HOST",
    message: `not a Slack host: ${hostname}`,
  }),
  selfContradicts: ({ channel, cid }: { channel: string; cid: string }): PermalinkSelfContradictsError => ({
    code: "LINK_SELF_CONTRADICTS",
    message: `link disagrees with itself: path channel ${channel}, cid ${cid}`,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// pagination.ts — the complete-or-fail thread/history/channel-discovery cursor walk
// ---------------------------------------------------------------------------------------------------------

/** Slack reported `has_more` but supplied no cursor to fetch the rest with. */
export interface PageCursorContradictionError {
  readonly code: "CURSOR_CONTRADICTION";
  readonly message: string;
}

/** The same pagination cursor was handed back twice — a walk that would spin forever. */
export interface PageCursorRepeatedError {
  readonly code: "CURSOR_REPEATED";
  readonly message: string;
}

/** The walk exceeded its page ceiling before the cursor exhausted. */
export interface PageCeilingExceededError {
  readonly code: "PAGE_CEILING_EXCEEDED";
  readonly message: string;
}

/** `conversations.replies` says the thread does not exist — deleted, or invisible to this token. */
export interface PageThreadNotFoundError {
  readonly code: "THREAD_NOT_FOUND";
  readonly message: string;
  readonly channel: string;
  readonly threadTs: string;
}

/** `conversations.history` says the channel does not exist, or this token cannot see it. */
export interface PageChannelNotFoundError {
  readonly code: "CHANNEL_NOT_FOUND";
  readonly message: string;
  readonly channel: string;
}

/**
 * The channel exists and this token can see it, but the bot is not a MEMBER, so it may not read a single
 * message from it.
 *
 * Separated from {@link PageChannelNotFoundError} and from {@link PageFetchFailedError} because it is a
 * different KIND of failure from either: not a transient fault to retry, and not a channel that has gone
 * away. It is a standing membership fact that will answer identically on every future call until a human
 * invites the bot — so a caller judging its own completeness must be able to tell it apart from a read that
 * merely failed this time. Measured consequence of NOT telling them apart: the scheduled recovery sweep's
 * watermark sat pinned at one instant for six days, because one unjoined channel made every sweep
 * `partial` and a partial sweep advances nothing.
 */
export interface PageNotInChannelError {
  readonly code: "NOT_IN_CHANNEL";
  readonly message: string;
  readonly channel: string;
}

/** The provider call itself threw, for a reason other than the two named above. */
export interface PageFetchFailedError {
  readonly code: "PAGE_FETCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every failure `src/live/slack/pagination.ts` can produce. */
export type SlackPageError =
  | PageCursorContradictionError
  | PageCursorRepeatedError
  | PageCeilingExceededError
  | PageThreadNotFoundError
  | PageChannelNotFoundError
  | PageNotInChannelError
  | PageFetchFailedError;

/** Factories for every {@link SlackPageError} variant. */
export const SlackPageErrors = {
  channelNotFound: ({ channel, reason }: { channel: string; reason: string }): PageChannelNotFoundError => ({
    channel,
    code: "CHANNEL_NOT_FOUND",
    message: `${channel} is not readable by this token — it does not exist, or the token cannot see it: ${reason}`,
  }),
  notInChannel: ({ channel }: { channel: string }): PageNotInChannelError => ({
    channel,
    code: "NOT_IN_CHANNEL",
    message:
      `this bot is not a member of ${channel}, so it cannot read one message from it — invite it, or accept ` +
      "that the channel is out of scope; retrying will answer the same way every time",
  }),
  cursorContradiction: (): PageCursorContradictionError => ({
    code: "CURSOR_CONTRADICTION",
    message: "Slack reported has_more with no pagination cursor; cannot prove the Slack read is complete",
  }),
  cursorRepeated: ({ where }: { where: string }): PageCursorRepeatedError => ({
    code: "CURSOR_REPEATED",
    message: `Slack repeated ${where}; refusing a possibly partial read`,
  }),
  pageCeilingExceeded: ({ where, maxPages }: { where: string; maxPages: number }): PageCeilingExceededError => ({
    code: "PAGE_CEILING_EXCEEDED",
    message: `${where} exceeded ${String(maxPages)} pages; refusing a possibly partial read`,
  }),
  pageFetchFailed: ({ context, cause }: { context: string; cause: unknown }): PageFetchFailedError => ({
    cause,
    code: "PAGE_FETCH_FAILED",
    message: `${context} failed: ${errorMessage({ error: cause })}`,
  }),
  threadNotFound: ({ channel, threadTs }: { channel: string; threadTs: string }): PageThreadNotFoundError => ({
    channel,
    code: "THREAD_NOT_FOUND",
    message: `no thread at ${threadTs} in ${channel}: the message was deleted, or this token cannot see that conversation`,
    threadTs,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// projection.ts — raw Slack rows → the visible thread, refusing anything unprojectable
// ---------------------------------------------------------------------------------------------------------

/** A visible-content field (`files`/`blocks`/`attachments`) was present but not an array. */
export interface ProjectionNonArrayFieldError {
  readonly code: "NON_ARRAY_FIELD";
  readonly message: string;
  readonly field: string;
}

/** A `files` array entry was not an object. */
export interface ProjectionNonObjectFileEntryError {
  readonly code: "NON_OBJECT_FILE_ENTRY";
  readonly message: string;
}

/** A file entry carried no usable `id`. */
export interface ProjectionFileMissingIdError {
  readonly code: "FILE_MISSING_ID";
  readonly message: string;
}

/** A message's `text` field was present but not a string. */
export interface ProjectionNonStringTextError {
  readonly code: "NON_STRING_TEXT";
  readonly message: string;
}

/** A row in the fetched thread was not an object. */
export interface ProjectionNonObjectMessageRowError {
  readonly code: "NON_OBJECT_MESSAGE_ROW";
  readonly message: string;
}

/** A row carried no `ts`. */
export interface ProjectionMessageMissingTsError {
  readonly code: "MESSAGE_MISSING_TS";
  readonly message: string;
}

/**
 * A row's `ts` is present but is not a Slack timestamp, so no instant can be derived from it.
 *
 * Separate from {@link ProjectionMessageMissingTsError}: absent and unusable are different provider
 * behaviours, and only one of them means the read itself is wrong. Refusing is the honest answer either way
 * — the alternative was emitting an empty `tsIso` beside a real message, which reads as "posted at nothing".
 */
export interface ProjectionUnusableTsError {
  readonly code: "UNUSABLE_TS";
  readonly message: string;
  readonly ts: string;
}

/** A row's own `thread_ts` names a different thread than the one being read. */
export interface ProjectionWrongThreadError {
  readonly code: "WRONG_THREAD";
  readonly message: string;
  readonly ts: string;
  readonly rowThreadTs: string;
  readonly expectedThreadTs: string;
}

/** The same (non-parent) `ts` appeared twice across the fetched pages. */
export interface ProjectionDuplicateMessageError {
  readonly code: "DUPLICATE_MESSAGE";
  readonly message: string;
  readonly ts: string;
}

/** The fetched rows never included the thread's own parent message. */
export interface ProjectionMissingParentError {
  readonly code: "MISSING_PARENT";
  readonly message: string;
  readonly threadTs: string;
}

/** Every failure `src/live/slack/projection.ts` can produce. */
export type SlackProjectionError =
  | ProjectionNonArrayFieldError
  | ProjectionNonObjectFileEntryError
  | ProjectionFileMissingIdError
  | ProjectionNonStringTextError
  | ProjectionNonObjectMessageRowError
  | ProjectionMessageMissingTsError
  | ProjectionUnusableTsError
  | ProjectionWrongThreadError
  | ProjectionDuplicateMessageError
  | ProjectionMissingParentError;

/** Factories for every {@link SlackProjectionError} variant. */
export const SlackProjectionErrors = {
  duplicateMessage: ({ ts }: { ts: string }): ProjectionDuplicateMessageError => ({
    code: "DUPLICATE_MESSAGE",
    message: `thread returned duplicate message ${ts}`,
    ts,
  }),
  fileMissingId: (): ProjectionFileMissingIdError => ({
    code: "FILE_MISSING_ID",
    message: "a message carried an attachment with no id, which cannot be fetched or reported",
  }),
  messageMissingTs: (): ProjectionMessageMissingTsError => ({
    code: "MESSAGE_MISSING_TS",
    message: "thread contained a message with no ts",
  }),
  missingParent: ({ threadTs }: { threadTs: string }): ProjectionMissingParentError => ({
    code: "MISSING_PARENT",
    message: `thread ${threadTs} did not return its parent message`,
    threadTs,
  }),
  nonArrayField: ({ field }: { field: string }): ProjectionNonArrayFieldError => ({
    code: "NON_ARRAY_FIELD",
    field,
    message: `a message carried a non-array \`${field}\` value; refusing to silently drop its content`,
  }),
  nonObjectFileEntry: (): ProjectionNonObjectFileEntryError => ({
    code: "NON_OBJECT_FILE_ENTRY",
    message: "a message carried a non-object entry in its files array",
  }),
  nonObjectMessageRow: (): ProjectionNonObjectMessageRowError => ({
    code: "NON_OBJECT_MESSAGE_ROW",
    message: "thread contained a non-object message row",
  }),
  nonStringText: (): ProjectionNonStringTextError => ({
    code: "NON_STRING_TEXT",
    message: "a message carried a non-string `text` value; refusing to silently blank it",
  }),
  unusableTs: ({ ts }: { ts: string }): ProjectionUnusableTsError => ({
    code: "UNUSABLE_TS",
    message: `a message's ts \`${ts}\` is not a Slack timestamp, so it names no instant`,
    ts,
  }),
  wrongThread: ({
    ts,
    rowThreadTs,
    expectedThreadTs,
  }: {
    ts: string;
    rowThreadTs: string;
    expectedThreadTs: string;
  }): ProjectionWrongThreadError => ({
    code: "WRONG_THREAD",
    expectedThreadTs,
    message: `message ${ts} belongs to thread ${rowThreadTs}, not ${expectedThreadTs}`,
    rowThreadTs,
    ts,
  }),
} as const;

// blockFiles.ts's `files.info` failures live in `./fileLookupErrors.ts`.

// ---------------------------------------------------------------------------------------------------------
// readThread.ts — resolving the canonical workspace before any output permalink is built
// ---------------------------------------------------------------------------------------------------------

/**
 * `auth.test` resolved with no team URL — the same gap `corpus/slack/fetch.ts`'s `SlackWorkspaceUrlUnresolvedError`
 * refuses on. Refused here too rather than falling back to the caller's pasted host: that fallback is exactly
 * the defect this type exists to make impossible — every permalink this verb hands back must be the provider's
 * own, never a reconstruction of what the caller typed.
 */
export interface ReadThreadWorkspaceUnresolvedError {
  readonly code: "WORKSPACE_URL_UNRESOLVED";
  readonly message: string;
}

/** Every failure resolving the canonical workspace can produce. */
type SlackReadThreadWorkspaceError = ReadThreadWorkspaceUnresolvedError;

export const SlackReadThreadWorkspaceErrors = {
  /**
   * Build a {@link ReadThreadWorkspaceUnresolvedError} — `auth.test` returned no team URL.
   *
   * @returns the typed error
   */
  workspaceUnresolved: (): ReadThreadWorkspaceUnresolvedError => ({
    code: "WORKSPACE_URL_UNRESOLVED",
    message: "could not resolve the workspace URL (auth.test) — check the token scopes",
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// readThread.ts — the composed pipeline; no variants of its own, just the union every stage can produce
// ---------------------------------------------------------------------------------------------------------

/** Every failure `src/live/slack/readThread.ts`'s end-to-end read can produce. */
export type SlackReadThreadError =
  | SlackPermalinkError
  | SlackPageError
  | SlackProjectionError
  | SlackSelectionError
  | SlackNeighbourhoodError
  | SlackFileDownloadError
  | SlackReadThreadWorkspaceError;
