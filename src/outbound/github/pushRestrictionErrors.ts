/**
 * The typed failures of reading or governing one branch's push restriction — the domain union and its factory
 * for `./pushRestrictionWrite.ts` and `slopweaver github push-restriction`.
 */
import type { IngestError } from "../../lib/ingestError.js";

/**
 * The credential or the repository slug is unavailable.
 *
 * @internal a member of {@link PushRestrictionError}; branch on `code`, never on this name
 */
export interface PushRestrictionAccessError {
  readonly code: "ACCESS_UNAVAILABLE";
  readonly message: string;
}

/**
 * A read or the mutation failed at the provider boundary.
 *
 * @internal a member of {@link PushRestrictionError}; branch on `code`, never on this name
 */
export interface PushRestrictionCallFailedError {
  readonly code: "CALL_FAILED";
  readonly message: string;
  readonly cause: IngestError;
}

/**
 * GitHub answered with a shape this verb cannot read whole — including a full page that may hide more.
 *
 * @internal a member of {@link PushRestrictionError}; branch on `code`, never on this name
 */
export interface PushRestrictionMalformedError {
  readonly code: "MALFORMED_PAYLOAD";
  readonly message: string;
}

/**
 * No classic rule's pattern names the branch exactly, so there is nothing to patch.
 *
 * @internal a member of {@link PushRestrictionError}; branch on `code`, never on this name
 */
export interface PushRestrictionNoRuleError {
  readonly code: "NO_RULE";
  readonly message: string;
  readonly patterns: readonly string[];
}

/**
 * A login named in `--allow` resolves to no GitHub user.
 *
 * @internal a member of {@link PushRestrictionError}; branch on `code`, never on this name
 */
export interface PushRestrictionUnknownUserError {
  readonly code: "UNKNOWN_USER";
  readonly message: string;
  readonly login: string;
}

/**
 * GitHub accepted the mutation and the read-back is not what was sent.
 *
 * @internal a member of {@link PushRestrictionError}; branch on `code`, never on this name
 */
export interface PushRestrictionReadBackMismatchError {
  readonly code: "READ_BACK_MISMATCH";
  readonly message: string;
}

/** Every way reading or governing a branch's push restriction can fail. */
export type PushRestrictionError =
  | PushRestrictionAccessError
  | PushRestrictionCallFailedError
  | PushRestrictionMalformedError
  | PushRestrictionNoRuleError
  | PushRestrictionReadBackMismatchError
  | PushRestrictionUnknownUserError;

/** Construct one `PushRestrictionError`; the real code and its tests both come through here. */
export const PushRestrictionErrors = {
  accessUnavailable: ({ problems }: { problems: readonly string[] }): PushRestrictionAccessError => ({
    code: "ACCESS_UNAVAILABLE",
    message: problems.join("; "),
  }),
  callFailed: ({ cause }: { cause: IngestError }): PushRestrictionCallFailedError => ({
    cause,
    code: "CALL_FAILED",
    message: cause.message,
  }),
  malformed: ({ what }: { what: string }): PushRestrictionMalformedError => ({
    code: "MALFORMED_PAYLOAD",
    message: `GitHub's branch-protection answer could not be read whole: ${what}`,
  }),
  noRule: ({
    identity,
    branch,
    patterns,
  }: {
    identity: string;
    branch: string;
    patterns: readonly string[];
  }): PushRestrictionNoRuleError => ({
    code: "NO_RULE",
    message:
      `${identity} has no classic protection rule whose pattern is exactly "${branch}" ` +
      `(patterns: ${patterns.length === 0 ? "none" : patterns.join(", ")}) — this verb patches an existing rule ` +
      "and never creates protection from nothing",
    patterns,
  }),
  readBackMismatch: ({
    identity,
    branch,
    wanted,
    stored,
  }: {
    identity: string;
    branch: string;
    wanted: string;
    stored: string;
  }): PushRestrictionReadBackMismatchError => ({
    code: "READ_BACK_MISMATCH",
    message: `GitHub accepted the push restriction for ${identity}@${branch} but the read-back is ${stored} rather than ${wanted}`,
  }),
  unknownUser: ({ login }: { login: string }): PushRestrictionUnknownUserError => ({
    code: "UNKNOWN_USER",
    login,
    message: `no GitHub user has the login "${login}"`,
  }),
} as const;
