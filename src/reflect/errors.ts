/**
 * The typed failure kinds of the reflection loop's telemetry read.
 *
 * Scoped to this one module per the error-handling rule: no umbrella type, no union shared with the
 * Datadog client's own {@link ../lib/ingestError.js IngestError}. A caller of `readToolExecutionErrors`
 * branches on exactly three things, and each of them changes what a reader should conclude:
 *
 * - `CREDENTIALS_UNSET` — nothing was asked. The estate is undescribed, not empty.
 * - `WINDOW_INVALID` — the caller's own window is unusable, so no read was attempted.
 * - `QUERY_FAILED` — Datadog was asked and could not be believed.
 *
 * What is deliberately NOT here: "the window aged out" and "an event did not parse". Neither is a failure
 * of the read — they are things the read could not SEE, and reporting them as errors would collapse them
 * back into the same bucket as a genuine fault. They travel as coverage and residue on a successful
 * reading instead, which is the whole point of this phase.
 */

/** Datadog credentials are absent or malformed, so no query was issued. */
export interface TelemetryCredentialsUnsetError {
  readonly code: "CREDENTIALS_UNSET";
  readonly message: string;
  /** Every reason the credential resolution gave, carried forward rather than flattened to one line. */
  readonly reasons: readonly string[];
}

/** The requested window is not a window, so nothing could be read over it. */
export interface TelemetryWindowInvalidError {
  readonly code: "WINDOW_INVALID";
  readonly message: string;
  readonly fromMs: number;
  readonly toMs: number;
}

/** Datadog was reached (or attempted) and the answer cannot be trusted as a result. */
export interface TelemetryQueryFailedError {
  readonly code: "QUERY_FAILED";
  readonly message: string;
  /** The query that failed, so a reader can reproduce it. */
  readonly query: string;
  readonly reasons: readonly string[];
}

/** Every way the telemetry read can fail. */
export type TelemetryReadError =
  TelemetryCredentialsUnsetError | TelemetryQueryFailedError | TelemetryWindowInvalidError;

/** The only constructors for {@link TelemetryReadError}, so a test builds one the way the code does. */
export const TelemetryReadErrors = {
  credentialsUnset: ({ reasons }: { reasons: readonly string[] }): TelemetryCredentialsUnsetError => ({
    code: "CREDENTIALS_UNSET",
    message: `Datadog credentials are not usable, so no telemetry was read: ${reasons.join("; ")}`,
    reasons,
  }),
  queryFailed: ({ query, reasons }: { query: string; reasons: readonly string[] }): TelemetryQueryFailedError => ({
    code: "QUERY_FAILED",
    message: `the telemetry query could not be believed: ${reasons.join("; ")}`,
    query,
    reasons,
  }),
  windowInvalid: ({ fromMs, toMs }: { fromMs: number; toMs: number }): TelemetryWindowInvalidError => ({
    code: "WINDOW_INVALID",
    fromMs,
    message: `window ${String(fromMs)}..${String(toMs)} does not run forwards, so nothing could be read over it`,
    toMs,
  }),
} as const;
