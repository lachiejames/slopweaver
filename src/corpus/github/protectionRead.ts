/**
 * How a failed CLASSIC branch-protection read is understood: one pure classifier and one settling helper shared
 * by every endpoint under `GET /repos/{owner}/{repo}/branches/{branch}/protection`.
 *
 * ## Three answers that used to be one
 *
 * GitHub answers a protection read in three ways that are not faults of the same kind, and each gets its own
 * name and its own message here:
 *
 * - **404** — nothing protects this branch. A STATE, carried as `unprotected`.
 * - **403 with GitHub's plan sentence** — the repository's plan cannot protect a branch at all (a private
 *   repository on a free personal plan). Also a STATE, carried as `plan-unavailable`, because there is no
 *   protection to read and none can exist. MEASURED: the required-status-checks read answers
 *   `Upgrade to GitHub Pro or make this repository public to enable this feature.` there, and before this module
 *   `github lap` refused before any lane on `a preflight read failed: <that sentence>`. Reproduce on such a
 *   repository: `slopweaver github required-contexts --repo <owner>/<repo> --branch main --json`.
 * - **any other 403** — the token is denied the read. A FAULT that must still refuse, carried as
 *   `PROTECTION_PERMISSION_DENIED` so its message says what is actually wrong.
 *
 * Everything else (a 5xx, a network failure, a rate limit) stays `PROTECTION_READ_FAILED` with GitHub's own words.
 *
 * ## Why the plan sentence is matched exactly
 *
 * A 403 is the answer to many questions, and calling a real permission denial "this plan cannot protect a branch"
 * would let a lap or a merge proceed past a branch it was simply not allowed to read. So the plan reading needs
 * BOTH the 403 and GitHub's whole sentence; a reworded sentence fails CLOSED, as a permission denial, until
 * somebody deliberately teaches this module the new words. A 403 rate limit (GitHub's secondary limit answers 403)
 * is neither, and stays a read failure.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { errAsync, okAsync, type ResultAsync } from "../../lib/result.js";

/**
 * The sentence GitHub answers a protection read with when the repository's plan cannot protect a branch. Matched
 * as a whole, never as a keyword, for the reason the header gives.
 */
export const PLAN_CANNOT_PROTECT_SENTENCE =
  "Upgrade to GitHub Pro or make this repository public to enable this feature";

/** What one failed protection read means. */
export type ProtectionReadDisposition = "unprotected" | "plan-unavailable" | "permission-denied" | "read-failed";

/** A 403 rate limit, by the three signals GitHub gives one: the boundary's own kind, a `Retry-After`, or its words. */
function isRateLimited({ failure }: { failure: IngestError }): boolean {
  return failure.kind === "rate-limit" || failure.retryAfterMs !== undefined || /rate limit/i.test(failure.message);
}

/**
 * Classify one failed protection read. The order is load-bearing: a 404 is a state whatever its body says, and
 * the plan reading needs both the 403 and GitHub's whole sentence.
 *
 * @param failure the typed boundary failure the read produced
 * @returns which of the four answers it is
 */
export function classifyProtectionReadFailure({ failure }: { failure: IngestError }): ProtectionReadDisposition {
  if (failure.status === 404) {
    return "unprotected";
  }
  if (failure.status !== 403 || isRateLimited({ failure })) {
    return "read-failed";
  }
  return failure.message.includes(PLAN_CANNOT_PROTECT_SENTENCE) ? "plan-unavailable" : "permission-denied";
}

/** GitHub denied this token the protection read. Refuses: nothing about the branch is known. */
export interface ProtectionPermissionDeniedError {
  readonly code: "PROTECTION_PERMISSION_DENIED";
  readonly message: string;
  readonly branch: string;
  readonly cause: IngestError;
}

/** The protection read failed for any other reason — a 5xx, the network, a rate limit. */
export interface ProtectionReadFailedError {
  readonly code: "PROTECTION_READ_FAILED";
  readonly message: string;
  readonly branch: string;
  readonly cause: IngestError;
}

/** Every failure a classic protection read can produce once its two STATES are taken out. */
export type GithubProtectionReadError = ProtectionPermissionDeniedError | ProtectionReadFailedError;

export const GithubProtectionReadErrors = {
  permissionDenied: ({ branch, cause }: { branch: string; cause: IngestError }): ProtectionPermissionDeniedError => ({
    branch,
    cause,
    code: "PROTECTION_PERMISSION_DENIED",
    message:
      `GitHub denied this token permission to read ${branch}'s branch protection (HTTP 403: ${cause.message}); ` +
      "nothing about what the branch requires is known, so this refuses rather than guessing. Read it with a token " +
      "that holds admin on the repository",
  }),
  readFailed: ({ branch, cause }: { branch: string; cause: IngestError }): ProtectionReadFailedError => ({
    branch,
    cause,
    code: "PROTECTION_READ_FAILED",
    message: `could not read ${branch}'s branch protection: ${cause.message}`,
  }),
} as const;

/**
 * The message every surface prints for a branch the plan cannot protect, so the wording lives in one place.
 *
 * @returns one sentence naming the branch and quoting GitHub's plan sentence
 */
export function planCannotProtectNote({ branch }: { branch: string }): string {
  return (
    `${branch} cannot be protected on this repository's GitHub plan (GitHub answered the protection read with ` +
    `"${PLAN_CANNOT_PROTECT_SENTENCE}"), so no branch-protection rule applies to it`
  );
}

/**
 * Settle one protection read: its two STATES become values, everything else a typed error.
 *
 * @param read the boundary call, already wrapped by `safeProviderCall`
 * @param branch the branch read, named in every error
 * @param unprotected the value a 404 stands for at this endpoint
 * @param planUnavailable the value a plan-gated 403 stands for at this endpoint
 * @returns the read's value, a state value, or the typed failure
 */
export function settleProtectionRead<T>({
  read,
  branch,
  unprotected,
  planUnavailable,
}: {
  read: ResultAsync<T, IngestError>;
  branch: string;
  unprotected: T;
  planUnavailable: T;
}): ResultAsync<T, GithubProtectionReadError> {
  return read.orElse((failure) => {
    const disposition = classifyProtectionReadFailure({ failure });
    switch (disposition) {
      case "unprotected":
        return okAsync(unprotected);
      case "plan-unavailable":
        return okAsync(planUnavailable);
      case "permission-denied":
        return errAsync(GithubProtectionReadErrors.permissionDenied({ branch, cause: failure }));
      case "read-failed":
        return errAsync(GithubProtectionReadErrors.readFailed({ branch, cause: failure }));
      default: {
        const unhandled: never = disposition;
        return errAsync(GithubProtectionReadErrors.readFailed({ branch, cause: unhandled }));
      }
    }
  });
}
