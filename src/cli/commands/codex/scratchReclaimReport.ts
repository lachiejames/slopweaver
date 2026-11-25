/**
 * How `codex plan` and `codex review` report what became of each pass's own scratch workspace. Pure.
 *
 * Reported BESIDE the verdict, never in it: a scratch left behind is disk, not a wrong answer, so nothing here
 * feeds the exit code (`./passReport.ts`). The stdout field is bounded on purpose — an error's `cause` may be
 * unbounded or not JSON-safe, so only its code and message travel.
 */
import type { CompletedPass } from "../../../codex/orchestrate.js";
import type { ScratchReclaimOutcome } from "../../../codex/passPersist.js";

/** The stdout document's `scratchReclaim` field for one pass. */
export type ScratchReclaimJson =
  | { readonly status: "reclaimed"; readonly freedBytes: number }
  | { readonly status: "not-attempted"; readonly reason: string }
  | { readonly status: "failed"; readonly error: { readonly code: string; readonly message: string } };

/**
 * One pass's scratch outcome, as the stdout document carries it.
 *
 * @param outcome what became of the pass's own scratch
 * @returns the bounded JSON shape, never an error's cause
 */
export function scratchReclaimJson({ outcome }: { outcome: ScratchReclaimOutcome }): ScratchReclaimJson {
  switch (outcome.kind) {
    case "reclaimed":
      return { freedBytes: outcome.freedBytes, status: "reclaimed" };
    case "not-attempted":
      return { reason: outcome.reason, status: "not-attempted" };
    case "failed":
      return { error: { code: outcome.error.code, message: outcome.error.message }, status: "failed" };
  }
}

/**
 * One stderr line per pass whose scratch reclaim FAILED, naming the pass, the failure, and the verb that takes
 * a finished scratch later. A reclaimed or not-attempted pass prints nothing, so a clean run stays as terse as
 * it was.
 *
 * @param passes every completed pass in this invocation
 * @returns the diagnostic lines, empty when no reclaim failed
 */
export function scratchReclaimFailureLines({ passes }: { passes: readonly CompletedPass[] }): readonly string[] {
  return passes.flatMap((pass) => {
    const outcome = pass.scratchReclaim;
    if (outcome.kind !== "failed") {
      return [];
    }
    return [
      `${pass.record.scope.pass} scratch not reclaimed for pass ${pass.record.artifactId} ` +
        `(${outcome.error.code}: ${outcome.error.message}) — the verdict stands; ` +
        "`slopweaver home reclaim --root codex-scratch` reports what is left",
    ];
  });
}
