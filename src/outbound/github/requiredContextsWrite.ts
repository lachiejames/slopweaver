/**
 * GitHub's required-status-check read/write, adapted from the one sanctioned write client.
 *
 * The READ here is classic branch protection's own sub-resource, not `src/live/github/mergeQueue.ts`'s
 * `requiredContexts` seam. The two answer different questions and both are wanted: that seam UNIONS classic
 * protection with rulesets to say what a landing is gated on, while this one reads the exact array a PATCH
 * would replace. A write that composed its new list from the union would send a ruleset's contexts into
 * classic protection and quietly duplicate them there.
 */

import type { MergeGroupObservation, RequiredStatusChecks } from "../../corpus/github/protection.js";
import { type GithubProtectionReadError, planCannotProtectNote } from "../../corpus/github/protectionRead.js";
import { makeGithubWriteApi } from "../../corpus/github/write.js";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result, type ResultAsync } from "../../lib/result.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubRequiredContextsApi {
  read(args: {
    owner: string;
    repo: string;
    branch: string;
  }): ResultAsync<RequiredStatusChecks, GithubProtectionReadError>;
  setContexts(args: {
    owner: string;
    repo: string;
    branch: string;
    contexts: readonly string[];
    strict: boolean;
  }): ResultAsync<RequiredStatusChecks, IngestError>;
  mergeGroupContexts(args: {
    owner: string;
    repo: string;
    entries: number;
  }): ResultAsync<MergeGroupObservation, IngestError>;
}

/**
 * Build the production no-SDK-retry client for the required-context verb.
 *
 * @param token the GitHub token
 * @returns the protection read, the merge-group observation and the context mutation
 */
export function makeGithubRequiredContextsApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubRequiredContextsApi {
  const api = makeGithubWriteApi({ privacy, token });
  return {
    mergeGroupContexts: ({ owner, repo, entries }) => api.mergeGroupContexts({ entries, owner, repo }),
    read: ({ owner, repo, branch }) => api.requiredStatusChecks({ branch, owner, repo }),
    setContexts: ({ owner, repo, branch, contexts, strict }) =>
      api.setRequiredStatusChecks({ branch, contexts, owner, repo, strict }),
  };
}

/**
 * The branch carries no classic status-check rule, so there is no required set to govern.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface UnprotectedBranchError {
  readonly code: "UNPROTECTED_BRANCH";
  readonly message: string;
  readonly branch: string;
}

/**
 * The repository slug could not be resolved, or the credential to reach it is absent.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface AccessUnavailableError {
  readonly code: "ACCESS_UNAVAILABLE";
  readonly message: string;
  readonly problems: readonly string[];
}

/**
 * GitHub took the PATCH but the branch reports no status-check rule at all afterwards.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface ProtectionVanishedError {
  readonly code: "PROTECTION_VANISHED";
  readonly message: string;
  readonly branch: string;
}

/**
 * The write was accepted and the read-back is a different list from the one sent.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface ReadBackMismatchError {
  readonly code: "READ_BACK_MISMATCH";
  readonly message: string;
  readonly stored: readonly string[];
  readonly wanted: readonly string[];
}

/**
 * The PATCH, or the read-back that follows it, failed at the provider boundary.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface ProtectionCallFailedError {
  readonly code: "PROTECTION_CALL_FAILED";
  readonly message: string;
  readonly cause: IngestError;
}

/**
 * The repository's plan cannot protect a branch at all, so there is no rule to govern and none can be written.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface PlanCannotProtectError {
  readonly code: "PLAN_CANNOT_PROTECT";
  readonly message: string;
  readonly branch: string;
}

/**
 * GitHub denied this token the read of the branch's status-check rule.
 *
 * @internal a member of {@link RequiredContextsWriteError}; branch on `code`, never on this name
 */
export interface ProtectionPermissionDeniedError {
  readonly code: "PROTECTION_PERMISSION_DENIED";
  readonly message: string;
  readonly branch: string;
}

/** Every way governing a branch's required contexts can fail once the door has admitted the write. */
export type RequiredContextsWriteError =
  | AccessUnavailableError
  | PlanCannotProtectError
  | ProtectionCallFailedError
  | ProtectionPermissionDeniedError
  | ProtectionVanishedError
  | ReadBackMismatchError
  | UnprotectedBranchError;

