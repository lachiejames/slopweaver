/**
 * `slopweaver store recover`'s own typed error union — every way a recovery stops before its report. Distinct
 * from `./errors.ts` (a backup, or one restore into the live stack) and `./rehearsalErrors.ts` (a throwaway
 * beside it): a recovery's subject is a whole HOME being rebuilt, and each refusal below names the step a
 * re-run resumes from. They share no base type, per `.claude/rules/error-handling.md`.
 *
 * A conflict is not here. A file or credential the home already holds with different bytes is the recovery
 * WORKING — it is left where it is, reported, and makes the run exit non-zero — because a recovery that
 * overwrote what it found would be the one step of it nobody could undo. The single replacement is the home's
 * own `store-url` repointed at the recovered database, the URL it already held with only the database changed
 * (`./recoverSecrets.ts`), so the login it held is the login it keeps — and only away from a database holding no
 * store, which is the one refusal here that a replacement adds.
 */

/** The local Supabase stack is not running, and a recovery never starts it. */
export interface RecoverStackDownError {
  readonly code: "RECOVER_STACK_DOWN";
  readonly message: string;
  readonly container: string;
}

/** The target database already holds a store this recovery did not restore. */
export interface RecoverDatabaseHoldsStoreError {
  readonly code: "RECOVER_DATABASE_HOLDS_STORE";
  readonly message: string;
  readonly database: string;
}

/**
 * The home's own `store-url` names a database that holds a store, so repointing it at the recovered one would
 * move every verb off a store in use without a word.
 */
export interface RecoverHomeStoreInUseError {
  readonly code: "RECOVER_HOME_STORE_IN_USE";
  readonly message: string;
  /** The database the home's `store-url` names now. */
  readonly current: string;
  /** The database this recovery restores into. */
  readonly recovered: string;
}

/** No store URL could be derived for the recovered database. */
export interface RecoverUrlUnresolvedError {
  readonly code: "RECOVER_URL_UNRESOLVED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** One step of the recovery failed; the step names where a re-run resumes. */
export interface RecoverStepFailedError {
  readonly code: "RECOVER_STEP_FAILED";
  readonly message: string;
  readonly step: string;
  readonly reasons: readonly string[];
}

/** Every way a recovery stops before it reaches its report. */
export type RecoverError =
  | RecoverStackDownError
  | RecoverDatabaseHoldsStoreError
  | RecoverHomeStoreInUseError
  | RecoverUrlUnresolvedError
  | RecoverStepFailedError;

/** The factories a recovery constructs its failures with. Tests build fixtures through these. */
export const RecoverErrors = {
  databaseHoldsStore: ({ database }: { database: string }): RecoverDatabaseHoldsStoreError => ({
    code: "RECOVER_DATABASE_HOLDS_STORE",
    database,
    message:
      `${database} already holds a store and this home carries no record of a recovery restoring it — a partial ` +
      `restore, or somebody else's database. Nothing was written into it; pass --into <new-database> to recover ` +
      `beside it.`,
  }),
  homeStoreInUse: ({ current, recovered }: { current: string; recovered: string }): RecoverHomeStoreInUseError => ({
    code: "RECOVER_HOME_STORE_IN_USE",
    current,
    message:
      `this home's secrets/store-url names ${current}, which already holds a store, so the recovery will not ` +
      `repoint it at ${recovered}: every verb would move off ${current} without a word. Nothing was written. To ` +
      `recover beside it, re-run with SLOPWEAVER_STORE_URL set to this home's own store-url — the home's ` +
      `store-url is then left as it is and the recovered one is staged for you to compare — and repoint ` +
      `secrets/store-url yourself once you have.`,
    recovered,
  }),
  stackDown: ({ container, treeRoot }: { container: string; treeRoot: string }): RecoverStackDownError => ({
    code: "RECOVER_STACK_DOWN",
    container,
    message:
      `the local Supabase stack is not running (${container} is not a running container). Start it from the ` +
      `checkout — \`cd ${treeRoot} && yarn store:start\` — then run store recover again; nothing was written.`,
  }),
  stepFailed: ({ step, reasons }: { step: string; reasons: readonly string[] }): RecoverStepFailedError => ({
    code: "RECOVER_STEP_FAILED",
    message: `${step}: ${reasons.join("; ")} — run store recover again to resume from this step`,
    reasons,
    step,
  }),
  urlUnresolved: ({ reasons }: { reasons: readonly string[] }): RecoverUrlUnresolvedError => ({
    code: "RECOVER_URL_UNRESOLVED",
    message: `no connection string for the recovered database: ${reasons.join("; ")}`,
    reasons,
  }),
} as const;
