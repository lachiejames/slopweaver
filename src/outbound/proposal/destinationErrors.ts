/**
 * The failure kinds reading or writing an install's proposal destination (`./destinationStore.ts`) can
 * produce — a discriminated union scoped to the destination, sharing no base type with the intake's
 * (`.claude/rules/error-handling.md`).
 *
 * The three read failures demand three different acts, which is why they are three codes: an UNSET
 * destination is one to set, an UNREADABLE file is a filesystem fact to look at, and an INVALID one is a file
 * somebody must fix by hand — never one to overwrite or read as unset, since either would publish a proposal
 * somewhere the install did not choose.
 */

/** No destination has been set for this install. */
export interface DestinationUnsetError {
  readonly code: "DESTINATION_UNSET";
  readonly message: string;
  /** Where the file was looked for. */
  readonly path: string;
}

/** The file is there but could not be read, or is not JSON. */
export interface DestinationUnreadableError {
  readonly code: "DESTINATION_UNREADABLE";
  readonly message: string;
  readonly path: string;
  /** The thrown error's own message, or `unknown` when what was thrown was not an `Error`. */
  readonly detail: string;
}

/** The file is JSON, but not a destination this build accepts. */
export interface DestinationInvalidError {
  readonly code: "DESTINATION_INVALID";
  readonly message: string;
  readonly path: string;
  /** One line per schema issue, each naming the key it sits on. */
  readonly issues: readonly string[];
}

/** Writing the file threw. */
export interface DestinationWriteFailedError {
  readonly code: "DESTINATION_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** Every way reading or writing a proposal destination can fail. */
export type ProposalDestinationError =
  DestinationUnsetError | DestinationUnreadableError | DestinationInvalidError | DestinationWriteFailedError;

/** The thrown value's message, or `unknown` when it was not an `Error`. */
function detailOf({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : "unknown";
}

/** Construct each destination failure the same way the real code does. */
export const ProposalDestinationErrors = {
  invalid: ({ path, issues }: { path: string; issues: readonly string[] }): DestinationInvalidError => ({
    code: "DESTINATION_INVALID",
    issues,
    message: `${path} is not a proposal destination this build accepts — fix it or set it again:\n  ${issues.join("\n  ")}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): DestinationUnreadableError => {
    const detail = detailOf({ cause });
    return { code: "DESTINATION_UNREADABLE", detail, message: `${path} could not be read: ${detail}`, path };
  },
  unset: ({ path, hint }: { path: string; hint: string }): DestinationUnsetError => ({
    code: "DESTINATION_UNSET",
    message: `this install has no proposal destination yet (looked at ${path}). Set one with: ${hint}`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): DestinationWriteFailedError => {
    const detail = detailOf({ cause });
    return { code: "DESTINATION_WRITE_FAILED", detail, message: `${path} could not be written: ${detail}`, path };
  },
} as const;