/** Construct one `RequiredContextsWriteError`; the real code and its tests both come through here. */
export const RequiredContextsWriteErrors = {
  accessUnavailable: ({ problems }: { problems: readonly string[] }): AccessUnavailableError => ({
    code: "ACCESS_UNAVAILABLE",
    message: problems.join("; "),
    problems,
  }),
  callFailed: ({ cause }: { cause: IngestError }): ProtectionCallFailedError => ({
    cause,
    code: "PROTECTION_CALL_FAILED",
    message: cause.message,
  }),
  permissionDenied: ({ branch, denial }: { branch: string; denial: string }): ProtectionPermissionDeniedError => ({
    branch,
    code: "PROTECTION_PERMISSION_DENIED",
    message: denial,
  }),
  planCannotProtect: ({ identity, branch }: { identity: string; branch: string }): PlanCannotProtectError => ({
    branch,
    code: "PLAN_CANNOT_PROTECT",
    message: `${identity}: ${planCannotProtectNote({ branch })} — there is no status-check rule to govern, and none can be written`,
  }),
  protectionVanished: ({ branch }: { branch: string }): ProtectionVanishedError => ({
    branch,
    code: "PROTECTION_VANISHED",
    message: `GitHub accepted the write but ${branch} now reports no status-check rule at all`,
  }),
  unprotectedBranch: ({ identity, branch }: { identity: string; branch: string }): UnprotectedBranchError => ({
    branch,
    code: "UNPROTECTED_BRANCH",
    message:
      `${identity}@${branch} has no classic status-check rule — this verb governs an existing rule and ` +
      "never creates protection from nothing",
  }),
  readBackMismatch: ({
    identity,
    branch,
    stored,
    wanted,
  }: {
    identity: string;
    branch: string;
    stored: readonly string[];
    wanted: readonly string[];
  }): ReadBackMismatchError => ({
    code: "READ_BACK_MISMATCH",
    message:
      `GitHub accepted the contexts for ${identity}@${branch} but the read-back is ` +
      `${stored.join(", ")} rather than ${wanted.join(", ")}`,
    stored,
    wanted,
  }),
} as const;

/**
 * One failed classic status-check read as this verb's own error: a DENIED read keeps its own code and words, any
 * other failure is the boundary call that failed.
 *
 * @param failure the typed protection-read failure
 * @param identity the resolved `owner/name`, named in the denial
 * @returns the verb error to report
 */
export function readFailure({
  branch,
  failure,
  identity,
}: {
  branch: string;
  failure: GithubProtectionReadError;
  identity: string;
}): RequiredContextsWriteError {
  if (failure.code === "PROTECTION_PERMISSION_DENIED") {
    return RequiredContextsWriteErrors.permissionDenied({ branch, denial: `${identity}: ${failure.message}` });
  }
  return RequiredContextsWriteErrors.callFailed({ cause: failure.cause });
}

/**
 * Send the composed list once, then read it back and compare — never trust the PATCH's own echo.
 *
 * Confirming by a second read is what makes this verb's report a measurement: classic protection silently
 * normalises what it stores (a context GitHub does not recognise is still accepted), so the only honest
 * answer to "what does the branch require now" is what a fresh read says.
 *
 * @param api the read/mutation surface to drive
 * @param identity the resolved `owner/name`, for the mismatch message
 * @param contexts the exact list to store
 * @param strict GitHub's up-to-date-before-merging flag, carried through unchanged
 * @returns the stored list, sorted, or the one way the round trip failed
 */
export async function setAndConfirmContexts({
  api,
  identity,
  owner,
  repo,
  branch,
  contexts,
  strict,
}: {
  api: GithubRequiredContextsApi;
  identity: string;
  owner: string;
  repo: string;
  branch: string;
  contexts: readonly string[];
  strict: boolean;
}): Promise<Result<readonly string[], RequiredContextsWriteError>> {
  const sent = await api.setContexts({ branch, contexts, owner, repo, strict });
  if (sent.isErr()) {
    return err(RequiredContextsWriteErrors.callFailed({ cause: sent.error }));
  }
  const after = await api.read({ branch, owner, repo });
  if (after.isErr()) {
    return err(readFailure({ branch, failure: after.error, identity }));
  }
  if (after.value.kind !== "required") {
    return err(RequiredContextsWriteErrors.protectionVanished({ branch }));
  }
  const stored = after.value.contexts.toSorted();
  const wanted = contexts.toSorted();
  if (stored.join("\n") !== wanted.join("\n")) {
    return err(RequiredContextsWriteErrors.readBackMismatch({ branch, identity, stored, wanted }));
  }
  return ok(stored);
}
