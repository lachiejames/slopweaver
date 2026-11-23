/**
 * Every way reading or moving Error Tracking issues can fail (`errorTrackingTriage.ts`), and the receipt each
 * failure carries.
 *
 * Every failure past the first read carries `movedBefore`: the ids whose move Datadog had accepted and a read
 * straight after found in the target state, when the run stopped. That is the EVIDENCE, worded as such — with
 * no conditional update, another triager moving the same issue in the same gap is indistinguishable, so no
 * message claims this run caused a transition. The door ledger records an admission, never which issues
 * changed, so a non-zero exit is the only receipt a caller gets. A move whose outcome this run cannot
 * attribute — its answer was lost, or it was accepted and no read showed it land — carries its id in
 * `uncertain`: it MAY have moved, and the receipt says so rather than guessing either way.
 */
import { client } from "@datadog/datadog-api-client";

import { errorMessage } from "../lib/errorMessage.js";
import { ERROR_TRACKING_STATE_LABELS, type ErrorTrackingState } from "./errorTracking.js";

/** One issue's current state, as Datadog reported it. */
export interface IssueStateRow {
  readonly id: string;
  readonly state: ErrorTrackingState;
}

/** A requested id that is not an Error Tracking issue id. */
export interface TriageIssueIdInvalidError {
  readonly code: "ISSUE_ID_INVALID";
  readonly message: string;
  readonly ids: readonly string[];
}

/** Datadog answered 404 for an id: no such issue on this site. */
export interface TriageIssueUnknownError {
  readonly code: "ISSUE_UNKNOWN";
  readonly message: string;
  readonly id: string;
  readonly movedBefore: readonly string[];
}

/** A lookup that answered neither found nor absent, or answered for another issue — the state is UNKNOWN. */
export interface TriageReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly id: string;
  readonly movedBefore: readonly string[];
}

/**
 * An issue's state changed outside this run after the plan read it — another triager, or Datadog's own
 * automation — so this run left it alone rather than overwrite that.
 */
export interface TriageStateChangedError {
  readonly code: "STATE_CHANGED";
  readonly message: string;
  readonly id: string;
  readonly planned: ErrorTrackingState;
  readonly found: ErrorTrackingState;
  readonly movedBefore: readonly string[];
}

/** Datadog's own answer refused a move: a 4xx other than 408 — the request was judged, and not applied. */
export interface TriageUpdateRejectedError {
  readonly code: "UPDATE_REJECTED";
  readonly message: string;
  readonly id: string;
  readonly movedBefore: readonly string[];
}

/** A move whose outcome this run cannot attribute: its answer was lost, or it was accepted and no read showed it land. */
export interface TriageUpdateUnconfirmedError {
  readonly code: "UPDATE_UNCONFIRMED";
  readonly message: string;
  readonly id: string;
  readonly movedBefore: readonly string[];
  readonly uncertain: readonly string[];
}

/** Every move was accepted, and the read-back still finds some issues elsewhere. */
export interface TriageNotMovedError {
  readonly code: "NOT_MOVED_AFTER_UPDATE";
  readonly message: string;
  readonly stillElsewhere: readonly IssueStateRow[];
  readonly movedBefore: readonly string[];
}

/** Every way reading or moving Error Tracking issues can fail. `code` is what a caller branches on. */
export type DatadogTriageError =
  | TriageIssueIdInvalidError
  | TriageIssueUnknownError
  | TriageReadFailedError
  | TriageStateChangedError
  | TriageUpdateRejectedError
  | TriageUpdateUnconfirmedError
  | TriageNotMovedError;

/** The receipt clause every post-move failure ends on: the evidence for each earlier move, and which. */
function movedClause({ movedBefore }: { movedBefore: readonly string[] }): string {
  const named = movedBefore.length > 0 ? ` (${movedBefore.join(", ")})` : "";
  return `${String(movedBefore.length)} earlier move(s) were accepted and read back in the target state${named}`;
}

/**
 * Whether a thrown PUT is Datadog's own refusal: a 4xx answer means the request was judged and not applied.
 * A 408, a 5xx, or no HTTP answer at all (a timeout, a reset) says nothing about whether it applied.
 *
 * @param cause what the PUT threw
 * @returns true only for an authoritative refusal
 */
export function isDatadogRefusal({ cause }: { cause: unknown }): boolean {
  return cause instanceof client.ApiException && cause.code >= 400 && cause.code < 500 && cause.code !== 408;
}

/** A thrown SDK failure, in one line: the HTTP status and Datadog's own error text where there is one. */
function describeCause({ cause }: { cause: unknown }): string {
  if (cause instanceof client.ApiException) {
    return `HTTP ${String(cause.code)} ${JSON.stringify(cause.body)}`;
  }
  return errorMessage({ error: cause });
}

