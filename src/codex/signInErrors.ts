/**
 * The typed failure kinds of the Codex SIGN-IN OBSERVATIONS — reading and writing the store's
 * `codex_sign_in_observation` rows, and the once-per-alias import from a `$SLOPWEAVER_HOME/codex-signin/<alias>.json`
 * written before the store held them.
 *
 * Per `.claude/rules/error-handling.md` this union stands alone: it shares no base type with the plan register's,
 * though both live in the same store, because a sign-in observation failing to read says nothing about which plans
 * exist and a reader must never be able to confuse the two.
 *
 * ## Which of these a routing read survives
 *
 * Every one of them. The live read that files an observation is how Codex keeps working, and unblocking Codex
 * outranks the card (the owner's priority is unblocking Codex usage), so
 * `./fleetRead.ts` prints each refusal and returns its snapshot. The monitor reads each as unmeasurable, never as
 * clear: an observation nobody can read may be the refusal that should be on the owner's queue.
 *
 * **No variant carries a credential.** An observation holds an alias, a path and `auth.json`'s stat, never a byte
 * of it, and a store message never carries the connection string.
 */

/** Where an undecodable observation was found: the authoritative row, or the file it would have been imported from. */
type CodexSignInObservationSource = "import-file" | "store";

/** The store holding the observations could not be selected, reached, or queried. Nothing was read or written. */
export interface CodexSignInStoreUnavailableError {
  readonly code: "CODEX_SIGN_IN_STORE_UNAVAILABLE";
  readonly message: string;
}

/** A value no plan register would accept as an alias reached the store; it never becomes a key or a path. */
export interface CodexSignInAliasInvalidError {
  readonly code: "CODEX_SIGN_IN_ALIAS_INVALID";
  readonly message: string;
  readonly alias: string;
}

/** A stored row, or a readable import file, holds something that does not decode as an observation. */
export interface CodexSignInObservationInvalidError {
  readonly code: "CODEX_SIGN_IN_OBSERVATION_INVALID";
  readonly message: string;
  readonly alias: string;
  readonly source: CodexSignInObservationSource;
  /** Which field stops it decoding. */
  readonly why: string;
}

/**
 * The import file is PRESENT and could not be read — a permission error, a directory that cannot be searched, a
 * FIFO. It may hold a perfectly good refusal, so nothing is imported over it and nothing is written past it.
 */
export interface CodexSignInImportUnreadableError {
  readonly code: "CODEX_SIGN_IN_IMPORT_UNREADABLE";
  readonly message: string;
  readonly alias: string;
  readonly path: string;
}

/**
 * Another pass committed this alias between this pass's read and its compare-and-set. Nothing was written, and
 * nothing retries: the observation waits for the next fleet read, exactly as a held lock once made it.
 */
export interface CodexSignInRevisionConflictError {
  readonly code: "CODEX_SIGN_IN_REVISION_CONFLICT";
  readonly message: string;
  readonly alias: string;
  /** The revision this writer read and pinned its update to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** Why one alias could not be read: every per-alias failure a read can produce. */
export type CodexSignInAliasRefusal =
  CodexSignInAliasInvalidError | CodexSignInObservationInvalidError | CodexSignInImportUnreadableError;

/** Every failure kind the sign-in observations can produce. */
export type CodexSignInError =
  CodexSignInStoreUnavailableError | CodexSignInAliasRefusal | CodexSignInRevisionConflictError;

/** Construct a {@link CodexSignInError}. Tests build fixtures through here, never as object literals. */
export const CodexSignInErrors = {
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): CodexSignInStoreUnavailableError => ({
    code: "CODEX_SIGN_IN_STORE_UNAVAILABLE",
    message:
      `the Codex sign-in observations live in the store, and the store could not ${doing}, so whether a Codex ` +
      `plan is signed out is UNKNOWN (\`slopweaver store status\` says what the store is doing). The store said: ` +
      reason,
  }),
  aliasInvalid: ({ alias }: { alias: string }): CodexSignInAliasInvalidError => ({
    alias,
    code: "CODEX_SIGN_IN_ALIAS_INVALID",
    message: `${JSON.stringify(alias)} is not a plan alias, so no sign-in observation is read or filed under it`,
  }),
  storedObservationInvalid: ({ alias, why }: { alias: string; why: string }): CodexSignInObservationInvalidError => ({
    alias,
    code: "CODEX_SIGN_IN_OBSERVATION_INVALID",
    message: `the stored sign-in observation for ${alias} ${why}`,
    source: "store",
    why,
  }),
  importObservationInvalid: ({
    alias,
    path,
    why,
  }: {
    alias: string;
    path: string;
    why: string;
  }): CodexSignInObservationInvalidError => ({
    alias,
    code: "CODEX_SIGN_IN_OBSERVATION_INVALID",
    message: `${path} ${why}`,
    source: "import-file",
    why,
  }),
  importUnreadable: ({
    alias,
    path,
    why,
  }: {
    alias: string;
    path: string;
    why: string;
  }): CodexSignInImportUnreadableError => ({
    alias,
    code: "CODEX_SIGN_IN_IMPORT_UNREADABLE",
    message: `${path} exists and could not be read, so it is neither imported nor written past: ${why}`,
    path,
  }),
  revisionConflict: ({
    alias,
    expectedRevision,
  }: {
    alias: string;
    expectedRevision: number;
  }): CodexSignInRevisionConflictError => ({
    alias,
    code: "CODEX_SIGN_IN_REVISION_CONFLICT",
    expectedRevision,
    message:
      `another read filed ${alias}'s sign-in observation while this one was judging it (it was read at revision ` +
      `${String(expectedRevision)}), so this observation waits for the next read`,
  }),
} as const;
