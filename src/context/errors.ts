/**
 * Why the last-known-good context cache could not be read or written, as a typed union.
 *
 * `cache.ts` used to answer every one of these with a plain string, on the reasoning that a caller does
 * the same thing either way — it says "no cached context" and emits the unavailable block. That reasoning
 * still holds for the DISPLAY, and `message` is what the block prints. What it did not hold for is the
 * `error-shape-threshold` gate's actual subject: five distinct message shapes authored into `err()` in one
 * directory is the point past which a reader can no longer see, from any one site, what the whole failure
 * set is. So the shapes are named once, here, and a caller that ever does want to branch — a fresh install
 * seeing `CACHE_ABSENT` rather than a corruption — now can, without a string comparison.
 *
 * Read `.message` to display; `.code` to branch.
 */

/** No cache file exists, which on a fresh install is the normal state rather than a fault. */
export interface ContextCacheAbsentError {
  readonly code: "CACHE_ABSENT";
  readonly message: string;
}

/** The file is there and is not JSON — a truncated write, or something else at that path. */
export interface ContextCacheUnreadableError {
  readonly code: "CACHE_UNREADABLE";
  readonly message: string;
}

/** The file parsed but is not the current cache shape, so it is ignored rather than reinterpreted. */
export interface ContextCacheStaleSchemaError {
  readonly code: "CACHE_SCHEMA_MISMATCH";
  readonly message: string;
}

/**
 * The cache was captured against a different database, so emitting it would describe another install.
 *
 * The fingerprints are carried rather than only rendered, because this is the one failure whose diagnosis
 * is a comparison: a reader asking "which database is this cache from" has both halves in hand.
 */
export interface ContextCacheForeignStoreError {
  readonly code: "CACHE_FOREIGN_STORE";
  readonly message: string;
  /** The fingerprint of the database being read now. */
  readonly expected: string;
  /** The fingerprint the cache carries. */
  readonly actual: string;
}

/** The write failed, carrying the filesystem's own reason forward rather than discarding it. */
export interface ContextCacheWriteFailedError {
  readonly code: "CACHE_WRITE_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Every way the context cache can refuse a read or a write. */
export type ContextCacheError =
  | ContextCacheAbsentError
  | ContextCacheUnreadableError
  | ContextCacheStaleSchemaError
  | ContextCacheForeignStoreError
  | ContextCacheWriteFailedError;

/** Build one of the five, so a test constructs a failure the same way the real code does. */
export const ContextCacheErrors = {
  absent: (): ContextCacheAbsentError => ({
    code: "CACHE_ABSENT",
    message: "no cached context has ever been written on this machine",
  }),
  foreignStore: ({ expected, actual }: { expected: string; actual: string }): ContextCacheForeignStoreError => ({
    actual,
    code: "CACHE_FOREIGN_STORE",
    expected,
    message: "the cached context was captured against a different database",
  }),
  staleSchema: (): ContextCacheStaleSchemaError => ({
    code: "CACHE_SCHEMA_MISMATCH",
    message: "the cached context does not match the current cache schema",
  }),
  unreadable: (): ContextCacheUnreadableError => ({
    code: "CACHE_UNREADABLE",
    message: "the cached context is not readable JSON",
  }),
  writeFailed: ({ cause }: { cause: unknown }): ContextCacheWriteFailedError => ({
    cause,
    code: "CACHE_WRITE_FAILED",
    message: `could not write the context cache: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;