/** How Datadog answered one PUT — which says nothing yet about whether the state changed. */
export type PutAnswer = { readonly accepted: true } | { readonly accepted: false; readonly cause: unknown };

/** Why a move's outcome cannot be attributed, as the opening of a sentence. */
function unattributedClause({ answer, id }: { answer: PutAnswer; id: string }): string {
  if (answer.accepted) {
    return `Datadog accepted moving Error Tracking issue ${id}, but the read straight after did not show it in the target state`;
  }
  return `the answer to moving Error Tracking issue ${id} was lost (${describeCause({ cause: answer.cause })})`;
}

/** The factories the real code calls, so a test fixture is built the same way the product builds one. */
export const DatadogTriageErrors = {
  issueIdInvalid: ({ ids }: { ids: readonly string[] }): TriageIssueIdInvalidError => ({
    code: "ISSUE_ID_INVALID",
    ids,
    message:
      `not an Error Tracking issue id: ${ids.join(", ")} — an id is the UUID that ends the issue's console link ` +
      "(`slopweaver datadog errors` prints it)",
  }),
  issueUnknown: ({ id, movedBefore }: { id: string; movedBefore: readonly string[] }): TriageIssueUnknownError => ({
    code: "ISSUE_UNKNOWN",
    id,
    message: `Datadog has no Error Tracking issue ${id} on this site — ${movedClause({ movedBefore })}`,
    movedBefore,
  }),
  notMoved: ({
    stillElsewhere,
    target,
    movedBefore,
  }: {
    stillElsewhere: readonly IssueStateRow[];
    target: ErrorTrackingState;
    movedBefore: readonly string[];
  }): TriageNotMovedError => ({
    code: "NOT_MOVED_AFTER_UPDATE",
    message:
      `Datadog accepted every move, and the read-back finds ${String(stillElsewhere.length)} issue(s) not ` +
      `${ERROR_TRACKING_STATE_LABELS[target]}: ` +
      stillElsewhere.map((row) => `${row.id} (${ERROR_TRACKING_STATE_LABELS[row.state]})`).join(", ") +
      ` — ${movedClause({ movedBefore })}`,
    movedBefore,
    stillElsewhere,
  }),
  readFailed: ({
    id,
    cause,
    movedBefore,
  }: {
    id: string;
    cause: unknown;
    movedBefore: readonly string[];
  }): TriageReadFailedError => ({
    code: "READ_FAILED",
    id,
    message:
      `could not read Error Tracking issue ${id}: ${describeCause({ cause })} — its state is unknown, and ` +
      movedClause({ movedBefore }),
    movedBefore,
  }),
  stateChanged: ({
    id,
    planned,
    found,
    movedBefore,
  }: {
    id: string;
    planned: ErrorTrackingState;
    found: ErrorTrackingState;
    movedBefore: readonly string[];
  }): TriageStateChangedError => ({
    code: "STATE_CHANGED",
    found,
    id,
    message:
      `Error Tracking issue ${id} was ${ERROR_TRACKING_STATE_LABELS[planned]} when planned and is ` +
      `${ERROR_TRACKING_STATE_LABELS[found]} now, so it changed outside this run — this run sent it no move, and ` +
      movedClause({ movedBefore }),
    movedBefore,
    planned,
  }),
  updateRejected: ({
    id,
    movedBefore,
    cause,
  }: {
    id: string;
    movedBefore: readonly string[];
    cause: unknown;
  }): TriageUpdateRejectedError => ({
    code: "UPDATE_REJECTED",
    id,
    message:
      `Datadog refused to move Error Tracking issue ${id}: ${describeCause({ cause })} — ` +
      movedClause({ movedBefore }),
    movedBefore,
  }),
  updateUnconfirmed: ({
    id,
    movedBefore,
    answer,
  }: {
    id: string;
    movedBefore: readonly string[];
    answer: PutAnswer;
  }): TriageUpdateUnconfirmedError => ({
    code: "UPDATE_UNCONFIRMED",
    id,
    message:
      `${unattributedClause({ answer, id })}, so whether this run's move applied is unknown and it MAY have ` +
      `moved — ${movedClause({ movedBefore })}`,
    movedBefore,
    uncertain: [id],
  }),
} as const;

/**
 * The ids a failure says this run had already moved — none for a failure before any move.
 *
 * @param error the failure
 * @returns the moved ids, in the order they were moved
 */
export function movedBeforeOf({ error }: { error: DatadogTriageError }): readonly string[] {
  if (error.code === "ISSUE_ID_INVALID") {
    return [];
  }
  return error.movedBefore;
}

/**
 * The ids a failure says may or may not have moved — only a move whose answer was lost carries any.
 *
 * @param error the failure
 * @returns the ids whose state this run could not confirm
 */
export function uncertainOf({ error }: { error: DatadogTriageError }): readonly string[] {
  if (error.code === "UPDATE_UNCONFIRMED") {
    return error.uncertain;
  }
  return [];
}
