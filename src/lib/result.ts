import type { Result as NtResult, ResultAsync as NtResultAsync } from "neverthrow";

export { err, errAsync, ok, okAsync } from "neverthrow";

/**
 * The repo's `Result` — real neverthrow, not a hand-rolled shape. `E` defaults to `readonly string[]` for
 * a domain that hasn't yet adopted a typed discriminated-union error; a real external boundary pins `E` to
 * {@link ../lib/ingestError.IngestError} via `safeCodex`/`safeFs`/`safeProviderCall`
 * ({@link ./safeBoundary.js}, {@link ./providerCall.js}), and a converted domain pins it to its own
 * `<Domain>Error` union (`<domain>/errors.ts`).
 */
export type Result<T, E = readonly string[]> = NtResult<T, E>;

/** The async sibling of {@link Result} — a promise of a `Result`. */
export type ResultAsync<T, E = readonly string[]> = NtResultAsync<T, E>;

/**
 * Unwrap a successful `Result`'s value, THROWING if it is an error. Used where the caller is certain of
 * success — chiefly tests. Per `testing.md`, a test should assert `.isOk()`/`.isErr()` first and only then
 * unwrap without a branch (keeps the assertion falsifiable + conditional-free); this is the intended
 * practice, not a claim that every existing test call site already follows it.
 *
 * @param result the Result to unwrap
 * @returns the success value
 */
// named-object-params-exempt: `testing.md` prescribes `unwrap(result)` positionally, at hundreds of test call sites
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw new Error(`unwrap called on an error Result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/**
 * Unwrap an error `Result`'s error, THROWING if it is a success. The error-branch sibling of {@link unwrap}.
 *
 * @param result the Result to unwrap
 * @returns the error value
 */
// named-object-params-exempt: `testing.md` prescribes `unwrapErr(result)` positionally, beside `unwrap`
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (result.isOk()) {
    throw new Error("unwrapErr called on a success Result");
  }
  return result.error;
}
