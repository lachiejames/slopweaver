/**
 * Reading or writing the organisation fails in ways a caller branches on, so it carries its own union.
 *
 * `ORG_NOT_CONFIGURED` is the one a fresh install meets: it names what is missing and the command that writes it, so
 * a reader that needed the organisation refuses with the repair in its first line rather than placing nothing as the
 * team's work and calling that an answer. `ORG_INVALID` is a stored row that does not read, which is a different
 * repair. `ORG_QUERY_FAILED` is the store boundary, kept apart from absence so an unreachable database never reads as
 * "nothing configured". `SELF_REPOSITORY_UNRESOLVED` is the one derived field: this build's own repository, read off
 * its checkout's `origin` and never stored.
 */
import type { StoreError } from "../store/errors.js";

/** The command that writes the organisation, spelled once so every refusal names the same repair. */
const ORG_SET_COMMAND = "slopweaver org set";

/** The organisation has not been written, or a stored row lacks a field a reader needs. */
export interface OrgNotConfiguredError {
  readonly code: "ORG_NOT_CONFIGURED";
  readonly message: string;
  /** Which field is missing — `organisation` when there is no row at all. */
  readonly missing: string;
}

/** A stored or offered value does not read, every problem named. */
export interface OrgInvalidError {
  readonly code: "ORG_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** The database refused, failed or could not be reached, with the store's own reason carried forward. */
export interface OrgQueryFailedError {
  readonly code: "ORG_QUERY_FAILED";
  readonly message: string;
  readonly cause: StoreError;
}

/** The row moved since it was read, so the write was refused and nothing changed. */
export interface OrgWriteConflictError {
  readonly code: "ORG_WRITE_CONFLICT";
  readonly message: string;
  readonly expected: number;
  readonly actual: number;
}

/** This build's own repository could not be read off its checkout's `origin`. */
export interface SelfRepositoryUnresolvedError {
  readonly code: "SELF_REPOSITORY_UNRESOLVED";
  readonly message: string;
}

/** Every way reading or writing the organisation can fail. */
export type OrganisationError =
  OrgInvalidError | OrgNotConfiguredError | OrgQueryFailedError | OrgWriteConflictError | SelfRepositoryUnresolvedError;

/** Build one of the five, so a test constructs a failure the same way the real code does. */
export const OrganisationErrors = {
  conflict: ({ expected, actual }: { expected: number; actual: number }): OrgWriteConflictError => ({
    actual,
    code: "ORG_WRITE_CONFLICT",
    expected,
    message:
      `the organisation moved from revision ${String(expected)} to ${String(actual)} while this write was being ` +
      "prepared, so nothing was written. Re-read it with `slopweaver org show` and write it again.",
  }),
  invalid: ({ issues }: { issues: readonly string[] }): OrgInvalidError => ({
    code: "ORG_INVALID",
    issues,
    message: `the organisation does not read: ${issues.join("; ")}`,
  }),
  notConfigured: ({ missing }: { missing: string }): OrgNotConfiguredError => ({
    code: "ORG_NOT_CONFIGURED",
    message:
      missing === "organisation"
        ? `no organisation is configured in the store — write it once with \`${ORG_SET_COMMAND}\``
        : `the organisation in the store has no ${missing} — write it again with \`${ORG_SET_COMMAND}\``,
    missing,
  }),
  queryFailed: ({ cause }: { cause: StoreError }): OrgQueryFailedError => ({
    cause,
    code: "ORG_QUERY_FAILED",
    message: `the organisation could not be read from the store: ${cause.message}`,
  }),
  selfUnresolved: ({ reasons }: { reasons: readonly string[] }): SelfRepositoryUnresolvedError => ({
    code: "SELF_REPOSITORY_UNRESOLVED",
    message: `this build's own repository could not be read off its checkout's origin: ${reasons.join("; ")}`,
  }),
} as const;
