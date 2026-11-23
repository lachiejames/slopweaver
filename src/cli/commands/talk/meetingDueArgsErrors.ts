/**
 * Every way a `talk meeting-due` invocation is refused before the calendar is read — its own union, as `talk unread`'s
 * is (`./unreadArgsErrors.ts`).
 */

/** A flag the tokenizer refused — unknown, or missing its value; the messages are the tokenizer's own. */
export interface MeetingDueFlagsInvalidError {
  readonly code: "MEETING_DUE_FLAGS_INVALID";
  readonly message: string;
}

/** `--now` that is not an instant. */
export interface MeetingDueNowInvalidError {
  readonly code: "MEETING_DUE_NOW_INVALID";
  readonly message: string;
  readonly now: string;
}

/** Every way a `talk meeting-due` invocation is refused. */
export type MeetingDueArgsError = MeetingDueFlagsInvalidError | MeetingDueNowInvalidError;

/** The factories every `talk meeting-due` usage refusal is constructed through. */
export const MeetingDueArgsErrors = {
  flagsInvalid: ({ messages }: { messages: readonly string[] }): MeetingDueFlagsInvalidError => ({
    code: "MEETING_DUE_FLAGS_INVALID",
    message: messages.join("; "),
  }),
  nowInvalid: ({ now }: { now: string }): MeetingDueNowInvalidError => ({
    code: "MEETING_DUE_NOW_INVALID",
    message: `talk meeting-due --now ${now} is not an ISO instant, such as 2026-10-08T23:00:00Z`,
    now,
  }),
} as const;
