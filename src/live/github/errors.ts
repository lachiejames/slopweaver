/**
 * The typed domain error for a GitHub named-object read or search. See `.claude/rules/error-handling.md` for
 * the shape (discriminated union + factory object) and why this union is scoped to GitHub alone rather than
 * shared with Linear/Notion's own `LinearLiveError`/`NotionLiveError`.
 */

import { unsignedAddress } from "./media.js";

/** The caller-supplied address could not be parsed as a GitHub object link. */
export interface InvalidAddressError {
  readonly code: "INVALID_ADDRESS";
  readonly message: string;
}

/** The question named more than one candidate object; the read needs exactly one. */
export interface AmbiguousAddressError {
  readonly code: "AMBIGUOUS_ADDRESS";
  readonly message: string;
}

/** GitHub answered the query but the named object does not exist, or the credential cannot see it. */
export interface NotFoundError {
  readonly code: "NOT_FOUND";
  readonly message: string;
  readonly identity: string;
}

/**
 * A pull-request address that GitHub answered with an issue. `issueOrPullRequest` resolves either kind at a
 * number, so the node is real, but no pull request holds that number — distinct from {@link NotFoundError}
 * because the object a caller could read instead is named.
 */
export interface NotAPullRequestError {
  readonly code: "NOT_A_PULL_REQUEST";
  readonly message: string;
  readonly identity: string;
}

/** The provider call itself failed (network, rate limit, GraphQL error). */
export interface ReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * GitHub refused the read on its rate limit. Distinct from {@link ReadFailedError} because it names its own end:
 * a waiting caller outlasts it, where any other read failure is a reason to stop.
 */
export interface RateLimitedError {
  readonly code: "RATE_LIMITED";
  readonly message: string;
  /** When the limit resets, from the response itself; `undefined` when GitHub did not say. */
  readonly resetAt: string | undefined;
  readonly cause?: unknown;
}

/** A search was requested with a blank term. */
export interface InvalidTermError {
  readonly code: "INVALID_TERM";
  readonly message: string;
}

/** The search provider call itself failed. */
export interface SearchFailedError {
  readonly code: "SEARCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** The rendered body could not be read for its attachments. */
export interface MediaUnreadableError {
  readonly code: "MEDIA_UNREADABLE";
  readonly message: string;
}

/** One attachment could not be fetched. The message names its address WITHOUT the signing query. */
export interface MediaDownloadFailedError {
  readonly code: "MEDIA_DOWNLOAD_FAILED";
  readonly message: string;
  readonly address: string;
}

/** A fetched attachment could not be written to the directory asked for. */
export interface MediaWriteFailedError {
  readonly code: "MEDIA_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Media was asked of an object whose body this reader does not render for it. */
export interface MediaUnsupportedError {
  readonly code: "MEDIA_UNSUPPORTED";
  readonly message: string;
}

/** Every failure a GitHub named-object read or repository search can produce. */
export type GithubLiveError =
  | InvalidAddressError
  | AmbiguousAddressError
  | NotFoundError
  | NotAPullRequestError
  | ReadFailedError
  | RateLimitedError
  | InvalidTermError
  | SearchFailedError
  | MediaUnreadableError
  | MediaDownloadFailedError
  | MediaWriteFailedError
  | MediaUnsupportedError;

/** Factories for every {@link GithubLiveError} variant. */
export const GithubLiveErrors = {
  /** @returns an {@link AmbiguousAddressError} naming the ambiguity */
  ambiguousAddress: ({ message }: { message: string }): AmbiguousAddressError => ({
    code: "AMBIGUOUS_ADDRESS",
    message,
  }),

  /** @returns an {@link InvalidAddressError} carrying the caller-facing reason */
  invalidAddress: ({ message }: { message: string }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message,
  }),

  /** @returns an {@link InvalidTermError} for a blank search term */
  invalidTerm: ({ message }: { message: string }): InvalidTermError => ({
    code: "INVALID_TERM",
    message,
  }),

  /** @returns a {@link NotFoundError} naming the object kind and its resolved identity */
  notFound: ({ identity, kind }: { identity: string; kind: string }): NotFoundError => ({
    code: "NOT_FOUND",
    identity,
    message: `GitHub returned no ${kind} at that address — it may not exist or the credential cannot read it`,
  }),

  /** @returns a {@link NotAPullRequestError} naming the issue URL that answered the pull-request address */
  notAPullRequest: ({ identity, issueUrl }: { identity: string; issueUrl: string }): NotAPullRequestError => ({
    code: "NOT_A_PULL_REQUEST",
    identity,
    message: `no pull request holds ${identity} — GitHub answered that number with an issue; read ${issueUrl} for it`,
  }),

  /** @returns a {@link RateLimitedError} whose message carries GitHub's own words and the reset, when known */
  rateLimited: ({
    message,
    resetAt,
    cause,
  }: {
    message: string;
    resetAt: string | undefined;
    cause?: unknown;
  }): RateLimitedError => ({
    code: "RATE_LIMITED",
    message:
      resetAt === undefined
        ? `${message} (rate limited; GitHub named no reset)`
        : `${message} (rate limited until ${resetAt})`,
    resetAt,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns a {@link ReadFailedError} wrapping the underlying provider failure */
  readFailed: ({ message, cause }: { message: string; cause?: unknown }): ReadFailedError => ({
    code: "READ_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns a {@link SearchFailedError} wrapping the underlying provider failure */
  searchFailed: ({ message, cause }: { message: string; cause?: unknown }): SearchFailedError => ({
    code: "SEARCH_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns a {@link MediaUnreadableError} naming why the rendered body yielded nothing to read */
  mediaUnreadable: ({ reason }: { reason: string }): MediaUnreadableError => ({
    code: "MEDIA_UNREADABLE",
    message: `could not read the body's attachments: ${reason}`,
  }),

  /**
   * @returns a {@link MediaDownloadFailedError} carrying the address with its signing query and fragment removed
   * HERE, so no caller can forget to — `reason` must be wording the caller controls, never provider text
   */
  mediaDownloadFailed: ({ url, reason }: { url: string; reason: string }): MediaDownloadFailedError => {
    const address = unsignedAddress({ url });
    return { address, code: "MEDIA_DOWNLOAD_FAILED", message: `could not download ${address}: ${reason}` };
  },

  /** @returns a {@link MediaUnsupportedError} naming the object kind media cannot be read from */
  mediaUnsupported: ({ kind }: { kind: string }): MediaUnsupportedError => ({
    code: "MEDIA_UNSUPPORTED",
    message: `--media-out reads an issue or pull request body; a ${kind} is not one`,
  }),

  /** @returns a {@link MediaWriteFailedError} naming the file that could not be written */
  mediaWriteFailed: ({ path, reason }: { path: string; reason: string }): MediaWriteFailedError => ({
    code: "MEDIA_WRITE_FAILED",
    message: `could not write ${path}: ${reason}`,
    path,
  }),
} as const;
