/**
 * The body sidecar's own typed failures.
 *
 * A union rather than the default `readonly string[]`, and the reason is the one `error-handling.md` gives
 * for the threshold it enforces: these four are genuinely DIFFERENT KINDS, not four spellings of one. A
 * missing body is ordinary — a corpus written before the sidecar existed carries none, and the caller simply
 * re-fetches. A digest MISMATCH is not ordinary at all: the store is content-addressed, so a file that does
 * not hash to its own name means something wrote over it, and a caller that wants to raise that rather than
 * silently re-fetch needs to be able to tell the two apart. An unparseable body and a body that parses to
 * the wrong shape are the two halves of "the bytes are there and are not a tree", which a re-derivation
 * reports differently from a cache miss.
 *
 * Scoped to this one store, per the no-shared-base rule: there is no corpus-wide error umbrella here and
 * this union is not the start of one.
 */

/** No file is stored under that digest — the ordinary case for a row written before the sidecar existed. */
export interface BodyMissingError {
  readonly code: "BODY_MISSING";
  readonly message: string;
  readonly digest: string;
  readonly path: string;
}

/** The stored bytes do not hash to the name they are under, so something wrote over them. */
export interface BodyDigestMismatchError {
  readonly code: "BODY_DIGEST_MISMATCH";
  readonly message: string;
  readonly digest: string;
  readonly actual: string;
}

/** The bytes are there and are not JSON. */
export interface BodyUnparseableError {
  readonly code: "BODY_UNPARSEABLE";
  readonly message: string;
  readonly digest: string;
  readonly cause: unknown;
}

/** The bytes parse and are not a node array. */
export interface BodyShapeError {
  readonly code: "BODY_NOT_A_TREE";
  readonly message: string;
  readonly digest: string;
}

/** Every way reading a stored body can fail. */
export type NotionBodyError = BodyMissingError | BodyDigestMismatchError | BodyUnparseableError | BodyShapeError;

/** The factory the real code calls, so a test built the same way catches one that stops matching its type. */
export const NotionBodyErrors = {
  digestMismatch: ({ digest, actual }: { digest: string; actual: string }): BodyDigestMismatchError => ({
    actual,
    code: "BODY_DIGEST_MISMATCH",
    digest,
    message: `notion body ${digest} hashes to ${actual} — the stored bytes are not the ones it names`,
  }),
  missing: ({ digest, path }: { digest: string; path: string }): BodyMissingError => ({
    code: "BODY_MISSING",
    digest,
    message: `notion body ${digest} is not in the store at ${path}`,
    path,
  }),
  notATree: ({ digest }: { digest: string }): BodyShapeError => ({
    code: "BODY_NOT_A_TREE",
    digest,
    message: `notion body ${digest} is not a node array`,
  }),
  unparseable: ({ digest, cause }: { digest: string; cause: unknown }): BodyUnparseableError => ({
    cause,
    code: "BODY_UNPARSEABLE",
    digest,
    message: `notion body ${digest} did not parse: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;
