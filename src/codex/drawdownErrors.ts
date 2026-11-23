/**
 * Everything the Codex burn detector can refuse, as one union scoped to that one mechanism.
 *
 * Three variants, because they are three different things to do about it and a reader of `codex watch`'s
 * output needs to tell them apart: a journal LINE the parser would not accept is a corrupt record the tick
 * skips and keeps going past, a journal or claim FILE that would not read or write is a broken install the
 * tick cannot proceed on at all, and a spawn that failed is the investigation leg alone — the reading that
 * triggered it is still good.
 *
 * Every variant carries `problems`, so the tick's own `errors: readonly string[]` accumulator and the
 * verb's per-line render both stay one loop, and `code` is there for the caller that wants the distinction
 * rather than the text.
 */

/**
 * A journal line that will not parse — a corrupt record, never a reason to stop reading the rest.
 *
 * @internal a member of the exported {@link CodexDrawdownError}, matched by `code` rather than imported.
 */
export interface DrawdownLineMalformedError {
  readonly code: "DRAWDOWN_LINE_MALFORMED";
  readonly message: string;
  readonly problems: readonly string[];
}

/**
 * A journal or claim file that would not read, write or lock.
 *
 * @internal a member of the exported {@link CodexDrawdownError}, matched by `code` rather than imported.
 */
export interface DrawdownStoreFailedError {
  readonly code: "DRAWDOWN_STORE_FAILED";
  readonly message: string;
  readonly operation: string;
  readonly problems: readonly string[];
}

/**
 * The investigation session could not be opened.
 *
 * @internal a member of the exported {@link CodexDrawdownError}, matched by `code` rather than imported.
 */
export interface DrawdownSpawnFailedError {
  readonly code: "DRAWDOWN_SPAWN_FAILED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Everything the burn detector can refuse. */
export type CodexDrawdownError = DrawdownLineMalformedError | DrawdownStoreFailedError | DrawdownSpawnFailedError;

/**
 * Builds one malformed-line failure.
 *
 * @param problem what the line was missing, or could not be read as
 * @returns the typed failure
 */
function lineMalformed({ problem }: { problem: string }): DrawdownLineMalformedError {
  return { code: "DRAWDOWN_LINE_MALFORMED", message: problem, problems: [problem] };
}

/**
 * Builds one store failure.
 *
 * @param operation which read, write or lock failed, for a caller that groups by it
 * @param cause what the filesystem boundary said
 * @returns the typed failure
 */
function storeFailed({ cause, operation }: { cause: string; operation: string }): DrawdownStoreFailedError {
  const message = `${operation}: ${cause}`;
  return { code: "DRAWDOWN_STORE_FAILED", message, operation, problems: [message] };
}

/**
 * Builds one spawn failure.
 *
 * @param cause what the spawn reported
 * @returns the typed failure
 */
function spawnFailed({ cause }: { cause: string }): DrawdownSpawnFailedError {
  return { code: "DRAWDOWN_SPAWN_FAILED", message: cause, problems: [cause] };
}

/** Builds each variant, so a test constructs a failure exactly as the real code does. */
export const CodexDrawdownErrors = { lineMalformed, spawnFailed, storeFailed } as const;
