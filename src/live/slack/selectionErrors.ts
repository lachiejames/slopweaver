/**
 * The typed failures of choosing which messages a read returns (`./selection.ts`, plus `./readThread.ts`'s
 * channel-context selection conflict), split out of `./errors.ts` along its own section so that file stays one a
 * reader can hold. Shape per `.claude/rules/error-handling.md`.
 */

/** `around` was not a non-negative safe integer. */
export interface SelectionInvalidAroundError {
  readonly code: "INVALID_AROUND";
  readonly message: string;
  readonly around: number;
}

/** The thread has no first parent message to select around. */
export interface SelectionNoParentMessageError {
  readonly code: "NO_PARENT_MESSAGE";
  readonly message: string;
}

/** The addressed anchor timestamp is not present in the complete thread. */
export interface SelectionAnchorNotFoundError {
  readonly code: "ANCHOR_NOT_FOUND";
  readonly message: string;
  readonly anchorTs: string;
}

/** `--around` and `--since` were both supplied. */
export interface SelectionMutuallyExclusiveError {
  readonly code: "MUTUALLY_EXCLUSIVE_SELECTION";
  readonly message: string;
}

/** `--channel-around` and `--since` were both supplied. */
export interface SelectionChannelConflictError {
  readonly code: "CHANNEL_SELECTION_CONFLICT";
  readonly message: string;
}

/** Every failure `src/live/slack/selection.ts` (and `readThread.ts`'s channel-context selection) can produce. */
export type SlackSelectionError =
  | SelectionInvalidAroundError
  | SelectionNoParentMessageError
  | SelectionAnchorNotFoundError
  | SelectionMutuallyExclusiveError
  | SelectionChannelConflictError;

/** Factories for every {@link SlackSelectionError} variant. */
export const SlackSelectionErrors = {
  anchorNotFound: ({ anchorTs }: { anchorTs: string }): SelectionAnchorNotFoundError => ({
    anchorTs,
    code: "ANCHOR_NOT_FOUND",
    message: `addressed message ${anchorTs} is not present in the complete thread`,
  }),
  channelConflict: (): SelectionChannelConflictError => ({
    code: "CHANNEL_SELECTION_CONFLICT",
    message: "channel around and since are mutually exclusive selections",
  }),
  invalidAround: ({ around }: { around: number }): SelectionInvalidAroundError => ({
    around,
    code: "INVALID_AROUND",
    message: `around must be a non-negative safe integer, got ${String(around)}`,
  }),
  mutuallyExclusive: (): SelectionMutuallyExclusiveError => ({
    code: "MUTUALLY_EXCLUSIVE_SELECTION",
    message: "around and since are mutually exclusive thread selections",
  }),
  noParentMessage: (): SelectionNoParentMessageError => ({
    code: "NO_PARENT_MESSAGE",
    message: "cannot select around a thread with no first parent message",
  }),
} as const;
