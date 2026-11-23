/**
 * Typed discriminated-union domain errors for `src/corpus/github/**`, one union per bounded module — no
 * shared base error type across them. Each factory computes its own `message`, so a call site never
 * hand-assembles the string a reader ultimately sees.
 */
import { errorMessage } from "../../lib/errorMessage.js";

// ---------------------------------------------------------------------------------------------------------
// members.ts — member enumeration + SAML email join
// ---------------------------------------------------------------------------------------------------------

/** `listMembers` paging threw — fatal, no member rows can be produced. */
export interface MemberEnumerationFailedError {
  readonly code: "MEMBER_ENUMERATION_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** The org has no SAML identity provider at all — a capability gap, not a failure. */
export interface SamlNoProviderError {
  readonly code: "SAML_NO_PROVIDER";
  readonly message: string;
}

/** The SAML GraphQL lookup threw (network/auth) — emails degrade to public-profile only. */
export interface SamlLookupFailedError {
  readonly code: "SAML_LOOKUP_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Either SAML failure kind — what {@link collectSamlEmails}/`GithubMembersApi.samlEmails` can produce. */
export type GithubSamlError = SamlNoProviderError | SamlLookupFailedError;

/** Every failure `src/corpus/github/members.ts` can produce. */
export type GithubMemberError = MemberEnumerationFailedError | GithubSamlError;

export const GithubMemberErrors = {
  enumerationFailed: ({ cause }: { cause: unknown }): MemberEnumerationFailedError => ({
    cause,
    code: "MEMBER_ENUMERATION_FAILED",
    message: `github member enumeration failed: ${errorMessage({ error: cause })}`,
  }),
  samlLookupFailed: ({ cause }: { cause: unknown }): SamlLookupFailedError => ({
    cause,
    code: "SAML_LOOKUP_FAILED",
    message: `github: SAML email lookup unavailable (${errorMessage({ error: cause })}) — emails limited to public profile`,
  }),
  samlNoProvider: (): SamlNoProviderError => ({
    code: "SAML_NO_PROVIDER",
    message:
      "github: no SAML external identities (needs an org-admin token + a SAML org) — emails limited to public profile",
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// activity.ts — per-item GraphQL enrichment
// ---------------------------------------------------------------------------------------------------------

/** The GraphQL response had no `pullRequest`/`issue` node for the requested number. */
export interface ActivityNodeNotFoundError {
  readonly code: "ACTIVITY_NODE_NOT_FOUND";
  readonly message: string;
  readonly number: number;
  readonly isPr: boolean;
}

/** The GraphQL transport threw while enriching one item. */
export interface ActivityFetchFailedError {
  readonly code: "ACTIVITY_FETCH_FAILED";
  readonly message: string;
  readonly number: number;
  readonly cause?: unknown;
}

/** Every failure `src/corpus/github/activity.ts` can produce. */
export type GithubActivityError = ActivityNodeNotFoundError | ActivityFetchFailedError;

export const GithubActivityErrors = {
  fetchFailed: ({ number, cause }: { number: number; cause: unknown }): ActivityFetchFailedError => ({
    cause,
    code: "ACTIVITY_FETCH_FAILED",
    message: cause instanceof Error ? cause.message : `activity fetch failed for #${String(number)}`,
    number,
  }),
  nodeNotFound: ({ number, isPr }: { number: number; isPr: boolean }): ActivityNodeNotFoundError => ({
    code: "ACTIVITY_NODE_NOT_FOUND",
    isPr,
    message: `no ${isPr ? "pull request" : "issue"} #${String(number)} in GraphQL response`,
    number,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// fetch.ts — REST search discovery + the repo-existence precheck
// ---------------------------------------------------------------------------------------------------------

/** The repo precheck got a 404/422/403 — the slug is wrong or the token can't see it. */
export interface RepoNotFoundError {
  readonly code: "REPO_NOT_FOUND";
  readonly message: string;
  readonly repo: string;
}

/** The repo precheck threw for a reason OTHER than a not-found status. */
export interface RepoPrecheckFailedError {
  readonly code: "REPO_PRECHECK_FAILED";
  readonly message: string;
  readonly repo: string;
  readonly cause?: unknown;
}

/** REST search paging threw — fatal, never a partial write. */
export interface SearchFailedError {
  readonly code: "SEARCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every failure `src/corpus/github/fetch.ts` can produce. */
export type GithubFetchError = RepoNotFoundError | RepoPrecheckFailedError | SearchFailedError;

export const GithubFetchErrors = {
  repoNotFound: ({ owner, repo }: { owner: string; repo: string }): RepoNotFoundError => ({
    code: "REPO_NOT_FOUND",
    message: `repo ${owner}/${repo} not found or inaccessible — check the org slug`,
    repo: `${owner}/${repo}`,
  }),
  repoPrecheckFailed: ({
    owner,
    repo,
    cause,
  }: {
    owner: string;
    repo: string;
    cause: unknown;
  }): RepoPrecheckFailedError => ({
    cause,
    code: "REPO_PRECHECK_FAILED",
    message: cause instanceof Error ? cause.message : "github repo precheck failed",
    repo: `${owner}/${repo}`,
  }),
  searchFailed: ({ cause }: { cause: unknown }): SearchFailedError => ({
    cause,
    code: "SEARCH_FAILED",
    message: cause instanceof Error ? cause.message : "github search failed",
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// org.ts, orgApi.ts — org/repo/team structural enumeration
// ---------------------------------------------------------------------------------------------------------

/** `listRepos` paging threw — fatal, with no repo set there's nothing to ingest. */
export interface RepoEnumerationFailedError {
  readonly code: "REPO_ENUMERATION_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** `teams.list` failed (typically a missing `read:org` scope) — degrades to a warning upstream. */
export interface TeamsUnavailableError {
  readonly code: "TEAMS_UNAVAILABLE";
  readonly message: string;
  readonly reason: string;
}

/** Every failure `src/corpus/github/org.ts` and `src/corpus/github/orgApi.ts` can produce. */
export type GithubOrgError = RepoEnumerationFailedError | TeamsUnavailableError;

export const GithubOrgErrors = {
  repoEnumerationFailed: ({ cause }: { cause: unknown }): RepoEnumerationFailedError => ({
    cause,
    code: "REPO_ENUMERATION_FAILED",
    message: `github repo enumeration failed: ${errorMessage({ error: cause })}`,
  }),
  teamsUnavailable: ({ reason }: { reason: string }): TeamsUnavailableError => ({
    code: "TEAMS_UNAVAILABLE",
    message: `github: teams unavailable (${reason}) — needs an org-admin token with read:org`,
    reason,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// mergeAsync.ts — the asynchronous merge body's projection
// ---------------------------------------------------------------------------------------------------------

/** The clause naming the request a refused body still identified, or nothing when it identified none. */
function requestClause({ request }: { request: string | undefined }): string {
  if (request === undefined) {
    return "";
  }
  return ` (request ${request})`;
}

/** The `merge-async` body was not a JSON object at all. */
export interface AsyncMergeNotAnObjectError {
  readonly code: "ASYNC_MERGE_NOT_AN_OBJECT";
  readonly message: string;
}

/** GitHub reported a status outside the four it documents for this endpoint. */
export interface AsyncMergeUnknownStatusError {
  readonly code: "ASYNC_MERGE_UNKNOWN_STATUS";
  readonly message: string;
  /** The status as GitHub sent it, rendered as a string. */
  readonly status: string;
  /** The request id found anywhere in the body, so an accepted job can still be found. */
  readonly request: string | undefined;
}

/** The body named a known status but carried no `details` object to read it from. */
export interface AsyncMergeMissingDetailsError {
  readonly code: "ASYNC_MERGE_MISSING_DETAILS";
  readonly message: string;
  readonly status: string;
  /** The request id found anywhere in the body, so an accepted job can still be found. */
  readonly request: string | undefined;
}

/** The body's `details` carried no non-blank `message`, which is what a failure reports. */
export interface AsyncMergeMissingMessageError {
  readonly code: "ASYNC_MERGE_MISSING_MESSAGE";
  readonly message: string;
  readonly status: string;
  /** The request id found anywhere in the body, so an accepted job can still be found. */
  readonly request: string | undefined;
}

/** GitHub accepted the merge as pending but named no `details.uuid` a poll could use. */
export interface AsyncMergePendingWithoutUuidError {
  readonly code: "ASYNC_MERGE_PENDING_WITHOUT_UUID";
  readonly message: string;
  /** An id found somewhere OTHER than `details.uuid`, reported for the operator and never polled. */
  readonly salvaged: string | undefined;
}

/** Every failure `src/corpus/github/mergeAsync.ts` can produce. */
export type GithubAsyncMergeError =
  | AsyncMergeNotAnObjectError
  | AsyncMergeUnknownStatusError
  | AsyncMergeMissingDetailsError
  | AsyncMergeMissingMessageError
  | AsyncMergePendingWithoutUuidError;

export const GithubAsyncMergeErrors = {
  missingDetails: ({
    status,
    request,
  }: {
    status: string;
    request: string | undefined;
  }): AsyncMergeMissingDetailsError => ({
    code: "ASYNC_MERGE_MISSING_DETAILS",
    message: `GitHub's asynchronous merge response (${status}) carried no details object${requestClause({ request })}`,
    request,
    status,
  }),
  missingMessage: ({
    status,
    request,
  }: {
    status: string;
    request: string | undefined;
  }): AsyncMergeMissingMessageError => ({
    code: "ASYNC_MERGE_MISSING_MESSAGE",
    message: `GitHub's asynchronous merge response (${status}) carried no details.message${requestClause({ request })}`,
    request,
    status,
  }),
  notAnObject: (): AsyncMergeNotAnObjectError => ({
    code: "ASYNC_MERGE_NOT_AN_OBJECT",
    message: "GitHub's asynchronous merge response was not an object",
  }),
  pendingWithoutUuid: ({ salvaged }: { salvaged: string | undefined }): AsyncMergePendingWithoutUuidError => {
    if (salvaged === undefined) {
      return {
        code: "ASYNC_MERGE_PENDING_WITHOUT_UUID",
        message: "GitHub accepted an asynchronous merge as pending but named no uuid to poll it by",
        salvaged,
      };
    }
    return {
      code: "ASYNC_MERGE_PENDING_WITHOUT_UUID",
      message:
        "GitHub accepted an asynchronous merge as pending but named no uuid at details.uuid to poll it by " +
        `(request ${salvaged} was found elsewhere in the response)`,
      salvaged,
    };
  },
  unknownStatus: ({
    status,
    request,
  }: {
    status: string;
    request: string | undefined;
  }): AsyncMergeUnknownStatusError => ({
    code: "ASYNC_MERGE_UNKNOWN_STATUS",
    message: `GitHub reported an asynchronous merge status this build does not know: ${status}${requestClause({ request })}`,
    request,
    status,
  }),
} as const;
