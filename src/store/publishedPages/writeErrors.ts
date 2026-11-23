/**
 * The one way writing a page or a freeze straight into the store fails that a folder import's own union does not
 * name: the store connection would not open, finish or close. Every check, upload and row refusal is the import's own
 * union, carried beside this rather than flattened.
 */
import type { PublishedPagesWriteError } from "./importStore.js";

/** A store step threw rather than answering. */
export interface PageStoreUnavailableError {
  readonly code: "PAGES_STORE_UNAVAILABLE";
  readonly message: string;
  readonly cause: unknown;
}

/** Every way writing one page or one freeze fails. */
export type PublishedPageWriteError = PageStoreUnavailableError | PublishedPagesWriteError;

export const PublishedPageWriteErrors = {
  storeUnavailable: ({ cause, doing }: { cause: unknown; doing: string }): PageStoreUnavailableError => ({
    cause,
    code: "PAGES_STORE_UNAVAILABLE",
    message: `the store connection did not ${doing}: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;
