/**
 * The typed failures of the complete-or-fail alert-channel window read (`./alertSource.ts`), split out of
 * `./errors.ts` along its own section so that file stays one a reader can hold. Shape per
 * `.claude/rules/error-handling.md`.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** The channel id does not resolve — wrong id, or a private channel the token was never invited to. */
export interface AlertSourceChannelNotFoundError {
  readonly code: "CHANNEL_NOT_FOUND";
  readonly message: string;
  readonly channel: string;
}

/** The token's identity is not a member of the channel. */
export interface AlertSourceNotInChannelError {
  readonly code: "NOT_IN_CHANNEL";
  readonly message: string;
  readonly channel: string;
}

/** `conversations.history` threw for a reason other than the two above. */
export interface AlertSourceReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly channel: string;
  readonly cause?: unknown;
}

/** The same pagination cursor was handed back twice. */
export interface AlertSourceCursorRepeatedError {
  readonly code: "CURSOR_REPEATED";
  readonly message: string;
}

/** The window is wider than one read can prove complete. */
export interface AlertSourceWindowTooLargeError {
  readonly code: "WINDOW_TOO_LARGE";
  readonly message: string;
}

/** Every failure `src/live/slack/alertSource.ts` can produce. */
export type AlertSourceError =
  | AlertSourceChannelNotFoundError
  | AlertSourceNotInChannelError
  | AlertSourceReadFailedError
  | AlertSourceCursorRepeatedError
  | AlertSourceWindowTooLargeError;

/** Factories for every {@link AlertSourceError} variant. */
export const AlertSourceErrors = {
  channelNotFound: ({ channel }: { channel: string }): AlertSourceChannelNotFoundError => ({
    channel,
    code: "CHANNEL_NOT_FOUND",
    message:
      `no channel ${channel}: check the id, or invite the token's identity to it — a private channel is ` +
      "channel_not_found rather than a permission error when you are not in it",
  }),
  cursorRepeated: ({ channel }: { channel: string }): AlertSourceCursorRepeatedError => ({
    code: "CURSOR_REPEATED",
    message: `Slack repeated a pagination cursor on ${channel}; refusing a possibly partial window`,
  }),
  notInChannel: ({ channel }: { channel: string }): AlertSourceNotInChannelError => ({
    channel,
    code: "NOT_IN_CHANNEL",
    message: `the token's identity is not in ${channel}; invite it, then re-run`,
  }),
  readFailed: ({ channel, cause }: { channel: string; cause: unknown }): AlertSourceReadFailedError => ({
    cause,
    channel,
    code: "READ_FAILED",
    message: `reading ${channel} failed: ${errorMessage({ error: cause })}`,
  }),
  windowTooLarge: ({
    channel,
    maxMessages,
  }: {
    channel: string;
    maxMessages: number;
  }): AlertSourceWindowTooLargeError => ({
    code: "WINDOW_TOO_LARGE",
    message:
      `${channel} carries more than ${String(maxMessages)} messages in this window, which is more than one read ` +
      "can prove complete. Narrow --window and run it again — a partial window would report counts that look " +
      "authoritative and are wrong by an unknown amount.",
  }),
} as const;
