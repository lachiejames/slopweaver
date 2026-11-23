/**
 * What `fleet-unhealthy` reads out of one slot attempt: its fate, and when and why it failed — and, folded per recipe,
 * the rows the note's details name (`./fleetHealthDelta.ts`). The verdict over them is `./fleetHealth.ts`'s.
 *
 * ## How a death is counted, and its residue
 *
 * Every slot-attempt FILE started inside the window counts once, not only each row's newest: latest-per-row read
 * 19% failing and 0 deaths on the table's worst day (window 6 below), and would not have tripped. An attempt DIED when its run STARTED, nothing ever
 * settled it and `judgeSlotAttempt` reads it abandoned (its lease ran out, or its holder pid is gone), or when a
 * later take dead-lettered it as `OUTCOME_UNKNOWN` / `KILLED_BY_SIGNAL` — without that second half the dead letter
 * would move a death out of the count. `ATTEMPTS_EXHAUSTED` is a failure. A seated run records no pid until it
 * starts, so its death shows only once its lease passes; a retry overwrites its file, so the window reads the
 * stored `startedAtIso`.
 *
 * An abandoned attempt that never STARTED is a FAILURE, never a death: a seat claimed it and nothing ran under
 * it, so the row did not sync that firing, but nothing died mid-run. MEASURED: the linear and github
 * resyncs' early-morning firings were claimed by a seat, read DEFERRED to their successor when the session reached them,
 * and sat open with `runStartedAtIso` null until their lease — two "deaths" that tripped `deaths` for runs that
 * never began (`automation run-due` now gives such a firing back, `cli/commands/automation/seatedAdmission.ts`).
 *
 * Pure: attempts and a clock in, fates and rows out.
 */
import { firingReason } from "../live/automation/firingReason.js";
import { judgeSlotAttempt, type RecipeSlotAttempt } from "../live/automation/slotAttempt.js";

import type { FailingRow } from "./fleetHealthDelta.js";

/**
 * How far back a pass looks — one day, so a recovered fleet's card clears at most a day after its last failure.
 *
 * Measured with the thresholds in `./fleetHealth.ts` over six days of this machine's ledger, one window per day
 * (failing counts failed, dead and died together), repro:
 * `jq -s '[.[] | select(.startedAtIso >= "<window start>") | (.outcome.kind // "open")] | group_by(.) | map({(.[0]): length}) | add' ~/.slopweaver/live/recipe/slot-attempts/*.json`
 *
 * | window | failing / total | share | deaths |
 * | ------ | --------------- | ----- | ------ |
 * | 1      | 15/63           | 24%   | 0      |
 * | 2      | 31/90           | 34%   | 2      |
 * | 3      | 1/12            | –     | 1      |
 * | 4      | 9/26            | 35%   | 1      |
 * | 5      | 11/49           | 22%   | 1      |
 * | 6      | 42/145          | 29%   | 19     |
 */
export const FLEET_HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One stored attempt and what the caller's probe says about its holder pid. */
export interface ProbedAttempt {
  readonly attempt: RecipeSlotAttempt;
  /** Whether its holder pid still runs — `null` when it names none. */
  readonly holderAlive: boolean | null;
}

/** What became of one attempt, for the tally. */
type AttemptFate = "succeeded" | "failing" | "died" | "uncounted";

/** The dead-letter reasons that mean the run died rather than failed. */
const DIED_REASONS: ReadonlySet<string> = new Set(["OUTCOME_UNKNOWN", "KILLED_BY_SIGNAL"]);

/**
 * What became of one attempt: succeeded, failing, died, or uncounted (in flight, or deferred on a prerequisite).
 *
 * @param probed the attempt and its holder's liveness
 * @param nowIso the instant to judge a lease against
 * @returns its fate
 */
export function attemptFate({ probed, nowIso }: { probed: ProbedAttempt; nowIso: string }): AttemptFate {
  const { attempt, holderAlive } = probed;
  const outcome = attempt.outcome;
  if (outcome === null) {
    const verdict = judgeSlotAttempt({ holderAlive, nowIso, stored: attempt });
    if (verdict.kind !== "abandoned") {
      return "uncounted";
    }
    return verdict.ran ? "died" : "failing";
  }
  if (outcome.kind === "succeeded") {
    return "succeeded";
  }
  if (outcome.kind === "failed") {
    return "failing";
  }
  if (outcome.kind === "dead") {
    if (DIED_REASONS.has(outcome.reason)) {
      return "died";
    }
    return "failing";
  }
  return "uncounted";
}

