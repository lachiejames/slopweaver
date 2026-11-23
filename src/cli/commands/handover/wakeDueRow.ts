/**
 * What one DUE park comes to on a `handover wake` run, once `./wakeJudge.ts` has judged every row and the finish
 * half (`./wakeDueFinish.ts`) has offered a merged park to `handover finish`.
 *
 * Every due park finish did not settle is reseated under the wake journal (`./wakeReseat.ts`) while the run's boot
 * budget (`./wakeBootBudget.ts`) lasts: held when it re-parked on the condition its last reseat acted on,
 * `reseat-in-flight` when another wake holds its claim, and journalled either side of the spawn.
 */
import {
  judgeParkWake,
  type ParkWake,
  type ParkWakeJudgement,
  type ReadChecksWake,
} from "../../../handover/parkWake.js";
import { parkMoved, type WakeCandidate } from "../../../handover/wakeCandidates.js";
import { reseatUnproven } from "../../../handover/wakeProofs.js";
import { stateHomePaths } from "../../../stateHome.js";
import { describeChildOutcome } from "../../../supervisor/scratch/childOutcome.js";
import { EXIT_DEFERRED } from "../../exitCodes.js";
import { WAKE_BOOT_SHARE } from "./wakeBootBudget.js";
import type { DueJudgement } from "./wakeJudge.js";
import { reparkGuard, reseatClaimed, type SpawnOutcome } from "./wakeReseat.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** One `cmux spawn`'s budget: it boots a workspace and waits for the seat, which `supervisor tick` measured in minutes. */
export const WAKE_SPAWN_TIMEOUT_MS = 300_000;

/** How many attempts this run may spend, and the boots in flight that shrank it — what a deferral names. */
export interface WakeBudget {
  readonly budget: number;
  readonly bootsInFlight: number;
}

/**
 * Reseat one due row and believe the reseat only off its journal.
 *
 * @returns the row's action and its detail
 */
async function wakeOne({
  candidate,
  deps,
  home,
  runsDir,
}: {
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  home: string;
  runsDir: string;
}): Promise<SpawnOutcome> {
  const { parkIndex, parked, slug } = candidate;
  const outcome = await deps.reseat({ home, slug, timeoutMs: WAKE_SPAWN_TIMEOUT_MS });
  if (outcome.kind === "exited" && outcome.exitCode === EXIT_DEFERRED) {
    return { action: "spawn-deferred", detail: "the spawn backoff deferred cmux spawn with exit 4; still parked" };
  }
  const unproven = reseatUnproven({ parkIndex, runsDir, slug });
  if (outcome.kind !== "exited" || outcome.exitCode !== 0) {
    // A spawn that failed with its seat left open (`cmux/spawn.ts`'s `spawnFailureKeepsWorkspaceOpen`) still
    // journals its dispatch, which clears the park — so this row is not reseated beside a seat that may be live.
    const leftOpen =
      unproven === undefined
        ? "; its dispatch cleared the park and the seat was left open — read it, never reseat it"
        : "; still parked";
    return { action: "spawn-failed", detail: `cmux spawn ended ${describeChildOutcome({ outcome })}${leftOpen}` };
  }
  if (unproven !== undefined) {
    return { action: "spawn-failed", detail: unproven };
  }
  return { action: "spawned", detail: `reseated by cmux spawn ${slug} (was parked at ${parked.atIso})` };
}

/**
 * Why a due row this run cannot attempt waits, naming the boot window when it is what held.
 *
 * @returns the deferral's detail
 */
function overBudgetDetail({ budget, bootsInFlight }: WakeBudget): string {
  return (
    `over this run's ${String(budget)}-reseat budget: the wake fills at most ${String(WAKE_BOOT_SHARE)} of the ` +
    `180-second boot window, ${String(bootsInFlight)} already booted in it, and the rest is the chair's fill`
  );
}

/**
 * What a due park the finish did not settle comes to: deferred over the budget or the backoff, held by the wake
 * journal, or reseated.
 *
 * @param attempted reseats this run already attempted, counted against the budget
 * @param backoffHeld whether the spawn backoff already deferred one of this run's reseats, so its window is shut
 * @param finishWhy why a finish asked of this park did not close its run, carried at the front of the detail
 * @param now the run's instant, which a re-read at the row's turn is judged at
 * @param readChecks the run's bounded checks read, for a park whose pull request had not merged
 * @returns the row's report
 */
