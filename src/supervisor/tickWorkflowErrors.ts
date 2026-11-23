/**
 * The typed failures of `slopweaver supervisor tick seat|open|close` — one domain: a chair's single sweep, from
 * the readings it takes to the row it records.
 *
 * Its own union rather than a widening of `./errors.ts`'s: that one is the supervisor's ledgers and readers,
 * this is the workflow that composes them, and a verb reaching one of those names it through its own
 * message rather than as a variant here. Every list-carrying variant renders one line per entry.
 */

/** The authored tick file is not the shape `tick close` takes; each issue is `path: message`. */
export interface TickInputInvalidError {
  readonly code: "TICK_INPUT_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** `seat.json` is missing, unreadable, or disagrees with the seat it is being read from. */
export interface TickSeatInvalidError {
  readonly code: "SEAT_CONFIG_INVALID";
  readonly message: string;
  readonly path: string;
}

/** A capture this close reads is missing, unreadable, or not the capture `tick open` wrote. */
export interface TickCaptureInvalidError {
  readonly code: "CAPTURE_INVALID";
  readonly message: string;
  readonly path: string;
}

/** A step refused before anything durable was written; `reasons` is every line it gave. */
export interface TickPreflightRefusedError {
  readonly code: "PREFLIGHT_REFUSED";
  readonly message: string;
  readonly stage: string;
  readonly reasons: readonly string[];
}

/** A close already committed a stage from a DIFFERENT input, so resuming it would publish two sweeps as one. */
export interface TickCloseStateConflictError {
  readonly code: "CLOSE_STATE_CONFLICT";
  readonly message: string;
  readonly expectedHash: string;
  readonly actualHash: string;
}

/** A commit stage failed after preflight passed; the close is resumable from the stage it names. */
export interface TickStageFailedError {
  readonly code: "STAGE_FAILED";
  readonly message: string;
  readonly stage: string;
  readonly reasons: readonly string[];
}

/** Every failure `supervisor tick` reports. */
export type TickWorkflowError =
  | TickInputInvalidError
  | TickSeatInvalidError
  | TickCaptureInvalidError
  | TickPreflightRefusedError
  | TickCloseStateConflictError
  | TickStageFailedError;

export const TickWorkflowErrors = {
  captureInvalid: ({ path, reason }: { path: string; reason: string }): TickCaptureInvalidError => ({
    code: "CAPTURE_INVALID",
    message: `${path}: ${reason}`,
    path,
  }),
  closeStateConflict: ({
    expectedHash,
    actualHash,
  }: {
    expectedHash: string;
    actualHash: string;
  }): TickCloseStateConflictError => ({
    actualHash,
    code: "CLOSE_STATE_CONFLICT",
    expectedHash,
    message:
      `this tick already committed a close from a different input (sha256 ${expectedHash.slice(0, 12)}, ` +
      `this one ${actualHash.slice(0, 12)}) — restore that input to resume it, or open a new tick`,
  }),
  inputInvalid: ({ issues }: { issues: readonly string[] }): TickInputInvalidError => ({
    code: "TICK_INPUT_INVALID",
    issues,
    message: `the tick file was refused, ${String(issues.length)} issue(s):`,
  }),
  preflightRefused: ({ stage, reasons }: { stage: string; reasons: readonly string[] }): TickPreflightRefusedError => ({
    code: "PREFLIGHT_REFUSED",
    message: `${stage} refused, and nothing durable was written:`,
    reasons,
    stage,
  }),
  seatInvalid: ({ path, reason }: { path: string; reason: string }): TickSeatInvalidError => ({
    code: "SEAT_CONFIG_INVALID",
    message: `${path}: ${reason}`,
    path,
  }),
  stageFailed: ({ stage, reasons }: { stage: string; reasons: readonly string[] }): TickStageFailedError => ({
    code: "STAGE_FAILED",
    message: `stage ${stage} failed; re-run the same close to resume from it:`,
    reasons,
    stage,
  }),
} as const;

/**
 * Every line one failure prints: its message, then one indented line per issue or reason it carries.
 *
 * @param error the failure
 * @returns the lines, message first
 */
export function tickWorkflowErrorLines({ error }: { error: TickWorkflowError }): readonly string[] {
  switch (error.code) {
    case "TICK_INPUT_INVALID":
      return [error.message, ...error.issues.map((issue) => `  ${issue}`)];
    case "PREFLIGHT_REFUSED":
    case "STAGE_FAILED":
      return [error.message, ...error.reasons.map((reason) => `  ${reason}`)];
    case "SEAT_CONFIG_INVALID":
    case "CAPTURE_INVALID":
    case "CLOSE_STATE_CONFLICT":
      return [error.message];
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
