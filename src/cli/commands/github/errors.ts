/**
 * The typed failures the `slopweaver github` verbs author themselves: an invocation or form they cannot run,
 * a provider or Git fact that could not be read, a write GitHub accepted but the read-back does not show, a
 * branch, stack or worktree in a state the verb will not act on, and a pre-push hook that never reached a
 * green verdict.
 *
 * ONE union for the whole verb directory per `.claude/rules/error-handling.md`. The factory is written in seven
 * fragments beside the clusters that raise them — `./argsErrors.ts`, `./prErrors.ts`, `./pushErrors.ts`,
 * `./repoErrors.ts`, `./repoLifecycleErrors.ts`, `./repoManifestErrors.ts` and `./stackErrors.ts` — so no file carries every message, and composed here into the one {@link GithubVerbErrors}
 * a caller imports. The flag tokeniser's refusals, a collected list of usage problems, a form's per-path
 * issues, a nested operation's own lines and a base-freshness refusal each arrive as a list and ride as
 * `reasons`; {@link githubVerbErrorLines} gives them back one line per problem, exactly as the string list they
 * replaced did.
 *
 * The already-typed unions stay where they are raised: the remote-ref write verbs (`./refsErrors.ts`), the
 * reviewer register (`./reviewerArgs.ts`), and the `ci-runs`/`run-log` usage issues. A door or escape-hatch
 * refusal is POLICY, not a domain failure, and is never wrapped in this union.
 */
import type { Result } from "#lib/result.js";
import { githubArgsErrorFactories } from "./argsErrors.js";
import { githubPrErrorFactories } from "./prErrors.js";
import { githubPushErrorFactories } from "./pushErrors.js";
import { githubRepoErrorFactories } from "./repoErrors.js";
import { githubRepoLifecycleErrorFactories } from "./repoLifecycleErrors.js";
import { githubRepoManifestErrorFactories } from "./repoManifestErrors.js";
import { githubStackErrorFactories } from "./stackErrors.js";

/** The shared flag parser refused the tail; `reasons` carries each of its refusals. */
export interface GithubFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** One or more problems in one invocation, collected rather than reported one at a time. */
export interface GithubArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A form is JSON and not the verb's shape; `reasons` is one line per issue, in the order they were found. */
export interface GithubFormInvalidError {
  readonly code: "FORM_INVALID";
  readonly message: string;
  readonly form: string;
  readonly reasons: readonly string[];
}

/** A nested operation already answered with its own lines, carried through unchanged as `reasons`. */
export interface GithubUpstreamRefusedError {
  readonly code: "UPSTREAM_REFUSED";
  readonly message: string;
  readonly operation: string;
  readonly reasons: readonly string[];
}

/** The base-freshness check refused this invocation; `reasons` is the refusal, its remedy and any warning. */
export interface GithubBaseFreshnessRefusedError {
  readonly code: "BASE_FRESHNESS_REFUSED";
  readonly message: string;
  readonly subject: string;
  readonly reasons: readonly string[];
}

/** The invocation named no sub-verb this noun has; the message is the noun's own usage line. */
export interface GithubUsageError {
  readonly code: "USAGE";
  readonly message: string;
  readonly command: string;
}

/** A positional the verb needs was not given — a sub-verb, or a search term. */
export interface GithubArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** An argument or flag was given that this invocation does not route — an extra positional, or a mode clash. */
export interface GithubArgumentRefusedError {
  readonly code: "ARGUMENT_REFUSED";
  readonly message: string;
  readonly name: string;
}

/** A flag the verb cannot run without was not given. */
export interface GithubFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given a value it does not accept. */
export interface GithubInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** A form's text is not JSON at all; `detail` is what the JSON parser said. */
export interface GithubFormNotJsonError {
  readonly code: "FORM_NOT_JSON";
  readonly message: string;
  readonly form: string;
  readonly detail: string;
}

/** No credential is configured for the provider this verb has to reach. */
export interface GithubTokenMissingError {
  readonly code: "TOKEN_MISSING";
  readonly message: string;
  readonly provider: "github" | "slack";
}

/** A provider or remote read did not return the fact the verb needs. */
export interface GithubReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly subject: string;
}

