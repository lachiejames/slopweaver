/**
 * Whether one step of `slopweaver desktop e2e` passed, from what the driver saw while it stood on it. Pure.
 *
 * A step fails for the first of these it shows, in this order — the order is how far each one is from the page
 * merely being slow: the page threw; the console logged an error; a read it made answered 5xx; Next raised its error
 * overlay; the landmark never appeared before the cap; the page was still saying it was loading at the cap. A page
 * that only ever loaded slowly is the last, because it is the one a fast machine on a quiet minute would pass.
 *
 * A step with nothing to act on in a legitimate state — the card step on a proven-empty Queue — is NOT APPLICABLE:
 * neither passed nor failed, and named as such. It sits after every error and before the landmark, so an error seen
 * while it looked still fails it, and a step that took no action is never failed for the dialog it did not open.
 */

/** What the driver saw on one step. */
export interface E2eObserved {
  /** Uncaught errors the page threw while the step ran. */
  readonly pageErrors: readonly string[];
  /** `console.error` lines the page logged while the step ran. */
  readonly consoleErrors: readonly string[];
  /** Reads the page made that answered 5xx, as `<status> <url>`. */
  readonly serverErrors: readonly string[];
  /** Next's error overlay was on screen. */
  readonly errorOverlay: boolean;
  /** The step's landmark appeared before the cap. */
  readonly landed: boolean;
  /** What on screen still said it was loading at the cap, each named by its element and region; empty when nothing did. */
  readonly stillLoading: readonly string[];
  /** A step-specific failure the driver met before it could look, such as no Queue card to open. */
  readonly blocked: string | undefined;
  /** Why the step had nothing to act on in a legitimate state, such as an empty Queue; `undefined` when it acted. */
  readonly notApplicable: string | undefined;
}

/**
 * Why a step failed. The walk's kinds come first, most serious first; the call leg's (`./e2eCallOutcome.ts`) follow,
 * in the order that judge reads them.
 */
export type E2eFailureKind =
  | "blocked"
  | "page-error"
  | "console-error"
  | "http-5xx"
  | "next-error-overlay"
  | "missing-landmark"
  | "still-loading"
  | "cleanup-failed"
  | "overlapping-calls"
  | "call-not-live"
  | "call-dropped"
  | "evidence-missing"
  | "transcript-missing"
  | "answer-missing"
  | "self-introduced"
  | "heap-growth"
  | "long-task-missing"
  | "queue-search-failed"
  | "moved-off-card"
  | "reopen-not-held"
  | "card-stuck";

/**
 * One step's verdict. Not applicable carries `passed: false` so nothing reading `passed` alone ever counts it a pass;
 * the report tells it from a failure by its kind.
 */
export type E2eVerdict =
  | { readonly passed: true }
  | { readonly passed: false; readonly kind: E2eFailureKind; readonly detail: string }
  | { readonly passed: false; readonly kind: "not-applicable"; readonly detail: string };

/**
 * A failed verdict.
 *
 * @param kind which failure the judge named
 * @param detail the evidence, in words
 * @returns the verdict
 */
export function failed({ kind, detail }: { kind: E2eFailureKind; detail: string }): E2eVerdict {
  return { detail, kind, passed: false };
}

/**
 * Judge one step.
 *
 * @param observed what the driver saw on it
 * @param landmark what the step was waiting for, as the report names it
 * @returns passed, not applicable, or the first failure in the order above with its evidence
 */
export function judgeStep({ observed, landmark }: { observed: E2eObserved; landmark: string }): E2eVerdict {
  if (observed.blocked !== undefined) {
    return { detail: observed.blocked, kind: "blocked", passed: false };
  }
  const [pageError] = observed.pageErrors;
  if (pageError !== undefined) {
    return { detail: pageError, kind: "page-error", passed: false };
  }
  const [consoleError] = observed.consoleErrors;
  if (consoleError !== undefined) {
    return { detail: consoleError, kind: "console-error", passed: false };
  }
  const [serverError] = observed.serverErrors;
  if (serverError !== undefined) {
    return { detail: serverError, kind: "http-5xx", passed: false };
  }
  if (observed.errorOverlay) {
    return { detail: "Next's error overlay is over the page", kind: "next-error-overlay", passed: false };
  }
  if (observed.notApplicable !== undefined) {
    return { detail: observed.notApplicable, kind: "not-applicable", passed: false };
  }
  if (!observed.landed) {
    return { detail: `${landmark} never appeared`, kind: "missing-landmark", passed: false };
  }
  if (observed.stillLoading.length > 0) {
    return {
      detail: `still said it was loading at the cap: ${observed.stillLoading.join("; ")}`,
      kind: "still-loading",
      passed: false,
    };
  }
  return { passed: true };
}
