/**
 * Where one automation stands, who it waits on, and what it is doing now — the three sentences that head its card.
 * Pure, and split from `./card.ts` along the seam between JUDGING a row and assembling the card around that judgement.
 *
 * Every reading leads with the scheduler's own verdict on the newest firing (`judgeSlotAttempt`) and the silence
 * reading (`silentRows`), never a second opinion of this module's; it only decides which of them a reader needs first.
 */
import type { RecipeDefinition } from "../live/automation/definition.js";
import type { RecipeDueVerdict } from "../live/automation/definitionDue.js";
import { type FailureFixStage, holdStands } from "../live/automation/failureHold.js";
import {
  type OwnerHoldPlacedByState,
  ownerHoldIsOwners,
  ownerHoldPlacedByStateOf,
} from "../live/automation/ownerHoldPlacedBy.js";
import type { SilentRow } from "../live/automation/silentRows.js";
import type { RecipeSlotVerdict } from "../live/automation/slotAttempt.js";
import type { ResyncState } from "../live/resync/outcome.js";
import type { SyncRunView } from "../syncRun/fold.js";
import type { FiringView } from "./card.js";

/**
 * Where a row stands, in the precedence a reader needs: the first that applies wins.
 *
 * - `failed` — a firing failed and the scheduler has paused the row until its fix lands (a standing failure hold),
 *   or its newest firing failed and the scheduler has not yet taken a fresh one.
 * - `paused` — an owner hold stands. It is the owner's own pause only when the hold carries their words naming the row
 *   (`ownerHoldIsOwners`); otherwise the account and the page read it UNOWNED. Deliberate, so never counted as broken.
 * - `waiting` — something outside the row has to move first: a blocker, a sign-in, a deferral.
 * - `stuck` — the scheduler reads its newest firing abandoned, or the sync it is running has gone quiet.
 * - `stopped` — it has gone quiet past its own cadence (`silentRows`), and its own current firing is not held.
 * - `running` — a firing is held under a live lease, or its sync is reading right now — even on a row that went
 *   quiet before that firing was taken.
 * - `healthy` — its newest firing succeeded.
 * - `off` — disabled by its own row.
 * - `not-measured` — nothing on disk says how it went.
 *
 * A failure hold whose fix has landed does not stand (`holdStands`), so it reads none of these on its own account —
 * the row falls through to what its firings say, exactly as the scheduler, which fires it again, reads it.
 */
export type AutomationHealth =
  "failed" | "paused" | "waiting" | "stuck" | "stopped" | "running" | "healthy" | "off" | "not-measured";

/**
 * A hold that stands on a row right now, as the card reads it.
 *
 * - `fix` — the store paused it when a firing failed; `finding` is the board row whose fix lifts it, and `stage` is
 *   where that fix stands.
 * - `owner` — an owner hold, for `reason`; `placedByState` says whether the owner's words naming this automation are on it
 *   (`../live/automation/ownerHoldPlacedBy.ts`). Only `anchored` is one the owner is shown as having chosen.
 */
export type StandingHold =
  | { readonly kind: "fix"; readonly finding: string; readonly sinceIso: string; readonly stage: FailureFixStage }
  | {
      readonly kind: "owner";
      readonly sinceIso: string;
      readonly reason: string;
      readonly placedByState: OwnerHoldPlacedByState;
    };

/**
 * The hold standing on a row, read exactly as the scheduler reads it — a lifted failure hold is no hold.
 *
 * @param definition the row in the LIFTED view, whose failure hold carries what its finding says now
 * @returns the standing hold, or `null` when nothing holds the row
 */
export function standingHoldOf({ definition }: { definition: RecipeDefinition }): StandingHold | null {
  const { hold } = definition;
  if (hold === undefined || !holdStands({ hold })) {
    return null;
  }
  if (hold.finding === undefined) {
    return {
      kind: "owner",
      placedByState: ownerHoldPlacedByStateOf({ definition: { ...definition, hold } }),
      reason: hold.reason,
      sinceIso: hold.askedIso,
    };
  }
  // The stored view carries no findingState, and a hold read there stands on evidence nobody read.
  const stage: FailureFixStage = hold.findingState === undefined ? { kind: "unread" } : hold.findingState.stage;
  return { finding: hold.finding, kind: "fix", sinceIso: hold.askedIso, stage };
}

/** A health and the sentence that goes with it. */
interface HealthReading {
  readonly health: AutomationHealth;
  readonly why: string;
}

/** Everything a row's health is judged from. */
interface HealthInputs {
  readonly definition: RecipeDefinition;
  readonly hold: StandingHold | null;
  readonly verdict: RecipeDueVerdict;
  readonly slotVerdict: RecipeSlotVerdict | null;
  readonly latest: FiringView | undefined;
  readonly waitingOn: string | null;
  readonly silent: SilentRow | undefined;
  readonly runningSync: SyncRunView | undefined;
  readonly firingsGap: string | null;
}

