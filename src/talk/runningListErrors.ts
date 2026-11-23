/**
 * The running list's typed errors — its own union, never shared (`.claude/rules/error-handling.md`).
 *
 * A caller branches on two of these: `INPUT_INVALID` is a draft the verb refuses before any I/O, and
 * `STORE_UNREADABLE` is a list file that exists and will not decode, which a reader reports rather than taking
 * for an empty list — an empty list read off a broken file would tell the owner a week of items had gone.
 */

/** A draft the list will not hold: empty or over-long text, a bad origin, a field the origin does not take. */
export interface InputInvalidError {
  readonly code: "INPUT_INVALID";
  readonly message: string;
  readonly field: string;
}

/** The list file exists and did not decode as a running list. */
export interface StoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * The list file holds an item whose origin is the owner's retired pronoun spelling. A build before the rename read it
 * as the owner's; this one reads only `owner`, so the file is refused by name with its repair, never as a generic
 * unreadable list.
 */
export interface RetiredOriginError {
  readonly code: "RETIRED_ORIGIN";
  readonly message: string;
  readonly path: string;
  /** The 1-based position of the first such item in the stored `items` array. */
  readonly row: number;
  /** The retired value the item carries. */
  readonly origin: string;
}

/** The list file or its directory could not be read or written. */
export interface StoreIoError {
  readonly code: "STORE_IO";
  readonly message: string;
  readonly path: string;
}

/** Another writer held the list's lock past the wait. */
export interface LockHeldError {
  readonly code: "LOCK_HELD";
  readonly message: string;
  readonly path: string;
}

/** Every way reading or adding to the running list fails. */
export type RunningListError =
  InputInvalidError | StoreUnreadableError | RetiredOriginError | StoreIoError | LockHeldError;

/** The last trunk commit that still carries `slopweaver home respell`, the verb that rewrote the retired spelling. */
export const LAST_RESPELL_COMMIT = "46ebff6b3f";

/** The one place each variant's message is worded. */
export const RunningListErrors = {
  inputInvalid: ({ field, why }: { field: string; why: string }): InputInvalidError => ({
    code: "INPUT_INVALID",
    field,
    message: `the running list will not hold this ${field}: ${why}`,
  }),
  lockHeld: ({ path, cause }: { path: string; cause: unknown }): LockHeldError => ({
    code: "LOCK_HELD",
    message: `another writer held the running list's lock — ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  retiredOrigin: ({ path, row, origin }: { path: string; row: number; origin: string }): RetiredOriginError => ({
    code: "RETIRED_ORIGIN",
    message:
      `the running list at ${path} holds a retired origin at item ${String(row)} ("${origin}"), which this build no ` +
      `longer reads as the owner's — change that item's "origin" to "owner" in the file, or run ` +
      `slopweaver home respell from commit ${LAST_RESPELL_COMMIT}, the last that carries it`,
    origin,
    path,
    row,
  }),
  storeIo: ({ path, cause }: { path: string; cause: unknown }): StoreIoError => ({
    code: "STORE_IO",
    message: `the running list at ${path} could not be used — ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  storeUnreadable: ({ path, why }: { path: string; why: string }): StoreUnreadableError => ({
    code: "STORE_UNREADABLE",
    message: `the running list at ${path} is not a running list: ${why}`,
    path,
  }),
} as const;
