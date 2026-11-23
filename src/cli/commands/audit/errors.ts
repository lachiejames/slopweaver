/**
 * The typed refusals the `audit` verbs' argument parsers raise — `audit hygiene` and `audit references` both refuse
 * a tail the same way, so they share one union for the directory. Every variant carries the verb's `usage`, which
 * {@link auditArgsErrorLines} prints LAST, after each reason on its own line, exactly as the string list it replaced.
 *
 * The page-publishing failure in `./referencesRun.ts` is not here: it is a fact about a run that parsed, not a
 * refused invocation, and it stays on the plain string result.
 */

/** The shared flag parser refused the tail; `reasons` carries each of its refusals. */
export interface AuditFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly usage: string;
}

/** `--source` named a corpus source that does not exist. */
export interface AuditSourceUnknownError {
  readonly code: "SOURCE_UNKNOWN";
  readonly message: string;
  readonly source: string;
  readonly usage: string;
}

/** `--ref` was given an empty commit-ish. */
export interface AuditRefMissingError {
  readonly code: "REF_MISSING";
  readonly message: string;
  readonly usage: string;
}

/** `--indirect` was combined with flags only the direct proof reads. */
export interface AuditDirectFlagsConflictError {
  readonly code: "DIRECT_FLAGS_CONFLICT";
  readonly message: string;
  readonly flags: readonly string[];
  readonly usage: string;
}

/** Every refusal an `audit` argument parser raises. */
export type AuditArgsError =
  AuditFlagsRefusedError | AuditSourceUnknownError | AuditRefMissingError | AuditDirectFlagsConflictError;

/** The factory the parsers call, so a test built the same way catches a drift. */
export const AuditArgsErrors = {
  directFlagsConflict: ({
    flags,
    usage,
  }: {
    flags: readonly string[];
    usage: string;
  }): AuditDirectFlagsConflictError => ({
    code: "DIRECT_FLAGS_CONFLICT",
    flags,
    message:
      "--indirect reads the home's candidate map and writes its report there, so it refuses the direct-only " +
      flags.map((name) => `--${name}`).join(", "),
    usage,
  }),
  flagsRefused: ({ reasons, usage }: { reasons: readonly string[]; usage: string }): AuditFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
    usage,
  }),
  refMissing: ({ usage }: { usage: string }): AuditRefMissingError => ({
    code: "REF_MISSING",
    message: "--ref needs a commit-ish",
    usage,
  }),
  sourceUnknown: ({
    source,
    expected,
    usage,
  }: {
    source: string;
    expected: readonly string[];
    usage: string;
  }): AuditSourceUnknownError => ({
    code: "SOURCE_UNKNOWN",
    message: `unrecognised source: ${source} (expected ${expected.join(", ")})`,
    source,
    usage,
  }),
} as const;

/**
 * The lines an {@link AuditArgsError} prints: each reason on its own line, then the verb's usage.
 *
 * @returns the reasons in the order they were found, the usage last
 */
export function auditArgsErrorLines({ error }: { error: AuditArgsError }): readonly string[] {
  if (error.code === "FLAGS_REFUSED") {
    return [...error.reasons, error.usage];
  }
  return [error.message, error.usage];
}
