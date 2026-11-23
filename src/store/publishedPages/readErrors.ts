/**
 * The ways READING a published page out of the store fails that are this domain's own: a page that was never frozen,
 * rows that contradict each other, and a connection step that threw. A query or a bucket failure arrives as the
 * store's or the bucket's own union, carried beside these rather than flattened, and a clean absence is never one of
 * them — a file the store does not hold is `ok(false)`, never an error read as "absent".
 */
import type { StoreError } from "../errors.js";
import type { ObjectStoreError } from "../objects/errors.js";

/** The store holds no freeze of this key: never published through the freeze, or never published at all. */
export interface PublishedPageNeverFrozenError {
  readonly code: "PAGES_NEVER_FROZEN";
  readonly message: string;
  readonly pageKey: string;
}

/** The store holds no local page under this slug, so there is nothing to open. */
export interface PublishedPageNotPublishedError {
  readonly code: "PAGES_NOT_PUBLISHED";
  readonly message: string;
  readonly pageKey: string;
}

/** The rows answer two incompatible things about one page, so no answer is trustworthy. */
export interface PublishedPagesReadInconsistentError {
  readonly code: "PAGES_READ_INCONSISTENT";
  readonly message: string;
  readonly pageKey: string;
  readonly detail: string;
}

/** A connection step threw rather than answering. */
export interface PublishedPagesReadUnavailableError {
  readonly code: "PAGES_READ_UNAVAILABLE";
  readonly message: string;
  readonly cause: unknown;
}

/** Every way a published-page read fails. */
export type PublishedPagesReadError =
  | ObjectStoreError
  | PublishedPageNeverFrozenError
  | PublishedPageNotPublishedError
  | PublishedPagesReadInconsistentError
  | PublishedPagesReadUnavailableError
  | StoreError;

export const PublishedPagesReadErrors = {
  inconsistent: ({ pageKey, detail }: { pageKey: string; detail: string }): PublishedPagesReadInconsistentError => ({
    code: "PAGES_READ_INCONSISTENT",
    detail,
    message: `the store's rows for ${pageKey} contradict each other: ${detail}. Re-run \`slopweaver store pages-import\``,
    pageKey,
  }),
  neverFrozen: ({ pageKey }: { pageKey: string }): PublishedPageNeverFrozenError => ({
    code: "PAGES_NEVER_FROZEN",
    message:
      `the store holds no frozen version of ${pageKey}: publish it with \`slopweaver page publish\`, which freezes ` +
      "and stores it, before anything diffs against it",
    pageKey,
  }),
  notPublished: ({ pageKey }: { pageKey: string }): PublishedPageNotPublishedError => ({
    code: "PAGES_NOT_PUBLISHED",
    message: `the store holds no published page ${pageKey}`,
    pageKey,
  }),
  unavailable: ({ cause, doing }: { cause: unknown; doing: string }): PublishedPagesReadUnavailableError => ({
    cause,
    code: "PAGES_READ_UNAVAILABLE",
    message: `the published-page store did not ${doing}: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;