/**
 * Who or what the row is waiting on, from its blocker and its newest firing. A hold is not a wait — a standing one
 * reads `failed` or `paused` on its own ({@link standingHoldOf}), and a lifted one holds nothing.
 *
 * @param resync its resync record, when it is a resync row
 * @param latest its newest firing
 * @returns who it waits on, or `null` when nothing is
 */
export function waitingOnOf({
  resync,
  latest,
}: {
  resync: ResyncState | undefined;
  latest: FiringView | undefined;
}): string | null {
  if (resync?.blocker != null) {
    return `you: ${resync.blocker.reason}${resync.blocker.steps.length > 0 ? ` — ${resync.blocker.steps.join("; ")}` : ""}`;
  }
  if (resync?.lastAttempt?.signInWall !== undefined) {
    return `you: sign in at ${resync.lastAttempt.signInWall}`;
  }
  if (latest?.outcome === "deferred" && latest.detail !== null) {
    return latest.detail;
  }
  return null;
}

/** The failed sentence when the newest firing failed — `null` otherwise. Only the newest firing counts. */
function failedReading({
  latest,
  slotVerdict,
}: {
  latest: FiringView | undefined;
  slotVerdict: RecipeSlotVerdict | null;
}): string | null {
  if (slotVerdict?.kind === "cooling") {
    return `attempt ${String(slotVerdict.attempt)} failed at ${slotVerdict.failedAtIso} (${slotVerdict.previousDetail}); the next may start at ${slotVerdict.retryNotBeforeIso}`;
  }
  if (slotVerdict?.kind === "exhausted") {
    return `every attempt on this firing failed; the last said: ${slotVerdict.previousDetail}`;
  }
  if (slotVerdict?.kind === "retry") {
    return `its last attempt failed (${slotVerdict.previousDetail}); the next tick retries it`;
  }
  if (latest?.outcome === "dead") {
    // Named by its slot, never "newest": another firing can finish after it.
    return `the run for its latest scheduled time died at ${String(latest.settledAtIso)}: ${String(latest.detail)}`;
  }
  return null;
}

/** The stuck sentence when the scheduler reads the newest firing abandoned, or the running sync has gone quiet. */
function stuckReading({
  slotVerdict,
  runningSync,
}: {
  slotVerdict: RecipeSlotVerdict | null;
  runningSync: SyncRunView | undefined;
}): string | null {
  if (slotVerdict?.kind === "abandoned") {
    const how =
      slotVerdict.abandonment.kind === "holder-gone"
        ? `its process ${String(slotVerdict.abandonment.holderPid)} is gone`
        : "its lease ran out";
    return `the scheduler reads attempt ${String(slotVerdict.attempt)} abandoned: ${how}; the next tick retakes it`;
  }
  if (runningSync?.stalled === true) {
    return `the sync has said nothing since ${String(runningSync.lastActivityIso)}`;
  }
  return null;
}

/** Who holds a held firing. */
function heldBy({ slotVerdict }: { slotVerdict: RecipeSlotVerdict | null }): string {
  if (slotVerdict?.kind !== "held") {
    return "nobody";
  }
  return `${slotVerdict.holder} until ${slotVerdict.leaseExpiresIso}`;
}

/**
 * The reading a standing hold decides, on a row its own `enabled` has not switched off — `null` when none stands.
 * A disabled row reads `off` whatever holds it, because nothing would run it either way.
 */
function holdReading({ definition, hold }: HealthInputs): HealthReading | null {
  if (hold === null || !definition.enabled) {
    return null;
  }
  if (hold.kind === "fix") {
    return { health: "failed", why: "a run failed, so the scheduler paused it until its fix lands" };
  }
  if (!ownerHoldIsOwners({ recipeId: definition.recipeId, state: hold.placedByState })) {
    return { health: "paused", why: "paused, but no word of yours naming it is on the pause" };
  }
  return { health: "paused", why: "paused on your word" };
}

/** The readings that need someone to act: a standing hold, waiting, failed, stuck — `null` when none applies. */
function troubleOf(inputs: HealthInputs): HealthReading | null {
  const { verdict, waitingOn, latest, slotVerdict, runningSync } = inputs;
  const held = holdReading(inputs);
  if (held !== null) {
    return held;
  }
  if (waitingOn !== null && verdict.offReason !== "disabled") {
    return { health: "waiting", why: `waiting on ${waitingOn}` };
  }
  const failed = failedReading({ latest, slotVerdict });
  if (failed !== null) {
    return { health: "failed", why: failed };
  }
  const stuck = stuckReading({ runningSync, slotVerdict });
  if (stuck !== null) {
    return { health: "stuck", why: stuck };
  }
  return null;
}

