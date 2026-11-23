/**
 * Shared fixtures for the `console-sync-failed` monitor's tests: ledgers as the reader returns them, read whole, so
 * a case states only its rows.
 */
import { ok, type Result } from "../../../lib/result.js";
import type {
  ConsoleSyncAppendFailure,
  ConsoleSyncAppendFailureLedger,
  ConsoleSyncFailure,
  ConsoleSyncLedger,
} from "../../../live/consoleSyncFailureStore.js";

/** The instant every case is judged at. */
export const NOW = "2026-11-12T10:00:00.000Z";

/** The width every synthetic row takes in its file, so row `i` starts at byte `i * ROW_BYTES`. */
export const ROW_BYTES = 100;

/**
 * A headerless ledger read whole — one written before the generation header existed: these rows and no damage, row
 * `i` starting at byte `i * ROW_BYTES`.
 *
 * @returns the ledger as the reader would return it
 */
export function rowsOf(...failures: readonly ConsoleSyncFailure[]): Result<ConsoleSyncLedger> {
  return rowsInGeneration({ failures, generation: undefined });
}

/**
 * A headerless fallback read whole: these refused rows and no damage, row `i` starting at byte `i * ROW_BYTES`.
 *
 * @returns the fallback as the reader would return it
 */
export function refusedOf(...failures: readonly ConsoleSyncAppendFailure[]): Result<ConsoleSyncAppendFailureLedger> {
  return refusalsInGeneration({ failures, generation: undefined });
}

/**
 * A ledger read whole under one generation header, row `i` starting at byte `i * ROW_BYTES`.
 *
 * @param generation the token on the file's first line, `undefined` for a headerless file
 * @returns the ledger as the reader would return it
 */
export function rowsInGeneration({
  failures,
  generation,
}: {
  failures: readonly ConsoleSyncFailure[];
  generation: string | undefined;
}): Result<ConsoleSyncLedger> {
  return ok({
    byteOffsets: failures.map((_, index) => index * ROW_BYTES),
    damaged: 0,
    failures,
    generation,
    path: "/ledger",
  });
}

/**
 * A fallback read whole under one generation header, row `i` starting at byte `i * ROW_BYTES`.
 *
 * @param generation the token on the file's first line, `undefined` for a headerless file
 * @returns the fallback as the reader would return it
 */
export function refusalsInGeneration({
  failures,
  generation,
}: {
  failures: readonly ConsoleSyncAppendFailure[];
  generation: string | undefined;
}): Result<ConsoleSyncAppendFailureLedger> {
  return ok({
    byteOffsets: failures.map((_, index) => index * ROW_BYTES),
    damaged: 0,
    failures,
    generation,
    path: "/fallback",
  });
}

/** The generation a file had before it was deleted by hand. */
export const OLD_GENERATION = "0".repeat(64);

/** The generation the same file has once it was written again. */
export const NEW_GENERATION = "f".repeat(64);

/** A fallback holding nothing: the ledger refused no row. */
export const NO_REFUSALS = refusedOf();
