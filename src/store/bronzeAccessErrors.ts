/**
 * The store's failures reading bronze off disk, split from `./errors.ts` along that seam the way
 * `./lifecycleErrors.ts` is: every one is a fact about a local path rather than about the database. All are
 * members of the one `StoreError` union, and their factories are spread into `StoreErrors`, so a caller still
 * reaches them as `StoreErrors.bronzeProtected`.
 */

/**
 * A bronze file the drift scan had to read could not be read at all.
 *
 * Distinct from `STORE_QUERY_FAILED` on purpose: that one means the DATABASE said no, and a reader who sees it
 * goes and looks at Postgres. An unreadable bronze file is a local filesystem fact — a permission, a truncated
 * write, a directory that moved — and the remedy is on disk. Folding the two together would send every reader
 * to the wrong half of the system.
 */
export interface StoreBronzeUnreadableError {
  readonly code: "BRONZE_UNREADABLE";
  readonly message: string;
  /** Which file, so the remedy is one `ls -l` away. */
  readonly path: string;
  readonly cause?: unknown;
}

/**
 * A bronze path a store verb was about to list or read sits on the owner's protect list as `no-access`.
 *
 * Distinct from `BRONZE_UNREADABLE` on purpose: that one is a filesystem fault with a remedy on disk, and this
 * one is the owner's own choice with NO remedy a session may take. A caller branches on it — `store status`
 * reports the source as withheld and carries on with the rest — where an unreadable file stops the measurement.
 */
export interface StoreBronzeProtectedError {
  readonly code: "BRONZE_PROTECTED";
  readonly message: string;
  /** The bronze path the verb was about to reach. */
  readonly path: string;
  /** The protect-list entry it reaches. */
  readonly protectedPath: string;
  /** The owner's reason, as the protect list records it. */
  readonly why: string;
}

/**
 * The owner's protect list could not be read, so which bronze is off limits is unknown.
 *
 * The store verbs FAIL CLOSED on it, unlike the `PreToolUse` tripwire, which fails open because wedging every
 * tool call on one bad byte is worse. A deliberate verb that cannot say what it may read reads nothing.
 */
export interface StoreProtectionUnknownError {
  readonly code: "PROTECTION_UNKNOWN";
  readonly message: string;
}

/** Every failure reading bronze off disk. */
export type StoreBronzeAccessError =
  StoreBronzeUnreadableError | StoreBronzeProtectedError | StoreProtectionUnknownError;

/** The bronze-access factories, spread into `StoreErrors`. */
export const StoreBronzeAccessErrors = {
  bronzeProtected: ({
    path,
    protectedPath,
    why,
  }: {
    path: string;
    protectedPath: string;
    why: string;
  }): StoreBronzeProtectedError => ({
    code: "BRONZE_PROTECTED",
    message:
      `bronze at ${path} reaches ${protectedPath}, which the owner's protect list marks no-access (${why}), so ` +
      "none of it is read. A session never takes a path off the protect list; `slopweaver protect list` shows why.",
    path,
    protectedPath,
    why,
  }),
  bronzeUnreadable: ({ cause, path }: { cause: unknown; path: string }): StoreBronzeUnreadableError => ({
    cause,
    code: "BRONZE_UNREADABLE",
    message: `bronze at ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  protectionUnknown: ({ reason }: { reason: string }): StoreProtectionUnknownError => ({
    code: "PROTECTION_UNKNOWN",
    message: `the owner's protect list could not be read, so no bronze is read: ${reason}`,
  }),
} as const;
