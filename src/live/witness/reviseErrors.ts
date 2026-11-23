/**
 * The witness journal's revision domain: why `witness revise` refused to strike the bot's own posted witness reply,
 * or failed part-way. Its own union, per `.claude/rules/error-handling.md` — a revision never fails with a settle's
 * or a dispatch's code.
 */
import type { WitnessJournalError } from "./errors.js";
import type { WitnessOutcome } from "./types.js";

/** Why `witness revise` refused or failed. */
export type WitnessReviseError =
  | { readonly code: "WITNESS_UNKNOWN"; readonly message: string; readonly witnessId: string }
  | { readonly code: "ALREADY_REVISED"; readonly message: string; readonly witnessId: string }
  | {
      readonly code: "WITNESS_NOT_POSTED";
      readonly message: string;
      readonly witnessId: string;
      readonly outcome: WitnessOutcome | "live";
    }
  | { readonly code: "POSTED_TS_MISSING"; readonly message: string; readonly witnessId: string }
  | { readonly code: "REVISE_LOCKED"; readonly message: string }
  | { readonly code: "JOURNAL"; readonly message: string; readonly cause: WitnessJournalError }
  | { readonly code: "CORRECTION_NOT_APPLIED"; readonly message: string; readonly exitCode: number }
  | { readonly code: "REVISION_RECORD_FAILED"; readonly message: string; readonly cause: WitnessJournalError };

/** Factories for {@link WitnessReviseError}. */
export const WitnessReviseErrors = {
  alreadyRevised: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "ALREADY_REVISED",
      message:
        `witness ${witnessId} was already revised once — the bot corrects itself at most once in a team thread, ` +
        "then lets the team run",
      witnessId,
    }) as const satisfies WitnessReviseError,
  correctionNotApplied: ({ exitCode }: { exitCode: number }) =>
    ({
      code: "CORRECTION_NOT_APPLIED",
      exitCode,
      message: "the correction did not land (its refusal is printed above), so nothing was journalled",
    }) as const satisfies WitnessReviseError,
  journal: ({ cause }: { cause: WitnessJournalError }) =>
    ({ cause, code: "JOURNAL", message: cause.message }) as const satisfies WitnessReviseError,
  locked: ({ reason }: { reason: string }) =>
    ({
      code: "REVISE_LOCKED",
      message: `a witness dispatch, settle or revise is in progress on this home, so nothing was changed — run it again once that finishes: ${reason}`,
    }) as const satisfies WitnessReviseError,
  notPosted: ({ outcome, witnessId }: { outcome: WitnessOutcome | "live"; witnessId: string }) =>
    ({
      code: "WITNESS_NOT_POSTED",
      message: `witness ${witnessId} is ${outcome}, not posted — only a witness reply the bot posted can be revised`,
      outcome,
      witnessId,
    }) as const satisfies WitnessReviseError,
  postedTsMissing: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "POSTED_TS_MISSING",
      message: `witness ${witnessId} settled posted with no posted ts, so there is no reply to aim the correction at`,
      witnessId,
    }) as const satisfies WitnessReviseError,
  recordFailed: ({ cause }: { cause: WitnessJournalError }) =>
    ({
      cause,
      code: "REVISION_RECORD_FAILED",
      message:
        "the correction landed in Slack and was read back, but journalling it failed — run the IDENTICAL command " +
        `again: it finds the same correction already shown and records it: ${cause.message}`,
    }) as const satisfies WitnessReviseError,
  unknown: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "WITNESS_UNKNOWN",
      message: `no witness ${witnessId} in the journal — slopweaver witness list shows the ones this home holds`,
      witnessId,
    }) as const satisfies WitnessReviseError,
} as const;