/** When and why one counted failure happened. */
interface Failure {
  readonly atIso: string;
  readonly why: string;
}

/**
 * When and why one counted failure happened, or `undefined` for an attempt that did not fail.
 *
 * @param probed the attempt and its holder's liveness
 * @param nowIso the instant to judge a lease against
 * @returns the instant the failure was observed and its reason, as the ledger has them
 */
function failureOf({ probed, nowIso }: { probed: ProbedAttempt; nowIso: string }): Failure | undefined {
  const { attempt, holderAlive } = probed;
  const outcome = attempt.outcome;
  if (outcome === null) {
    const verdict = judgeSlotAttempt({ holderAlive, nowIso, stored: attempt });
    if (verdict.kind !== "abandoned") {
      return undefined;
    }
    if (!verdict.ran) {
      return { atIso: attempt.startedAtIso, why: "claimed by a seat and never started before its lease ran out" };
    }
    if (verdict.abandonment.kind === "holder-gone") {
      return {
        atIso: attempt.startedAtIso,
        why: `died mid-run, its process ${String(verdict.abandonment.holderPid)} gone`,
      };
    }
    return { atIso: attempt.startedAtIso, why: "died mid-run, never settled before its lease ran out" };
  }
  if (outcome.kind === "failed") {
    return { atIso: outcome.settledAtIso, why: firingReason({ detail: outcome.detail, recipeId: attempt.recipeId }) };
  }
  if (outcome.kind === "dead") {
    const detail = firingReason({ detail: outcome.detail, recipeId: attempt.recipeId });
    return { atIso: outcome.settledAtIso, why: `${outcome.reason}: ${detail}` };
  }
  return undefined;
}

/** One recipe's runs in the window, folded: how many failed, its latest failure, and its newest run's fate. */
interface RecipeFold {
  failures: number;
  last: Failure | undefined;
  newest: { readonly startMs: number; readonly ok: boolean };
}

/** The later of two failures, either of which may be absent. */
function laterFailure({ a, b }: { a: Failure | undefined; b: Failure | undefined }): Failure | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined || Date.parse(a.atIso) >= Date.parse(b.atIso)) {
    return a;
  }
  return b;
}

/** Fold one counted run into its recipe's running fold. */
function foldRun({
  fold,
  failure,
  newest,
}: {
  fold: RecipeFold | undefined;
  failure: Failure | undefined;
  newest: RecipeFold["newest"];
}): RecipeFold {
  const counted = failure === undefined ? 0 : 1;
  if (fold === undefined) {
    return { failures: counted, last: failure, newest };
  }
  return {
    failures: fold.failures + counted,
    last: laterFailure({ a: fold.last, b: failure }),
    newest: newest.startMs > fold.newest.startMs ? newest : fold.newest,
  };
}

/**
 * Every recipe with a failing or dying run started inside the window: whether its NEWEST counted run failed or has
 * since succeeded, how often it failed, and when and why it last did. Failing rows first, newest failure first.
 *
 * @param attempts every stored attempt, probed
 * @param nowIso the end of the window
 * @returns one entry per such recipe
 */
export function failingRows({
  attempts,
  nowIso,
}: {
  attempts: readonly ProbedAttempt[];
  nowIso: string;
}): readonly FailingRow[] {
  const since = Date.parse(nowIso) - FLEET_HEALTH_WINDOW_MS;
  const byRecipe = new Map<string, RecipeFold>();
  for (const probed of attempts) {
    const startMs = Date.parse(probed.attempt.startedAtIso);
    const fate = attemptFate({ nowIso, probed });
    if (startMs >= since && fate !== "uncounted") {
      const id = probed.attempt.recipeId;
      const newest = { ok: fate === "succeeded", startMs };
      byRecipe.set(id, foldRun({ failure: failureOf({ nowIso, probed }), fold: byRecipe.get(id), newest }));
    }
  }
  const rows = [...byRecipe].flatMap(([recipeId, fold]): FailingRow[] => {
    if (fold.last === undefined) {
      return [];
    }
    const state = fold.newest.ok ? "recovered" : "failing";
    return [{ failures: fold.failures, lastFailedIso: fold.last.atIso, recipeId, state, why: fold.last.why }];
  });
  return rows.toSorted(
    (a, b) =>
      Number(a.state === "recovered") - Number(b.state === "recovered") ||
      Date.parse(b.lastFailedIso) - Date.parse(a.lastFailedIso) ||
      a.recipeId.localeCompare(b.recipeId),
  );
}
