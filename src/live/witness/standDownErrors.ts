/**
 * Why `witness stand-down` refused or failed — its own failure domain beside the journal, dispatch, settle and
 * help unions, per `.claude/rules/error-handling.md`. Every refusal lands before the reaction; a reaction that
 * did not land writes no row, so running the verb again is always the fix.
 */
import type { WitnessJournalError } from "./errors.js";
import type { WitnessOutcome } from "./types.js";

/** Why `witness stand-down` refused or failed. */
export type WitnessStandDownError =
  | { readonly code: "ALREADY_SETTLED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "ALREADY_DISPATCHED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "WHY_BLANK"; readonly message: string }
  | { readonly code: "STAND_DOWN_LOCKED"; readonly message: string }
  | { readonly code: "JOURNAL"; readonly message: string; readonly cause: WitnessJournalError }
  | { readonly code: "REACTION_FAILED"; readonly message: string; readonly emoji: string };

/** Factories for {@link WitnessStandDownError}. */
export const WitnessStandDownErrors = {
  alreadyDispatched: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "ALREADY_DISPATCHED",
      message:
        `witness ${witnessId} has a worker checking that message's claim — a stand-down row would settle the live ` +
        "worker's record; settle it first, then stand down",
      witnessId,
    }) as const satisfies WitnessStandDownError,
  alreadySettled: ({ outcome, witnessId }: { outcome: WitnessOutcome; witnessId: string }) =>
    ({
      code: "ALREADY_SETTLED",
      message:
        `witness ${witnessId} already ended ${outcome}, so it cannot carry a reaction and a row — when that ` +
        "message is the one that told the bot it was in the way, stand the WHOLE THREAD down instead: run it " +
        "again without --message-ts, which journals the stand-down on the thread and reacts on nothing",
      witnessId,
    }) as const satisfies WitnessStandDownError,
  journal: ({ cause }: { cause: WitnessJournalError }) =>
    ({ cause, code: "JOURNAL", message: cause.message }) as const satisfies WitnessStandDownError,
  locked: ({ reason }: { reason: string }) =>
    ({
      code: "STAND_DOWN_LOCKED",
      message: `a witness dispatch, settle, help or stand-down is in progress on this home, so nothing was reacted or recorded — run it again once that finishes: ${reason}`,
    }) as const satisfies WitnessStandDownError,
  reactionFailed: ({ emoji, why }: { emoji: string; why: string }) =>
    ({
      code: "REACTION_FAILED",
      emoji,
      message:
        `Slack did not put :${emoji}: on the message (${why}), so no stand-down was recorded and the thread is still witnessed — ` +
        "run it again; an `invalid_name` means the workspace lacks that emoji, so point " +
        "profile.json slackBot.standDownReaction.emoji at one it has; a `message_not_found` means the message is " +
        "gone, so stand the whole thread down instead by running it without --message-ts",
    }) as const satisfies WitnessStandDownError,
  whyBlank: () =>
    ({
      code: "WHY_BLANK",
      message:
        "a stand-down needs a non-blank why — the row silences a whole thread, and the journal's reader refuses one " +
        "that cannot say why, which would make every witness verb refuse the journal",
    }) as const satisfies WitnessStandDownError,
} as const;
