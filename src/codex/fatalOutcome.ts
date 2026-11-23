/**
 * A Codex turn's fatal outcomes (typed, or no scratch workspace), its late answer, and a fatal cause's ONE attempt.
 *
 * Split out of `./runPass.ts`'s state machine along the seam between deciding WHEN a pass is fatal (there) and
 * what a fatal outcome SAYS (here): its shape, its cause, and — since a review's one policy retry
 * (`./policyRetryPass.ts`) reads each attempt's refusal by itself — which attempt that cause is stamped on.
 */

import type { IngestError } from "../lib/ingestError.js";
import type { BoundedPassResult } from "./runPass.js";
import { transportFaultCause } from "./transportCause.js";
import type { PassSalvage, StructuredPassOutcome } from "./types.js";

/**
 * The typed-fatal outcome, kept in one place so its shape cannot drift between call sites.
 *
 * It used to mint `the Codex transport failed` and nothing else, discarding both the boundary error and the
 * stream's own report — so a spend cap, an HTTP 429 and a missing binary all recorded the same sentence.
 *
 * It also used to discard the FOLD. A fatal outcome is the one place a pass's whole investigation can die on
 * something that has nothing to do with the investigation, so it is the last place that fold should be
 * dropped: `codex.resume` failing on the wrap-up turn threw away everything the initial turn had done, while
 * the same turn merely running out of clock kept all of it.
 *
 * @returns the fatal outcome, carrying the classified cause and whatever the fold salvaged
 */
export function fatalOutcome({
  error,
  operation,
  reported,
  salvage,
}: {
  /** Undefined only when a turn failed without returning an error, which the thread contract does not allow. */
  error: IngestError | undefined;
  operation: string;
  reported: () => string | undefined;
  /** Read LAZILY, like `reported`, so the fold includes whatever the failing turn itself streamed first. */
  salvage: () => PassSalvage | null;
}): StructuredPassOutcome<never> {
  return {
    cause: transportFaultCause({ error: boundaryError({ error, operation }), reported: reported() }),
    error: { kind: "llm", message: "the Codex transport failed", operation },
    kind: "fatal",
    salvage: salvage(),
  };
}

/**
 * Stamp a fatal outcome's cause onto the turn that failed, so the attempt list alone says what each turn met.
 *
 * A fatal outcome is minted from exactly one failed turn — the last one to run — so that is the attempt the
 * cause belongs to. Every other status carries none.
 *
 * @returns the result, its last attempt carrying the fatal cause when that attempt failed
 */
export function withFailureCause<TAnswer>({
  result,
}: {
  result: BoundedPassResult<TAnswer>;
}): BoundedPassResult<TAnswer> {
  const outcome = result.outcome;
  const last = result.attempts.at(-1);
  if (outcome.kind !== "fatal" || last?.status !== "failed") {
    return result;
  }
  return { ...result, attempts: [...result.attempts.slice(0, -1), { ...last, cause: outcome.cause }] };
}

/**
 * The boundary error a fatal outcome classifies. A failed turn that returned no error is named as exactly
 * that, rather than passed off as a real fault — an `if`, because `no-silent-fallback` refuses the `??` and
 * `prefer-nullish-coalescing` the ternary.
 */
function boundaryError({ error, operation }: { error: IngestError | undefined; operation: string }): IngestError {
  if (error === undefined) {
    return { kind: "llm", message: "the turn failed without returning an error", operation };
  }
  return error;
}

/**
 * An answer that arrived after the deadline: recorded, never a verdict (`./runPass.ts` `conclusionOutcome` says why).
 *
 * @returns the no-verdict outcome carrying the late answer as its raw response
 */
export function lateAnswer({
  finalResponse,
  salvage,
}: {
  finalResponse: string;
  salvage: () => PassSalvage | null;
}): StructuredPassOutcome<never> {
  return { kind: "no-verdict", rawFinalResponse: finalResponse, reason: "no-conclusion-in-bound", salvage: salvage() };
}

/**
 * The result when the scratch workspace could not be created, so no pass ever ran.
 *
 * A FATAL, never a degraded run. Falling back to the repository as the workspace would silently grant Codex
 * write access to the code another agent is editing — the exact thing the scratch directory exists to prevent.
 * No attempt is recorded because none was made, which is what keeps usage reported as not-measured.
 *
 * @returns the fatal pass result, with no attempts and nothing salvaged
 */
export function scratchUnavailable({ error }: { error: IngestError }): BoundedPassResult {
  return {
    attempts: [],
    observedElapsedMs: 0,
    outcome: {
      cause: transportFaultCause({ error, reported: undefined }),
      error: {
        kind: error.kind,
        message: "the pass scratch workspace could not be created",
        operation: error.operation,
      },
      kind: "fatal",
      // Nothing to keep, and that is an observation rather than a gap: no pass ran, so no event ever streamed.
      salvage: null,
    },
  };
}
