/**
 * The `safe*` boundary wrappers — the ONE sanctioned place a NON-PROVIDER external call is made.
 *
 * PROVIDER calls do not live here. `safeApiCall` used to be the generic SDK wrapper, and PR5.2.1b deleted
 * it: every one of its 52 call sites moved to {@link ../lib/providerCall.safeProviderCall}, which adds the
 * shared 429 block, the registry's pacing and a compulsory `scopeId`/`retryMode`. Keeping an unused generic
 * wrapper alive would have been worse than a dead export — `boundaryResidue` now refuses to let anything but
 * the provider door sanction an SDK boundary, so any new use of it would have failed the gate anyway.
 *
 * What remains is the visible Codex transport, the on-device embedder and the filesystem edges — none of
 * which has a rate registry, a quota scope or a block to belong to. Each catches EVERY
 * thrown value (transient or not, async or sync) and maps it to a typed {@link IngestError} via
 * {@link toIngestError}, so no boundary needs a raw `try/catch` and no error detail (status/code/cause) is
 * lost. The boundary dev-lint gate ({@link ../devLint/boundaryResidue}) allowlists this file and forbids a
 * raw boundary call anywhere else.
 *
 * The async wrappers use neverthrow's `ResultAsync.fromPromise(Promise.resolve().then(execute), map)`: the
 * `Promise.resolve().then(execute)` wrapper is deliberate — it captures a SYNCHRONOUS throw from `execute`
 * as a rejected promise too (the archive's idiom, re-skinned). The sync {@link safeFs} owns the only
 * `try/catch` in the module (a sync call can't be a promise), which is why the gate allowlists this file.
 */
import { ResultAsync } from "neverthrow";

import { type IngestError, ingestErrorToThrowable, toIngestError } from "./ingestError.js";
import { err, ok, type Result } from "./result.js";

/**
 * Unwrap a typed result, or re-throw its error as a throwable `Error`. The adapter a THROWING seam uses:
 * the boundary call is wrapped into a typed result, then a fatal failure is re-surfaced as a throw so the
 * caller's existing catch-to-warning/fatal policy runs unchanged — behaviour-preserving.
 *
 * @param result the typed result to unwrap
 * @returns the success value (throws {@link ingestErrorToThrowable} on error)
 */
export function orThrow<T>({ result }: { result: Result<T, IngestError> }): T {
  if (result.isErr()) {
    throw ingestErrorToThrowable({ error: result.error });
  }
  return result.value;
}

/**
 * Wrap a Codex SDK call (`startThread` / `resumeThread` / a turn's `run`). A throw becomes a typed `llm`
 * error carrying provider `codex`, so a Codex failure is never mistaken for a Claude one in the ledger.
 *
 * Deliberately not {@link safeProviderCall}: Codex has no rate registry, quota scope or shared 429 block to
 * belong to, which is the same reason `safeCodex` sits here rather than behind the provider
 * door.
 *
 * An `AbortError` from a bounded turn arrives here like any other throw; the caller distinguishes it,
 * because an aborted turn is a deliberate policy outcome rather than a transport fault.
 *
 * @param execute the Codex call to run
 * @param operation the operation label (e.g. `codex.startThread`)
 * @returns a typed result
 */
export function safeCodex<T>({
  execute,
  operation,
}: {
  execute: () => Promise<T> | T;
  operation: string;
}): ResultAsync<T, IngestError> {
  return ResultAsync.fromPromise(Promise.resolve().then(execute), (error) =>
    toIngestError({ defaultKind: "llm", error, operation, provider: "codex" }),
  );
}

/**
 * Wrap an ASYNC filesystem call. A throw becomes a typed `io` error carrying the errno `code` and `path`.
 *
 * @param execute the async fs call to run
 * @param operation the operation label (e.g. `appendRecordRows`)
 * @param path the filesystem path (for the typed error)
 * @returns a typed result
 */
export function safeFsAsync<T>({
  execute,
  operation,
  path,
}: {
  execute: () => Promise<T> | T;
  operation: string;
  path?: string;
}): ResultAsync<T, IngestError> {
  return ResultAsync.fromPromise(Promise.resolve().then(execute), (error) =>
    toIngestError({ defaultKind: "io", error, operation, ...(path !== undefined ? { path } : {}) }),
  );
}

/**
 * Wrap a SYNCHRONOUS filesystem call → a typed result (no promise). The only `try/catch` in the module,
 * because a sync call can't be modelled as a rejected promise; the boundary gate allowlists this file.
 *
 * @param execute the sync fs call to run
 * @param operation the operation label (e.g. `writeJsonFile`)
 * @param path the filesystem path (for the typed error)
 * @returns a typed result
 */
export function safeFs<T>({
  execute,
  operation,
  path,
}: {
  execute: () => T;
  operation: string;
  path?: string;
}): Result<T, IngestError> {
  try {
    return ok(execute());
  } catch (error: unknown) {
    return err(toIngestError({ defaultKind: "io", error, operation, ...(path !== undefined ? { path } : {}) }));
  }
}
