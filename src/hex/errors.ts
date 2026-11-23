/**
 * The Hex READ integration's own error union — every way a read of the workspace can fail, as one typed
 * value a caller branches on.
 *
 * Per `.claude/rules/error-handling.md` this is its own domain: it shares no type with `src/datadog/`'s
 * failures or the atlas's `HexSpecError`, because a caller of a live read needs to tell a missing token
 * (exit 3, print the mint line) from a 403 (the token's role does not open this project) from a 429 (a
 * budget that refills) — and recovering those from message prose is the fragile thing a union exists
 * instead of.
 *
 * Nothing here ever carries the token, and nothing here quotes a response body beyond a bounded prefix: a
 * cell's output that failed to parse is still a cell's output.
 */
import type { BoundaryError } from "../lib/boundary.js";

/** No token could be resolved, so no request was made. */
export interface HexTokenMissingError {
  readonly code: "TOKEN_MISSING";
  readonly message: string;
}

/** Hex answered 401: the token is not accepted at all. */
export interface HexUnauthorizedError {
  readonly code: "UNAUTHORIZED";
  readonly message: string;
  readonly path: string;
}

/** Hex answered 403: the token is accepted, and its role does not open this operation or object. */
export interface HexForbiddenError {
  readonly code: "FORBIDDEN";
  readonly message: string;
  readonly path: string;
}

/** Hex answered 404: the object the path names is not there, or is not visible to this role. */
export interface HexNotFoundError {
  readonly code: "NOT_FOUND";
  readonly message: string;
  readonly path: string;
}

/** Hex answered 429 after the bounded retry: the rate-limit group is exhausted for now. */
export interface HexRateLimitedError {
  readonly code: "RATE_LIMITED";
  readonly message: string;
  readonly path: string;
  /** What `Retry-After` said, or `null` when Hex sent none. */
  readonly retryAfterSeconds: number | null;
}

/** Any other non-2xx status, a refused path, or a request that never reached Hex at all. */
export interface HexRequestFailedError {
  readonly code: "REQUEST_FAILED";
  readonly message: string;
  readonly path: string;
  /** The HTTP status, or `null` when the request never reached Hex — a different fact from any code. */
  readonly status: number | null;
}

/** Hex answered 2xx with a body the endpoint's boundary refuses — a fault, never an empty result. */
export interface HexMalformedResponseError {
  readonly code: "MALFORMED_RESPONSE";
  readonly message: string;
  readonly path: string;
  /** The boundary's own refusal: not JSON, or the shape changed with each new, missing or renamed field named. */
  readonly boundaryError: BoundaryError;
}

/** Every way a Hex read can fail. */
export type HexReadError =
  | HexTokenMissingError
  | HexUnauthorizedError
  | HexForbiddenError
  | HexNotFoundError
  | HexRateLimitedError
  | HexRequestFailedError
  | HexMalformedResponseError;

/**
 * What a caller must do to get a token into this install — named on the error rather than left to a doc.
 *
 * @internal
 */
export const HEX_TOKEN_UNBLOCKED_BY =
  "mint a personal API token at app.hex.tech → Settings → API keys (a write in Hex that is the owner's own " +
  "hand, never a session's), then `slopweaver secrets set hex-api-token`, then `slopweaver hex verify`";

/** The factory every failure is built through — a test constructs its fixtures here too. */
export const HexReadErrors = {
  forbidden: ({ path, detail }: { path: string; detail: string }): HexForbiddenError => ({
    code: "FORBIDDEN",
    message:
      `${path} returned HTTP 403: ${detail} — the token is accepted and its role does not open this; a 403 on ` +
      "one object is not an auth verdict for the workspace",
    path,
  }),
  malformedResponse: ({
    path,
    boundaryError,
  }: {
    path: string;
    boundaryError: BoundaryError;
  }): HexMalformedResponseError => ({
    boundaryError,
    code: "MALFORMED_RESPONSE",
    message:
      `${path} returned a body this integration cannot read: ${boundaryError.message} — a malformed response, NOT ` +
      "an empty result; Hex may have moved this endpoint, which `slopweaver atlas hex sync` reports as spec drift",
    path,
  }),
  notFound: ({ path, detail }: { path: string; detail: string }): HexNotFoundError => ({
    code: "NOT_FOUND",
    message: `${path} returned HTTP 404: ${detail} — the object is not there, or not visible to this token's role`,
    path,
  }),
  rateLimited: ({
    path,
    retryAfterSeconds,
  }: {
    path: string;
    retryAfterSeconds: number | null;
  }): HexRateLimitedError => ({
    code: "RATE_LIMITED",
    message:
      `${path} returned HTTP 429 twice — the Hex API rate-limit group is exhausted` +
      (retryAfterSeconds === null ? "" : `; Hex asks for ${String(retryAfterSeconds)}s`),
    path,
    retryAfterSeconds,
  }),
  requestFailed: ({
    path,
    status,
    detail,
  }: {
    path: string;
    status: number | null;
    detail: string;
  }): HexRequestFailedError => ({
    code: "REQUEST_FAILED",
    message:
      status === null
        ? `${path} could not be reached: ${detail}`
        : `${path} returned HTTP ${String(status)}: ${detail} — reachable and refused, NOT empty`,
    path,
    status,
  }),
  tokenMissing: (): HexTokenMissingError => ({
    code: "TOKEN_MISSING",
    message: `no Hex API token is configured (HEX_API_TOKEN or $SLOPWEAVER_HOME/secrets/hex-api-token). ${HEX_TOKEN_UNBLOCKED_BY}`,
  }),
  unauthorized: ({ path, detail }: { path: string; detail: string }): HexUnauthorizedError => ({
    code: "UNAUTHORIZED",
    message: `${path} returned HTTP 401: ${detail} — the token is not accepted; re-mint it and \`slopweaver secrets set hex-api-token\``,
    path,
  }),
} as const;