/** GitHub accepted a write, but the read-back does not show the state it should have made. */
export interface GithubWriteUnconfirmedError {
  readonly code: "WRITE_UNCONFIRMED";
  readonly message: string;
  readonly subject: string;
}

/** Something moved between what the verb measured and when it acted, so it acts on nothing. */
export interface GithubStateChangedError {
  readonly code: "STATE_CHANGED";
  readonly message: string;
  readonly subject: string;
}

/** A Git command this verb runs failed or answered something it cannot read. */
export interface GithubGitFailedError {
  readonly code: "GIT_FAILED";
  readonly message: string;
  readonly operation: string;
}

/** A branch has no single, usable worktree this verb may act in. */
export interface GithubWorktreeRefusedError {
  readonly code: "WORKTREE_REFUSED";
  readonly message: string;
  readonly branch: string;
}

/** A stack's topology, target or registration is not one this verb may act on. */
export interface GithubStackInvalidError {
  readonly code: "STACK_INVALID";
  readonly message: string;
  readonly subject: string;
}

/** A submitted self-review comment did not map to exactly one live review thread. */
export interface GithubSelfReviewInvalidError {
  readonly code: "SELF_REVIEW_INVALID";
  readonly message: string;
  readonly subject: string;
}

/** Whose account or authority this is could not be established, or is not the one the write needs. */
export interface GithubAuthorizationFailedError {
  readonly code: "AUTHORIZATION_FAILED";
  readonly message: string;
  readonly subject: string;
}

/** The repository's `pre-push` hook could not be run, or ran and did not pass. */
export interface GithubPrePushFailedError {
  readonly code: "PRE_PUSH_FAILED";
  readonly message: string;
  readonly hook: string | undefined;
}

/** A fact the verb read refuses the act — a pull request's state, a default branch, an undefined label. */
export interface GithubFactRefusedError {
  readonly code: "FACT_REFUSED";
  readonly message: string;
  readonly subject: string;
}

/**
 * GitHub denied the token a read of a branch's protection. Its own member, never a `READ_FAILED`, so a real
 * permission denial is told apart from the plan-gated 403 a verb proceeds past (`corpus/github/protectionRead.ts`).
 */
export interface GithubProtectionPermissionDeniedError {
  readonly code: "PROTECTION_PERMISSION_DENIED";
  readonly message: string;
  readonly subject: string;
}

/** Every failure the `slopweaver github` verb directory authors. */
export type GithubVerbError =
  | GithubProtectionPermissionDeniedError
  | GithubFlagsRefusedError
  | GithubArgumentsRefusedError
  | GithubFormInvalidError
  | GithubUpstreamRefusedError
  | GithubBaseFreshnessRefusedError
  | GithubUsageError
  | GithubArgumentMissingError
  | GithubArgumentRefusedError
  | GithubFlagMissingError
  | GithubInvalidFlagValueError
  | GithubFormNotJsonError
  | GithubTokenMissingError
  | GithubReadFailedError
  | GithubWriteUnconfirmedError
  | GithubStateChangedError
  | GithubGitFailedError
  | GithubWorktreeRefusedError
  | GithubStackInvalidError
  | GithubSelfReviewInvalidError
  | GithubAuthorizationFailedError
  | GithubPrePushFailedError
  | GithubFactRefusedError;

/** A result whose failure is one of this directory's own — the alias keeps a signature on one line. */
export type GithubVerbResult<T> = Result<T, GithubVerbError>;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const GithubVerbErrors = {
  ...githubArgsErrorFactories,
  ...githubPrErrorFactories,
  ...githubPushErrorFactories,
  ...githubRepoErrorFactories,
  ...githubRepoLifecycleErrorFactories,
  ...githubRepoManifestErrorFactories,
  ...githubStackErrorFactories,
} as const;

/**
 * The lines a {@link GithubVerbError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function githubVerbErrorLines({ error }: { error: GithubVerbError }): readonly string[] {
  if (
    error.code === "FLAGS_REFUSED" ||
    error.code === "ARGUMENTS_REFUSED" ||
    error.code === "FORM_INVALID" ||
    error.code === "UPSTREAM_REFUSED" ||
    error.code === "BASE_FRESHNESS_REFUSED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