/** The readings that need nobody: stopped, running, off, healthy, not measured. */
function calmOf({
  definition,
  verdict,
  slotVerdict,
  latest,
  silent,
  runningSync,
  firingsGap,
}: HealthInputs): HealthReading {
  // A row whose OWN current firing is held under a live lease is running whatever slots went by before it: one card
  // once read STOPPED and "now: running firing … (attempt 1)" at once (`bump-fix-slopweaver`). Its
  // own, because `slotVerdict` is read per recipe id and two definitions may share one.
  if (silent !== undefined) {
    if (silent.currentSlotHold === null) {
      return { health: "stopped", why: silent.detail };
    }
    const { holder, startedAtIso } = silent.currentSlotHold;
    return { health: "running", why: `held by ${holder} since ${startedAtIso}` };
  }
  if (runningSync !== undefined) {
    return { health: "running", why: runningSync.why };
  }
  if (slotVerdict?.kind === "held") {
    return { health: "running", why: `held by ${heldBy({ slotVerdict })}` };
  }
  if (verdict.offReason === "disabled" || !definition.enabled) {
    return { health: "off", why: "its row is disabled" };
  }
  // Below its silence threshold (a sub-daily row's one miss), a handed-on slot is still not a success: the class
  // stays the silence measure's, and the sentence says which slot went by rather than claiming the latest one ran.
  if (latest?.outcome === "succeeded" && verdict.deferredSlotIso !== null) {
    return {
      health: "healthy",
      why:
        `its last run succeeded at ${String(latest.settledAtIso)}; slot ${verdict.deferredSlotIso} went by unrun ` +
        "and was handed to its successor",
    };
  }
  if (latest?.outcome === "succeeded") {
    return {
      health: "healthy",
      why: `the run for its latest scheduled time succeeded at ${String(latest.settledAtIso)}`,
    };
  }
  if (firingsGap !== null) {
    return { health: "not-measured", why: firingsGap };
  }
  return { health: "not-measured", why: "no firing of this row is on disk yet" };
}

/**
 * The health and its sentence, in precedence order: what needs someone first, then what needs nobody.
 *
 * @returns the health and why
 */
export function healthOf(inputs: HealthInputs): HealthReading {
  const trouble = troubleOf(inputs);
  if (trouble !== null) {
    return trouble;
  }
  return calmOf(inputs);
}

/** What a running sync is reading, from its newest checkpoint. */
function syncingWords({ runningSync }: { runningSync: SyncRunView }): string {
  const progress = runningSync.progress;
  if (progress === null) {
    return `syncing ${runningSync.source} since ${String(runningSync.startedAtIso)}`;
  }
  let counted = "";
  if (progress.done !== undefined) {
    const outOf = progress.total === undefined ? "" : `/${String(progress.total)}`;
    counted = ` ${String(progress.done)}${outOf}`;
  }
  const item = progress.item === undefined ? "" : ` — ${progress.item}`;
  return `reading ${progress.phase}${counted}${item}`;
}

/**
 * What the row is doing at this moment, in words.
 *
 * A held or disabled row has no next firing, so it never reads "idle until its next firing": a held one says what
 * would let the scheduler run it again. A sync run by hand can still be reading while the row is held, and that is
 * said first because it is true.
 *
 * @param slotVerdict the scheduler's verdict on the newest firing
 * @param verdict the due verdict
 * @param runningSync its corpus source's running sync, when one is
 * @param latest its newest firing
 * @param hold the hold standing on it, if any
 * @returns the sentence
 */
export function nowDoingOf({
  slotVerdict,
  verdict,
  runningSync,
  latest,
  hold,
}: {
  slotVerdict: RecipeSlotVerdict | null;
  verdict: RecipeDueVerdict;
  runningSync: SyncRunView | undefined;
  latest: FiringView | undefined;
  hold: StandingHold | null;
}): string {
  if (runningSync !== undefined) {
    return syncingWords({ runningSync });
  }
  if (slotVerdict?.kind === "held" && latest !== undefined) {
    return `running firing ${latest.slotIso} (attempt ${String(slotVerdict.attempt)})`;
  }
  if (verdict.offReason === "disabled") {
    return "not running: its row is disabled";
  }
  if (hold?.kind === "fix") {
    return "not running: the scheduler will not run it again until its fix lands";
  }
  if (hold?.kind === "owner" && !ownerHoldIsOwners({ recipeId: verdict.recipeId, state: hold.placedByState })) {
    return "not running: held, with no word of yours naming it on the hold";
  }
  if (hold?.kind === "owner") {
    return "not running: the scheduler will not run it until you lift the pause";
  }
  if (verdict.due) {
    return `due for ${String(verdict.slotIso)} — the next tick takes it`;
  }
  return "idle until its next firing";
}
