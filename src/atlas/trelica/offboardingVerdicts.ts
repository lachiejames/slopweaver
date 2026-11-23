/**
 * What one offboarding run, and one leaver's Identity accounts, are evidence OF — and, as carefully, what they are
 * not.
 *
 * A run's states record what the workflow EXECUTED, never what a provider now holds: a `Completed` step says the
 * call returned, a `Skipped` one may mean the person had no account there or a condition was false. So the
 * cleanest verdict is `run-clean` — Trelica recorded nothing adverse — and never "offboarded properly". Every
 * verdict is exclusive within one run, decided in the order {@link trelicaRunVerdict} tests them, and a status
 * outside the measured vocabulary, or a completed run with no held step states, is `unknown` rather than a
 * favourable guess.
 *
 * Vocabulary MEASURED over all runs in one generation: `uiStatus` Completed, CompletedWithErrors, Terminated,
 * Failed, WaitingForUser, NeedsInput; step `status` Completed, Skipped, SkippedWithError, Failed, Blocked,
 * NotStarted. Trelica can report an offboarding run as `CompletedWithErrors` with an `errorCount` of 0, so the
 * counter decides nothing here.
 */
import type { HeldTrelicaPerson, HeldTrelicaRun } from "./heldDetails.js";

/** What one run is evidence of. */
export type TrelicaRunVerdict =
  "run-clean" | "run-completed-with-errors" | "run-stuck" | "run-failed" | "run-aborted" | "unknown";

/** The step outcomes that mean a step did not do its job. */
export const TRELICA_ADVERSE_STEP_STATUSES: ReadonlySet<string> = new Set(["Failed", "SkippedWithError", "Blocked"]);

/** Run statuses that leave a run open, waiting on someone. */
const OPEN_UI_STATUSES: ReadonlySet<string> = new Set(["WaitingForUser", "NeedsInput"]);

/**
 * The verdict one run supports, tested in a fixed order so a run carrying two adverse signals gets exactly one.
 *
 * @returns what the run is evidence of
 */
export function trelicaRunVerdict({ run }: { run: HeldTrelicaRun }): TrelicaRunVerdict {
  if (run.uiStatus === "Terminated") {
    return "run-aborted";
  }
  if (run.uiStatus === "Failed") {
    return "run-failed";
  }
  if (OPEN_UI_STATUSES.has(run.uiStatus) || run.status === "Blocked") {
    return "run-stuck";
  }
  if (run.uiStatus !== "Completed" && run.uiStatus !== "CompletedWithErrors") {
    return "unknown";
  }
  if (run.steps === null) {
    return run.uiStatus === "CompletedWithErrors" ? "run-completed-with-errors" : "unknown";
  }
  const adverse = run.steps.some((step) => TRELICA_ADVERSE_STEP_STATUSES.has(step.status));
  return run.uiStatus === "CompletedWithErrors" || adverse ? "run-completed-with-errors" : "run-clean";
}

/**
 * Whether a run is still open — the platform is waiting on it — so a newer run of the same workflow does not
 * close it.
 *
 * @returns `true` for a run waiting on a person or blocked
 */
export function isOpenTrelicaRun({ run }: { run: HeldTrelicaRun }): boolean {
  return trelicaRunVerdict({ run }) === "run-stuck";
}

/** A person's Identity accounts, split by what the platform says of each. */
export interface TrelicaIdentityAccountState {
  /** Sources holding an account the platform says is neither suspended nor deleted. */
  readonly live: readonly string[];
  /** Sources holding an account whose suspended or deleted flag the platform leaves unset. */
  readonly unknown: readonly string[];
}

/** A source's name as a reader sees it. */
function sourceName({ source }: { source: string | null }): string {
  if (source === null) {
    return "an unnamed Identity source";
  }
  return source;
}

/**
 * The Identity accounts a Terminated person still holds. Only an account the platform says outright is neither
 * suspended nor deleted is `live`; an unset flag is `unknown`, never read as either.
 *
 * @returns the live and unknown sources, each sorted; both empty for anyone not Terminated
 */
export function trelicaIdentityAccountState({
  person,
}: {
  person: HeldTrelicaPerson | undefined;
}): TrelicaIdentityAccountState {
  if (person?.status !== "Terminated") {
    return { live: [], unknown: [] };
  }
  const identity = person.accounts.filter((account) => account.providerType === "Identity");
  const live = identity.filter((account) => account.suspended === false && account.deleted === false);
  const unknown = identity.filter(
    (account) =>
      account.suspended !== true &&
      account.deleted !== true &&
      (account.suspended === null || account.deleted === null),
  );
  return {
    live: live.map((account) => sourceName({ source: account.source })).toSorted(),
    unknown: unknown.map((account) => sourceName({ source: account.source })).toSorted(),
  };
}