export async function reseatDueRow({
  attempted,
  backoffHeld,
  budget,
  candidate,
  deps,
  dryRun,
  finishWhy,
  home,
  judgement,
  now,
  readChecks,
}: {
  attempted: number;
  backoffHeld: boolean;
  budget: WakeBudget;
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  finishWhy: string | undefined;
  home: string;
  judgement: DueJudgement;
  now: Date;
  readChecks: ReadChecksWake;
}): Promise<WakeRowReport> {
  const reseated = await reseatRow({
    attempted,
    backoffHeld,
    budget,
    candidate,
    deps,
    dryRun,
    home,
    judgement,
    now,
    readChecks,
  });
  if (finishWhy === undefined) {
    return reseated;
  }
  return { ...reseated, detail: `${finishWhy}; ${reseated.detail}` };
}

/**
 * {@link reseatDueRow} before its finish sentence.
 *
 * @returns the row's report
 */
async function reseatRow({
  attempted,
  backoffHeld,
  budget,
  candidate,
  deps,
  dryRun,
  home,
  judgement,
  now,
  readChecks,
}: {
  attempted: number;
  backoffHeld: boolean;
  budget: WakeBudget;
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  judgement: DueJudgement;
  now: Date;
  readChecks: ReadChecksWake;
}): Promise<WakeRowReport> {
  const { parked, slug } = candidate;
  const base = { judgement, slug, wake: parked.wake };
  // The backoff first: once it shut the window, it is the bound holding every later row, budget or not.
  if (backoffHeld) {
    return { ...base, action: "due-deferred", detail: "the spawn backoff deferred an earlier reseat this run" };
  }
  if (attempted >= budget.budget) {
    return { ...base, action: "due-deferred", detail: overBudgetDetail(budget) };
  }
  const current = await judgementAtTurn({ judgement, now, readChecks, wake: parked.wake });
  if (current.kind !== "due") {
    return { ...base, action: "none", detail: current.reason, judgement: current };
  }
  return reseatAtTurn({ candidate, current, deps, dryRun, home });
}

/**
 * {@link reseatRow} once the turn's own read still finds the park due: the moved-park check, the repark guard, then
 * the spawn.
 *
 * @param current the judgement read at this row's turn
 * @returns the row's report
 */
async function reseatAtTurn({
  candidate,
  current,
  deps,
  dryRun,
  home,
}: {
  candidate: WakeCandidate;
  current: DueJudgement;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
}): Promise<WakeRowReport> {
  const { parkIndex, parked, slug } = candidate;
  const turn = { judgement: current, slug, wake: parked.wake };
  const runsDir = stateHomePaths({ home }).runs;
  const moved = parkMoved({ parkIndex, runsDir, slug });
  if (moved !== undefined) {
    return { ...turn, action: "none", detail: moved };
  }
  const { observed } = current;
  const guard = reparkGuard({ candidate, home, observed });
  if (guard.isErr()) {
    return { ...turn, action: "wake-journal-failed", detail: guard.error };
  }
  if (guard.value.kind === "acted") {
    return heldByGuard({ base: turn, reason: guard.value.reason });
  }
  if (dryRun) {
    return { ...turn, action: "would-spawn", detail: `would run cmux spawn ${slug} --model opus` };
  }
  const { guarded, ...outcome } = await reseatClaimed({
    candidate,
    deps,
    home,
    observed,
    launch: () => wakeOne({ candidate, deps, home, runsDir }),
  });
  if (guarded !== undefined) {
    return heldByGuard({ base: turn, reason: guarded });
  }
  return { ...turn, ...outcome };
}

/**
 * The judgement a reseat acts on at its turn. A clock wake whose instant passed, or a checks wake whose pull request
 * merged, cannot have changed since the judging pass. Any other checks park is read again: the judging pass read
 * every park before any reseat, and a reseat earlier in this run may have moved its pull request, or a closed one
 * been reopened. One bounded read, and only for a row the budget lets attempt.
 *
 * @param judgement the judging pass's judgement
 * @param now the run's instant
 * @param readChecks the run's bounded checks read
 * @param wake what the park waits on
 * @returns the judgement to act on
 */
async function judgementAtTurn({
  judgement,
  now,
  readChecks,
  wake,
}: {
  judgement: DueJudgement;
  now: Date;
  readChecks: ReadChecksWake;
  wake: ParkWake;
}): Promise<ParkWakeJudgement> {
  if (judgement.observed.kind === "at" || judgement.observed.prState === "MERGED") {
    return judgement;
  }
  return judgeParkWake({ now, readChecks, wake });
}

/**
 * A due park the guard holds — a reseat's here, a finish's in `./wakeDueFinish.ts`: judged NOT DUE, since the
 * condition it waits on is one a reseat already acted on, so the report's due count never counts it.
 *
 * @returns the row's report
 */
export function heldByGuard({
  base,
  reason,
}: {
  base: Pick<WakeRowReport, "slug" | "wake">;
  reason: string;
}): WakeRowReport {
  return { ...base, action: "none", detail: reason, judgement: { kind: "not-due", reason } };
}
