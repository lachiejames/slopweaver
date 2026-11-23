/**
 * The typed domain error for a Linear named-object read or search — see `.claude/rules/error-handling.md`
 * for the shape. Its own type, not shared with `GithubLiveError`/`NotionLiveError`.
 *
 * The variants are declared in the order {@link LinearLiveErrors} builds them, so each interface sits in
 * the same place as its factory.
 */

/** The question named more than one candidate object; the read needs exactly one. */
export interface AmbiguousAddressError {
  readonly code: "AMBIGUOUS_ADDRESS";
  readonly message: string;
}

/**
 * One Linear-hosted asset addressed by a payload could not be fetched, or was fetched and could not be
 * read as a document.
 *
 * Carried per ASSET rather than folded into {@link ReadFailedError}, because a read that reached the
 * object and failed on one of its attachments has still succeeded — the object is there and the other
 * attachments are there. `../slack/fileDownloads.ts` documents that call having already been got wrong
 * once in the other direction, where one missing PDF discarded the whole thread.
 */
export interface AssetUnreachableError {
  readonly code: "ASSET_UNREACHABLE";
  readonly message: string;
  /** The asset address, so a caller can re-try it or cite it without re-deriving one. */
  readonly url: string;
}

/** The caller-supplied address could not be parsed as a Linear issue identifier or object URL. */
export interface InvalidAddressError {
  readonly code: "INVALID_ADDRESS";
  readonly message: string;
}

/** Linear answered the query but the named object does not exist, or is not visible to the credential. */
export interface NotFoundError {
  readonly code: "NOT_FOUND";
  readonly message: string;
  readonly identity: string;
}

/** The provider call itself failed (network, rate limit, GraphQL error). */
export interface ReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** The caller named an activity connection this reader does not have. */
export interface UnknownActivityError {
  readonly code: "UNKNOWN_ACTIVITY";
  readonly message: string;
  /** The names that are not connections, in the order the caller wrote them. */
  readonly unknown: readonly string[];
}

/**
 * The caller named a real activity connection that this KIND of object does not have — history on a document,
 * anything on a project. Refused rather than dropped: a read that quietly skips the comments it was asked for
 * answers "no comments", which is the failure `--include` exists to prevent.
 */
export interface ActivityUnavailableError {
  readonly code: "ACTIVITY_UNAVAILABLE";
  readonly message: string;
  /** The connections asked for that this kind does not have. */
  readonly unavailable: readonly string[];
}

/** The search provider call itself failed. */
export interface SearchFailedError {
  readonly code: "SEARCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every failure a Linear named-object read or issue/project search can produce. */
export type LinearLiveError =
  | ActivityUnavailableError
  | AssetUnreachableError
  | InvalidAddressError
  | AmbiguousAddressError
  | NotFoundError
  | ReadFailedError
  | SearchFailedError
  | UnknownActivityError;

/** Factories for every {@link LinearLiveError} variant. */
export const LinearLiveErrors = {
  /** @returns an {@link AmbiguousAddressError} naming the ambiguity */
  ambiguousAddress: ({ message }: { message: string }): AmbiguousAddressError => ({
    code: "AMBIGUOUS_ADDRESS",
    message,
  }),

  /** @returns an {@link AssetUnreachableError} naming the address and why it yielded no document */
  assetUnreachable: ({ url, reason }: { url: string; reason: string }): AssetUnreachableError => ({
    code: "ASSET_UNREACHABLE",
    message: `${url}: ${reason}`,
    url,
  }),

  /** @returns an {@link InvalidAddressError} carrying the caller-facing reason */
  invalidAddress: ({ message }: { message: string }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message,
  }),

  /** @returns a {@link NotFoundError} naming the object kind and its resolved identity */
  notFound: ({ identity, kind }: { identity: string; kind: string }): NotFoundError => ({
    code: "NOT_FOUND",
    identity,
    message: `Linear returned no ${kind} at that address — it may not exist or be visible`,
  }),

  /** @returns a {@link ReadFailedError} wrapping the underlying provider failure */
  readFailed: ({ message, cause }: { message: string; cause?: unknown }): ReadFailedError => ({
    code: "READ_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns an {@link UnknownActivityError} naming what was not recognised and what is accepted */
  unknownActivity: ({
    unknown,
    known,
  }: {
    unknown: readonly string[];
    known: readonly string[];
  }): UnknownActivityError => ({
    code: "UNKNOWN_ACTIVITY",
    message: `--include does not know ${unknown.join(", ")}; it takes any of ${known.join(", ")}`,
    unknown,
  }),

  /** @returns an {@link ActivityUnavailableError} naming what this kind lacks and what it does have */
  activityUnavailable: ({
    kind,
    unavailable,
    available,
  }: {
    kind: string;
    unavailable: readonly string[];
    available: readonly string[];
  }): ActivityUnavailableError => ({
    code: "ACTIVITY_UNAVAILABLE",
    message:
      available.length === 0
        ? `a Linear ${kind} has no activity connections, so --include ${unavailable.join(", ")} cannot be read`
        : `a Linear ${kind} has no ${unavailable.join(", ")} connection; --include takes ${available.join(", ")} here`,
    unavailable,
  }),

  /** @returns a {@link SearchFailedError} wrapping the underlying provider failure */
  searchFailed: ({ message, cause }: { message: string; cause?: unknown }): SearchFailedError => ({
    code: "SEARCH_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),
} as const;
