/**
 * Three of the witness journal's four failure domains: reading or writing the journal, dispatching a worker,
 * and settling a witness — helping unprompted is the fourth, in `./helpErrors.ts`. Each is its own
 * discriminated union with its own factory, per `.claude/rules/error-handling.md` — a dispatch never fails
 * with a settle's code, nor the reverse.
 *
 * None of these is a POLICY refusal with an escape hatch. A duplicate dispatch, a malformed journal line and a
 * missing `--posted-ts` are facts about state or about the call, and the fix for each is to change the state
 * or the call — never to override it.
 */
import type { WitnessKey, WitnessOutcome } from "./types.js";

/** The journal could not be opened or read at all. */
export interface WitnessJournalUnreadableError {
  readonly code: "JOURNAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** One journal line will not parse — the whole journal is refused, because the skipped row might be the live one. */
export interface WitnessJournalLineMalformedError {
  readonly code: "JOURNAL_LINE_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
}

/** An append to the journal threw. */
export interface WitnessJournalWriteFailedError {
  readonly code: "JOURNAL_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Why the witness journal could not be read or written. */
export type WitnessJournalError =
  WitnessJournalUnreadableError | WitnessJournalLineMalformedError | WitnessJournalWriteFailedError;

/** Factories for {@link WitnessJournalError}. */
export const WitnessJournalErrors = {
  lineMalformed: ({
    detail,
    lineNumber,
    path,
  }: {
    detail: string;
    lineNumber: number;
    path: string;
  }): WitnessJournalLineMalformedError => ({
    code: "JOURNAL_LINE_MALFORMED",
    lineNumber,
    message:
      `witness journal ${path} line ${lineNumber} is malformed (${detail}) — refusing the whole journal, ` +
      "because a skipped row may be the live dispatch or the terminal that stops a duplicate worker or post",
    path,
  }),
  unreadable: ({ cause, path }: { cause: unknown; path: string }): WitnessJournalUnreadableError => ({
    code: "JOURNAL_UNREADABLE",
    message: `witness journal ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  writeFailed: ({ cause, path }: { cause: unknown; path: string }): WitnessJournalWriteFailedError => ({
    code: "JOURNAL_WRITE_FAILED",
    message: `witness journal ${path} could not be appended: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/** Why `witness dispatch` refused or failed. */
export type WitnessDispatchError =
  | { readonly code: "ALREADY_DISPATCHED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "ALREADY_SETTLED"; readonly message: string; readonly witnessId: string }
  | {
      readonly code: "ANOTHER_WITNESS_LIVE";
      readonly message: string;
      readonly witnessId: string;
      readonly liveId: string;
    }
  | { readonly code: "DISPATCH_LOCKED"; readonly message: string }
  | { readonly code: "JOURNAL"; readonly message: string; readonly cause: WitnessJournalError }
  | { readonly code: "HOST_MISSING"; readonly message: string }
  | { readonly code: "HOST_AMBIGUOUS"; readonly message: string }
  | { readonly code: "BOOT_FAILED"; readonly message: string }
  | { readonly code: "RECORD_FAILED"; readonly message: string; readonly closeFailure: string | undefined }
  | {
      readonly code: "PICKUP_UNSENT";
      readonly message: string;
      readonly witnessId: string;
      readonly closeFailure: string | undefined;
      readonly settleFailure: string | undefined;
    }
  | {
      readonly code: "PICKUP_STRANDED";
      readonly message: string;
      readonly witnessId: string;
      readonly workspaceRef: string;
    }
  | {
      readonly code: "PICKUP_UNPROVEN";
      readonly message: string;
      readonly witnessId: string;
      readonly workspaceRef: string;
    }
  | { readonly code: "REPLY_ALREADY_RESERVED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "THREAD_STOOD_DOWN"; readonly message: string; readonly stoodDownAt: string }
  | {
      readonly code: "PREVIOUS_ATTEMPT_OPEN";
      readonly message: string;
      readonly witnessId: string;
      readonly workspaceRef: string;
    };

/** Factories for {@link WitnessDispatchError}. */
export const WitnessDispatchErrors = {
  alreadyDispatched: ({ witnessId, workspaceRef }: { witnessId: string; workspaceRef: string }) =>
    ({
      code: "ALREADY_DISPATCHED",
      message:
        `witness ${witnessId} already has a live worker in ${workspaceRef} — a second one would duplicate its ` +
        "investigation and could post twice",
      witnessId,
    }) as const satisfies WitnessDispatchError,
  alreadySettled: ({ outcome, witnessId }: { outcome: WitnessOutcome; witnessId: string }) =>
    ({
      code: "ALREADY_SETTLED",
      message:
        `witness ${witnessId} is already settled (${outcome}) — a settled witness is never re-opened; only a ` +
        "failed one, which reached no verdict, is dispatched again",
      witnessId,
    }) as const satisfies WitnessDispatchError,
  anotherLive: ({ liveId, witnessId }: { liveId: string; witnessId: string }) =>
    ({
      code: "ANOTHER_WITNESS_LIVE",
      liveId,
      message:
        `witness ${witnessId} not dispatched: ${liveId} is still being investigated, and the owner's ruling is ` +
        "one unasked peer-bot thread investigation at a time — dispatch this line once that one settles, or " +
        `settle ${liveId} --as failed if its worker is gone`,
      witnessId,
    }) as const satisfies WitnessDispatchError,
  bootFailed: ({ reason }: { reason: string }) =>
    ({
      code: "BOOT_FAILED",
      message: `the witness worker's visible session did not boot, and nothing was recorded: ${reason}`,
    }) as const satisfies WitnessDispatchError,
  hostAmbiguous: ({ problem }: { problem: string }) =>
    ({ code: "HOST_AMBIGUOUS", message: problem }) as const satisfies WitnessDispatchError,
  hostMissing: ({ problem }: { problem: string }) =>
    ({ code: "HOST_MISSING", message: problem }) as const satisfies WitnessDispatchError,
  journal: ({ cause }: { cause: WitnessJournalError }) =>
    ({ cause, code: "JOURNAL", message: cause.message }) as const satisfies WitnessDispatchError,
  locked: ({ reason }: { reason: string }) =>
    ({
      code: "DISPATCH_LOCKED",
      message: `another witness dispatch is in progress on this home, so this one booted nothing: ${reason}`,
    }) as const satisfies WitnessDispatchError,
  pickupUnsent: ({
    closeFailure,
    reason,
    settleFailure,
    witnessId,
    workspaceRef,
  }: {
    closeFailure: string | undefined;
    reason: string;
    settleFailure: string | undefined;
    witnessId: string;
    workspaceRef: string;
  }) =>
    ({
      closeFailure,
      code: "PICKUP_UNSENT",
      message:
        `the pickup line could not be sent into ${workspaceRef}, so witness ${witnessId} was settled failed` +
        (settleFailure === undefined ? "" : ` — but recording that failed too: ${settleFailure}`) +
        (closeFailure === undefined ? "" : ` — and closing the workspace failed: ${closeFailure}`) +
        `: ${reason}`,
      settleFailure,
      witnessId,
    }) as const satisfies WitnessDispatchError,
  pickupStranded: ({ reason, witnessId, workspaceRef }: { reason: string; witnessId: string; workspaceRef: string }) =>
    ({
      code: "PICKUP_STRANDED",
      message:
        `the pickup line was typed into ${workspaceRef} but never left its composer, so witness ${witnessId} ` +
        `stays LIVE and the workspace stays open: press it through with \`slopweaver cmux submit --workspace ` +
        `${workspaceRef}\` and read the screen; if it still will not run, \`slopweaver witness settle ${witnessId} ` +
        `--as failed --why "<what you saw>"\` closes it and frees the line for a fresh dispatch: ${reason}`,
      witnessId,
      workspaceRef,
    }) as const satisfies WitnessDispatchError,
  pickupUnproven: ({ reason, witnessId, workspaceRef }: { reason: string; witnessId: string; workspaceRef: string }) =>
    ({
      code: "PICKUP_UNPROVEN",
      message:
        `the pickup line was sent into ${workspaceRef} and nothing saw it submitted, so witness ${witnessId} ` +
        `stays LIVE and the workspace stays open: read the screen with \`slopweaver cmux read-screen ` +
        `--workspace ${workspaceRef}\`; if no turn ran, \`slopweaver witness settle ${witnessId} --as failed ` +
        `--why "<what you saw>"\` closes it and frees the line for a fresh dispatch: ${reason}`,
      witnessId,
      workspaceRef,
    }) as const satisfies WitnessDispatchError,
  threadStoodDown: ({ key, stoodDownAt }: { key: WitnessKey; stoodDownAt: string }) =>
    ({
      code: "THREAD_STOOD_DOWN",
      message:
        `not dispatched: the bot stood down in thread ${key.channel}/${key.threadTs} at ${stoodDownAt}, so ` +
        "nothing there is witnessed any further — a line handed off before the stand-down landed boots no worker",
      stoodDownAt,
    }) as const satisfies WitnessDispatchError,
  previousAttemptOpen: ({
    closeFailure,
    witnessId,
    workspaceRef,
  }: {
    closeFailure: string;
    witnessId: string;
    workspaceRef: string;
  }) =>
    ({
      code: "PREVIOUS_ATTEMPT_OPEN",
      message:
        `witness ${witnessId} not dispatched again: its failed attempt's workspace ${workspaceRef} could not be ` +
        `closed (${closeFailure}), and a worker still in it would run beside a new one — close it by hand, then ` +
        "dispatch again",
      witnessId,
      workspaceRef,
    }) as const satisfies WitnessDispatchError,
  recordFailed: ({
    closeFailure,
    cause,
    workspaceRef,
  }: {
    closeFailure: string | undefined;
    cause: WitnessJournalError;
    workspaceRef: string;
  }) =>
    ({
      closeFailure,
      code: "RECORD_FAILED",
      message:
        `the worker booted in ${workspaceRef} but its dispatch could not be recorded, so no pickup was sent` +
        (closeFailure === undefined ? " and the workspace was closed" : ` and closing it failed: ${closeFailure}`) +
        `: ${cause.message}`,
    }) as const satisfies WitnessDispatchError,
  replyAlreadyReserved: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "REPLY_ALREADY_RESERVED",
      message:
        `witness ${witnessId} not dispatched again: a witness reply was already sent, or attempted, for this ` +
        "message, so its failed attempt may have posted before it ended — read the thread; a second worker " +
        "could post the finding twice",
      witnessId,
    }) as const satisfies WitnessDispatchError,
} as const;

/** Why `witness settle` refused or failed. */
export type WitnessSettleError =
  | { readonly code: "WITNESS_UNKNOWN"; readonly message: string; readonly witnessId: string }
  | { readonly code: "ALREADY_SETTLED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "POSTED_TS_REQUIRED"; readonly message: string }
  | { readonly code: "POSTED_TS_FORBIDDEN"; readonly message: string; readonly outcome: WitnessOutcome }
  | { readonly code: "WHY_REQUIRED"; readonly message: string; readonly outcome: WitnessOutcome }
  | { readonly code: "NOT_DISPATCHED"; readonly message: string; readonly key: WitnessKey }
  | { readonly code: "JOURNAL"; readonly message: string; readonly cause: WitnessJournalError }
  | { readonly code: "CLEANUP_FAILED"; readonly message: string; readonly witnessId: string }
  | { readonly code: "SETTLE_LOCKED"; readonly message: string };

/** Factories for {@link WitnessSettleError}. */
export const WitnessSettleErrors = {
  alreadySettled: ({ outcome, witnessId }: { outcome: WitnessOutcome; witnessId: string }) =>
    ({
      code: "ALREADY_SETTLED",
      message: `witness ${witnessId} is already settled (${outcome}) — each attempt has exactly one terminal`,
      witnessId,
    }) as const satisfies WitnessSettleError,
  cleanupFailed: ({ reason, witnessId, workspaceRef }: { reason: string; witnessId: string; workspaceRef: string }) =>
    ({
      code: "CLEANUP_FAILED",
      message: `witness ${witnessId} is settled, but its workspace ${workspaceRef} could not be closed: ${reason}`,
      witnessId,
    }) as const satisfies WitnessSettleError,
  journal: ({ cause }: { cause: WitnessJournalError }) =>
    ({ cause, code: "JOURNAL", message: cause.message }) as const satisfies WitnessSettleError,
  locked: ({ reason }: { reason: string }) =>
    ({
      code: "SETTLE_LOCKED",
      message: `a witness dispatch or settle is in progress on this home, so nothing was recorded — run it again once that finishes: ${reason}`,
    }) as const satisfies WitnessSettleError,
  notDispatched: ({ key, outcome }: { key: WitnessKey; outcome: WitnessOutcome }) =>
    ({
      code: "NOT_DISPATCHED",
      key,
      message:
        `no worker was ever dispatched for ${key.channel}/${key.messageTs}, so it cannot end ${outcome} — only ` +
        "nothing-checkable settles a witness that never had a worker",
    }) as const satisfies WitnessSettleError,
  postedTsForbidden: ({ outcome }: { outcome: WitnessOutcome }) =>
    ({
      code: "POSTED_TS_FORBIDDEN",
      message: `--posted-ts is only for --as posted; a ${outcome} witness posted nothing`,
      outcome,
    }) as const satisfies WitnessSettleError,
  postedTsRequired: () =>
    ({
      code: "POSTED_TS_REQUIRED",
      message: "--as posted needs --posted-ts <ts>: the ts slack reply printed for the witness form",
    }) as const satisfies WitnessSettleError,
  unknown: ({ witnessId }: { witnessId: string }) =>
    ({
      code: "WITNESS_UNKNOWN",
      message: `no witness ${witnessId} in the journal — slopweaver witness list shows the ones this home holds`,
      witnessId,
    }) as const satisfies WitnessSettleError,
  whyRequired: ({ outcome }: { outcome: WitnessOutcome }) =>
    ({
      code: "WHY_REQUIRED",
      message: `--as ${outcome} needs --why "<what was checked>" — silence must still say what it rests on`,
      outcome,
    }) as const satisfies WitnessSettleError,
} as const;
