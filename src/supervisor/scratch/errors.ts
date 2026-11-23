/**
 * The typed failures of the three supervisor-scratch verbs — `tick-capture`, `refresh-run` and
 * `scratch-carry`. One domain: the directory a supervisor seat keeps its readings and its briefing state in.
 */

import { type ChildOutcome, describeChildOutcome } from "./childOutcome.js";

/** An invocation the verb refuses before it touches anything. */
export interface ScratchUsageError {
  readonly code: "USAGE";
  readonly message: string;
}

/** A file the verb had to read, write or create and could not. */
export interface ScratchFileError {
  readonly code: "FILE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A `slopweaver` child the verb depends on exited non-zero, overran its budget, or never started. */
export interface ScratchChildFailedError {
  readonly code: "CHILD_FAILED";
  readonly message: string;
  readonly argv: readonly string[];
  readonly outcome: ChildOutcome;
}

/** A file or directory the verb would overwrite — refused, because a seat's evidence is never clobbered. */
export interface ScratchDestinationExistsError {
  readonly code: "DESTINATION_EXISTS";
  readonly message: string;
  readonly path: string;
}

/** The store's autonomy ledger could not be read, so the qualified copy of it was not rebuilt. */
export interface ScratchLedgerUnreadableError {
  readonly code: "LEDGER_UNREADABLE";
  readonly message: string;
}

/** A `slopweaver` child exited 0 and printed nothing, so there is no document to put in place of the old one. */
export interface ScratchChildSilentError {
  readonly code: "CHILD_SILENT";
  readonly message: string;
  readonly argv: readonly string[];
}

/**
 * A `slopweaver` child exited 0 but what it printed is not a document the page can read — truncated, not JSON, or
 * missing what a row needs — so the old one stays.
 */
export interface ScratchChildUnreadableError {
  readonly code: "CHILD_UNREADABLE";
  readonly message: string;
  readonly argv: readonly string[];
  readonly issues: readonly string[];
}

/** Every failure the scratch verbs report. */
export type ScratchError =
  | ScratchUsageError
  | ScratchFileError
  | ScratchChildFailedError
  | ScratchChildSilentError
  | ScratchChildUnreadableError
  | ScratchDestinationExistsError
  | ScratchLedgerUnreadableError;

/**
 * The message a thrown value carries, for a failure the verb reports rather than rethrows.
 *
 * @param cause what was thrown
 * @returns its message, or a statement that it carried none
 */
function causeMessage({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "it threw a value that is not an Error";
}

export const ScratchErrors = {
  childFailed: ({ argv, outcome }: { argv: readonly string[]; outcome: ChildOutcome }): ScratchChildFailedError => ({
    argv,
    code: "CHILD_FAILED",
    message: `\`slopweaver ${argv.join(" ")}\` ${describeChildOutcome({ outcome })}`,
    outcome,
  }),
  childSilent: ({ argv }: { argv: readonly string[] }): ScratchChildSilentError => ({
    argv,
    code: "CHILD_SILENT",
    message: `\`slopweaver ${argv.join(" ")}\` exited 0 but printed nothing, so the file it would have replaced was left as it was`,
  }),
  childUnreadable: ({
    argv,
    issues,
  }: {
    argv: readonly string[];
    issues: readonly string[];
  }): ScratchChildUnreadableError => ({
    argv,
    code: "CHILD_UNREADABLE",
    issues,
    message: `\`slopweaver ${argv.join(" ")}\` exited 0 but printed no readable document (${issues.map((issue) => issue.trim()).join("; ")}), so the file it would have replaced was left as it was`,
  }),
  destinationExists: ({ path }: { path: string }): ScratchDestinationExistsError => ({
    code: "DESTINATION_EXISTS",
    message: `${path} already exists, and this verb never overwrites a seat's scratch — choose a new one`,
    path,
  }),
  fileFailed: ({ path, cause }: { path: string; cause: unknown }): ScratchFileError => ({
    code: "FILE_FAILED",
    message: `${path}: ${causeMessage({ cause })}`,
    path,
  }),
  ledgerUnreadable: ({ reason }: { reason: string }): ScratchLedgerUnreadableError => ({
    code: "LEDGER_UNREADABLE",
    message: `the autonomy ledger could not be read from the store: ${reason}`,
  }),
  usage: ({ message }: { message: string }): ScratchUsageError => ({ code: "USAGE", message }),
} as const;
