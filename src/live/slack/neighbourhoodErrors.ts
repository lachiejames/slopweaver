/**
 * Typed discriminated-union domain errors for the two modules that read a raw
 * `conversations.history`/`conversations.replies` row set — `live/slack/neighbourhood.ts`, the bounded
 * channel-context layer around a thread parent, and `review/slackNeighbourhood.ts`, which judges the same
 * rows with the exact pull-request matcher. It sits beside `errors.ts` rather than inside it for the same
 * reason `downloadErrors.ts` does: one union with two readers is its own seam.
 *
 * See `.claude/rules/error-handling.md` for the shape; each factory computes its own `message` so a call
 * site never hand-assembles the string a reader ultimately sees.
 */

/** A `conversations.history` row was not an object. */
export interface NeighbourhoodMalformedRowError {
  readonly code: "MALFORMED_ROW";
  readonly message: string;
}

/** A row carried no `ts`. */
export interface NeighbourhoodMissingTsError {
  readonly code: "MISSING_TS";
  readonly message: string;
}

/** A row carried a `ts` that is not a Slack timestamp, so no instant can be read off it. */
export interface NeighbourhoodUnreadableTsError {
  readonly code: "UNREADABLE_TS";
  readonly message: string;
  readonly ts: string;
}

/** The same `ts` appeared twice in the channel history. */
export interface NeighbourhoodDuplicateMessageError {
  readonly code: "DUPLICATE_MESSAGE";
  readonly message: string;
  readonly ts: string;
}

/** `channelAround` was not a non-negative safe integer. */
export interface NeighbourhoodInvalidAroundError {
  readonly code: "INVALID_AROUND";
  readonly message: string;
  readonly around: number;
}

/** The thread parent is not present in the complete channel history. */
export interface NeighbourhoodAnchorNotFoundError {
  readonly code: "ANCHOR_NOT_FOUND";
  readonly message: string;
  readonly anchorTs: string;
}

/** Every failure the two readers of one `conversations.history`/`.replies` row set can produce. */
export type SlackNeighbourhoodError =
  | NeighbourhoodMalformedRowError
  | NeighbourhoodMissingTsError
  | NeighbourhoodUnreadableTsError
  | NeighbourhoodDuplicateMessageError
  | NeighbourhoodInvalidAroundError
  | NeighbourhoodAnchorNotFoundError;

/** Factories for every {@link SlackNeighbourhoodError} variant. */
export const SlackNeighbourhoodErrors = {
  anchorNotFound: ({ anchorTs }: { anchorTs: string }): NeighbourhoodAnchorNotFoundError => ({
    anchorTs,
    code: "ANCHOR_NOT_FOUND",
    message: `thread parent ${anchorTs} is not present in the complete channel history`,
  }),
  duplicateMessage: ({ ts }: { ts: string }): NeighbourhoodDuplicateMessageError => ({
    code: "DUPLICATE_MESSAGE",
    message: `channel history returned duplicate message ${ts}`,
    ts,
  }),
  invalidAround: ({ around }: { around: number }): NeighbourhoodInvalidAroundError => ({
    around,
    code: "INVALID_AROUND",
    message: `channel around must be a non-negative safe integer, got ${String(around)}`,
  }),
  malformedRow: (): NeighbourhoodMalformedRowError => ({
    code: "MALFORMED_ROW",
    message: "channel history contained a non-object message row",
  }),
  missingTs: (): NeighbourhoodMissingTsError => ({
    code: "MISSING_TS",
    message: "channel history contained a message with no ts",
  }),
  unreadableTs: ({ ts }: { ts: string }): NeighbourhoodUnreadableTsError => ({
    code: "UNREADABLE_TS",
    message: `channel history carried \`${ts}\`, which is not a Slack timestamp`,
    ts,
  }),
} as const;
