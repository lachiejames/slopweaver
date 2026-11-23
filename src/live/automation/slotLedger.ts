/**
 * The SLOT LEDGER — `$SLOPWEAVER_HOME/live/recipe/slot-attempts`, the effectful shell around
 * `./slotAttempt.ts`'s pure judgements.
 *
 * One file per cadence firing, named by a digest of `(recipeId, slotIso)`, holding that firing's whole
 * story: who took it, under what lease, on which attempt, and how it ended. Every dispatcher goes through
 * {@link beginSlotAttempt} and {@link ./slotSettlement.settleSlotAttempt} — there is deliberately no second
 * door, because the failure class this closes is two dispatchers disagreeing about whether a firing happened.
 * The settle and the retirement sit in `./slotSettlement.ts`, and the seated run's admission in
 * `./slotSeatedRun.ts`; both take this module's one mutex and write through its row writer.
 *
 * ## One file per slot, never one map
 *
 * `definition-runs.json` is one small object, rewritten whole, and that is right for it: it is bounded by the
 * number of DEFINITIONS, which is bounded by the files a person put in one directory. A slot ledger is not — it grows with TIME, which is exactly the distinction
 * `whole-file-json` draws. So it is a directory of small files, each written once and updated at most twice,
 * and a reader only ever opens the one slot it asked about.
 *
 * ## The key is derived from `slotIso`, and deliberately not from `recipeSlotHash`
 *
 * `./identity.ts#recipeSlotHash` digests `(recipeId, localDate, localTime)` — the LOCAL pair the retired
 * work-console generation log is keyed by. Everything on the definition-store path speaks `slotIso` instead:
 * `definitionDue.ts` chooses one, `definitionRunStore.ts` stamps one, a claim leases one. Keying this ledger
 * off the local pair would mean deriving one naming from the other at every call site, and the whole point
 * of a derived id is that two dispatchers cannot disagree about it. So the key is a digest of the tuple this
 * path already speaks, and the local-pair hash stays with the log it belongs to.
 *
 * It is a DIGEST rather than the tuple itself for the reason `identity.ts` gives: a recipe id is free text
 * off an ungated definition file, and a path built from one straight is a path that file gets to choose.
 *
 * ## Why one mutex rather than an `O_EXCL` create
 *
 * `outbound/slack/sendReservation.ts` is the measured case against an exclusive create alone: its
 * reservation is REPLACED too (an aged takeover, a confirm), and a create-only primitive let two identical
 * sends both claim one, so every change to it holds a per-slot lock. A slot's row here is likewise created
 * once and then REPLACED — by a settle, and by the next attempt after a failure — so `wx` would cover the
 * first attempt and nothing else, leaving the retry path to a second mechanism. One `recipe-slot-attempts` mutex held
 * across read-judge-write covers every path with one rule — the shape the row-keyed claims store this ledger
 * replaced had already proved, after a Codex review returned BROKEN on its lock-free version with a
 * read-modify-write counterexample.
 *
 * The mutex is the whole store rather than one slot, matching that module's reasoning: a per-slot key would
 * serialise the wrong thing while reading as though it had serialised the right one. The critical section is
 * one small read and one atomic write, so it is held for single-digit milliseconds, and a busy one is waited
 * on rather than refused — a refused BEGIN reads as "something else is running this slot", which is a lie
 * that would skip a firing.
 *
 * Lock order, stated so it can be checked rather than assumed: this mutex is taken OUTSIDE
 * `recipe-definition-runs`, never inside it. `definitionRunStore.ts` documents that its lock is the
 * innermost one this repository takes, and {@link ./slotSettlement.settleSlotAttempt} preserves that by
 * stamping the run BEFORE it releases, never the other way round.
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { OperationLockResult } from "../../admit/operationLock.js";
import { readFileIfPresent } from "../../atlas/atlasFile.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { holderAliveFor, type ProcessAlive } from "./holderLiveness.js";
import { judgeSlotAttempt, openSlotAttempt, type RecipeSlotAttempt, type RecipeSlotVerdict } from "./slotAttempt.js";
import { attemptOf } from "./slotAttemptCodec.js";
import { type RecipeSlotAttemptError, RecipeSlotAttemptErrors } from "./slotAttemptErrors.js";
import { acquireWaitingLock } from "./waitingLock.js";

/** The one lock key serialising every read-modify-write of the ledger, whichever slot it is about. */
const RECIPE_SLOT_ATTEMPTS_LOCK_KEY = "recipe-slot-attempts";

/**
 * The stable per-slot key — a lowercase SHA-256 hex digest of the canonical `[recipeId, slotIso]` tuple.
 *
 * Derived, never minted, so every dispatcher on the machine computes the same key for the same firing with
 * nothing to agree about. That is the whole idempotency property, and it is why this is a function rather
 * than a field on anything.
 *
 * @param recipeId the row this firing belongs to
 * @param slotIso the cadence firing, as `./definitionDue.ts` chose it
 * @returns the lowercase hex digest
 */
export function slotAttemptKey({ recipeId, slotIso }: { readonly recipeId: string; readonly slotIso: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([recipeId, slotIso]), "utf8")
    .digest("hex");
}

/**
 * The idempotency key a DESTINATION is handed so it can refuse a second delivery of one firing.
 *
 * Prefixed and human-readable on purpose: it lands in an outbound door's reservation, where an operator
 * reading a refusal has to be able to tell what refused and why. The digest half is what keeps a raw recipe
 * id off the wire.
 *
 * @param recipeId the row this firing belongs to
 * @param slotIso the cadence firing
 * @returns the key to hand the destination
 */
export function slotDeliveryKey({
  recipeId,
  slotIso,
}: {
  readonly recipeId: string;
  readonly slotIso: string;
}): string {
  return `recipe-slot:${slotAttemptKey({ recipeId, slotIso })}`;
}

/** Where one slot's row lives. */
function slotPath({ home, recipeId, slotIso }: { home: string; recipeId: string; slotIso: string }): string {
  return join(stateHomePaths({ home }).live.recipe.slotAttemptsDir, `${slotAttemptKey({ recipeId, slotIso })}.json`);
}

/**
 * Read one slot's row.
 *
 * An ABSENT file is `null` — a firing nothing has ever attempted, which is the ordinary starting state for
 * every slot. A file that is PRESENT and unreadable REFUSES, because reading a corrupt row as "never
 * attempted" would run the slot a second time, which is the exact failure this ledger exists to prevent.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being asked about
 * @param slotIso the firing being asked about
 * @returns the row, `null` when the firing has never been attempted, or why it could not be read
 */
export function readSlotAttempt({
  home,
  recipeId,
  slotIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
}): Result<RecipeSlotAttempt | null, RecipeSlotAttemptError> {
  const path = slotPath({ home, recipeId, slotIso });
  const raw = readFileIfPresent({ path });
  if (raw.isErr()) {
    return err(RecipeSlotAttemptErrors.unreadable({ reason: raw.error.join("; "), recipeId, slotIso }));
  }
  if (raw.value === null) {
    return ok(null);
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text: raw.value });
  } catch (cause) {
    return err(RecipeSlotAttemptErrors.unreadable({ reason: errorMessage({ error: cause }), recipeId, slotIso }));
  }
  const parsed = attemptOf({ value: decoded });
  if (parsed === undefined) {
    return err(
      RecipeSlotAttemptErrors.unreadable({
        reason: `${path} is not a slot row this build writes`,
        recipeId,
        slotIso,
      }),
    );
  }
  return ok(parsed);
}

/**
 * Persist one slot's row, creating the ledger directory on first use.
 *
 * @returns `null` once the row is written, or why it could not be
 */
export function writeSlotAttempt({
  home,
  attempt,
}: {
  home: string;
  attempt: RecipeSlotAttempt;
}): Result<null, RecipeSlotAttemptError> {
  const path = slotPath({ home, recipeId: attempt.recipeId, slotIso: attempt.slotIso });
  try {
    mkdirSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { mode: 0o700, recursive: true });
    writeFileAtomic({ contents: `${JSON.stringify(attempt, null, 2)}\n`, path });
  } catch (cause) {
    return err(
      RecipeSlotAttemptErrors.notWritten({
        reason: errorMessage({ error: cause }),
        recipeId: attempt.recipeId,
        slotIso: attempt.slotIso,
      }),
    );
  }
  return ok(null);
}

/**
 * Take the ledger mutex, waiting out a busy one — a refused BEGIN would read as "something else is running
 * this slot" and skip a firing, which is the missed-run half of the failure class.
 *
 * @param home the state home the lock lives under
 * @param nowIso the instant the attempt is judged at, for the lock's own staleness check
 * @returns the held lock, or the last refusal after every attempt
 */
export function acquireLedgerLock({ home, nowIso }: { home: string; nowIso: string }): OperationLockResult {
  return acquireWaitingLock({ home, key: RECIPE_SLOT_ATTEMPTS_LOCK_KEY, nowIso });
}

/** What a caller learns from trying to take one slot: the attempt it now holds, or why it may not run. */
export type SlotAttemptTake =
  | { readonly kind: "taken"; readonly attempt: RecipeSlotAttempt }
  | { readonly kind: "refused"; readonly verdict: RecipeSlotVerdict };

/**
 * Take one cadence firing, if this caller may have it.
 *
 * The whole read-judge-write runs inside one mutex, so two dispatchers racing for the same firing are
 * serialised and the loser reads the winner's row rather than its own stale view. That is the difference
 * between this and the claim read `cli/commands/automation/runDue.ts` did for a run-here row, which was a
 * check with no set: measured, two concurrent `automation run-due` ticks both ran one `verb-run`
 * row for the same slot.
 *
 * An ABANDONED firing — an attempt whose lease expired with nothing settled — is refused here rather than
 * silently retaken, because whether retrying it is safe depends on what the effect can prove and that is
 * `./slotAttempt.ts#retryAfterUnknownIsSafe`'s judgement, not this store's. The caller reads the verdict and
 * decides.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being run
 * @param slotIso the cadence firing this run covers
 * @param holder who is taking it — a board slug, a workspace name, a verb
 * @param holderPid the process running the effect in-process, or `null` when the taker exits before the run
 * @param holderToken the token this caller will quote back to settle the attempt
 * @param leaseExpiresIso the row's own next firing, past which this attempt is abandoned
 * @param nowIso the reference instant
 * @param processAlive probes the stored row's holder pid, so a dead in-process holder reads abandoned
 * @returns the attempt now held, the verdict that refused it, or why the ledger could not be reached
 */
export function beginSlotAttempt({
  home,
  recipeId,
  slotIso,
  holder,
  holderPid,
  holderToken,
  leaseExpiresIso,
  nowIso,
  processAlive,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly holder: string;
  readonly holderPid: number | null;
  readonly holderToken: string;
  readonly leaseExpiresIso: string;
  readonly nowIso: string;
  readonly processAlive: ProcessAlive;
}): Result<SlotAttemptTake, RecipeSlotAttemptError> {
  const lock = acquireLedgerLock({ home, nowIso });
  if (lock.isErr()) {
    return err(RecipeSlotAttemptErrors.notWritten({ reason: lock.error, recipeId, slotIso }));
  }
  try {
    const stored = readSlotAttempt({ home, recipeId, slotIso });
    if (stored.isErr()) {
      return err(stored.error);
    }
    const holderAlive = holderAliveFor({ processAlive, stored: stored.value });
    const verdict = judgeSlotAttempt({ holderAlive, nowIso, stored: stored.value });
    if (verdict.kind !== "open" && verdict.kind !== "retry") {
      return ok({ kind: "refused", verdict });
    }
    const attempt = openSlotAttempt({
      attempt: verdict.attempt,
      holder,
      holderPid,
      holderToken,
      leaseExpiresIso,
      nowIso,
      recipeId,
      slotIso,
    });
    const written = writeSlotAttempt({ attempt, home });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok({ attempt, kind: "taken" });
  } finally {
    lock.value.release();
  }
}

/**
 * Retake a firing whose previous attempt was ABANDONED — its lease expired with nothing settled — because
 * the caller has judged a retry safe.
 *
 * Separated from {@link beginSlotAttempt} rather than folded into it as a flag, because the judgement that
 * admits it is a real one about what the effect can prove
 * (`./slotAttempt.ts#retryAfterUnknownIsSafe`) and a boolean parameter would let a caller make it by
 * accident. The attempt count still advances, so an abandoned firing cannot be retaken without limit.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row being run
 * @param slotIso the cadence firing this run covers
 * @param holder who is taking it
 * @param holderPid the process running the effect in-process, or `null` when the taker exits before the run
 * @param holderToken the token this caller will quote back to settle the attempt
 * @param leaseExpiresIso the row's own next firing
 * @param nowIso the reference instant
 * @param processAlive probes the STORED row's holder pid, under this call's own lock
 * @returns the attempt now held, the verdict that refused it, or why the ledger could not be reached
 */
export function retakeAbandonedSlot({
  home,
  recipeId,
  slotIso,
  holder,
  holderPid,
  holderToken,
  leaseExpiresIso,
  nowIso,
  processAlive,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly holder: string;
  readonly holderPid: number | null;
  readonly holderToken: string;
  readonly leaseExpiresIso: string;
  readonly nowIso: string;
  readonly processAlive: ProcessAlive;
}): Result<SlotAttemptTake, RecipeSlotAttemptError> {
  const lock = acquireLedgerLock({ home, nowIso });
  if (lock.isErr()) {
    return err(RecipeSlotAttemptErrors.notWritten({ reason: lock.error, recipeId, slotIso }));
  }
  try {
    const stored = readSlotAttempt({ home, recipeId, slotIso });
    if (stored.isErr()) {
      return err(stored.error);
    }
    // Probed again HERE, under this lock, never carried over from the take that reported it abandoned: that
    // reading was made under a lock already released, and the row may have moved since.
    const holderAlive = holderAliveFor({ processAlive, stored: stored.value });
    const verdict = judgeSlotAttempt({ holderAlive, nowIso, stored: stored.value });
    if (verdict.kind !== "abandoned") {
      return ok({ kind: "refused", verdict });
    }
    const attempt = openSlotAttempt({
      attempt: verdict.attempt + 1,
      holder,
      holderPid,
      holderToken,
      leaseExpiresIso,
      nowIso,
      recipeId,
      slotIso,
    });
    const written = writeSlotAttempt({ attempt, home });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok({ attempt, kind: "taken" });
  } finally {
    lock.value.release();
  }
}

/**
 * Give one firing back, because the run it was taken for never happened.
 *
 * The row is REMOVED rather than settled, so the firing reads `open` again and its attempt count starts
 * over. That is right for the one thing this is for — tidy-up after a spawn or a seat that failed to start,
 * where nothing ran and no attempt was spent — and it is the reason the release is separate from a settle
 * rather than a third outcome kind: an outcome describes what a run DID, and this describes a run that did
 * not happen.
 *
 * Releasing a firing this caller does not hold is refused, exactly as settling one is. Releasing a firing
 * nobody holds is NOT: a caller cleaning up after a failed spawn cannot always know whether its lease
 * expired first, and refusing there would turn tidy-up into a branch — the same judgement
 * row-keyed claim release made before this ledger replaced it.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row whose firing is being given back
 * @param slotIso the firing being given back
 * @param holderToken the token this caller took the attempt under
 * @param nowIso the reference instant
 * @returns nothing on success, or why the firing was not this caller's to give back
 */
export function releaseSlotAttempt({
  home,
  recipeId,
  slotIso,
  holderToken,
  nowIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly holderToken: string;
  readonly nowIso: string;
}): Result<null, RecipeSlotAttemptError> {
  const lock = acquireLedgerLock({ home, nowIso });
  if (lock.isErr()) {
    return err(RecipeSlotAttemptErrors.notWritten({ reason: lock.error, recipeId, slotIso }));
  }
  try {
    const stored = readSlotAttempt({ home, recipeId, slotIso });
    if (stored.isErr()) {
      return err(stored.error);
    }
    if (stored.value === null) {
      return ok(null);
    }
    if (stored.value.holderToken !== holderToken) {
      return err(RecipeSlotAttemptErrors.tokenMismatch({ holder: stored.value.holder, recipeId, slotIso }));
    }
    try {
      rmSync(slotPath({ home, recipeId, slotIso }), { force: true });
    } catch (cause) {
      return err(RecipeSlotAttemptErrors.notWritten({ reason: errorMessage({ error: cause }), recipeId, slotIso }));
    }
    return ok(null);
  } finally {
    lock.value.release();
  }
}

/**
 * Give back an attempt that has NOT STARTED — the same removal as {@link releaseSlotAttempt}, with the
 * "not started" fact re-checked under the mutex rather than trusted from an earlier read.
 *
 * The seated carry-forward (`cli/commands/automation/seatedAdmission.ts`) reads the token's open attempt off an
 * unlocked scan, sees `runStartedAtIso` null, and gives it back. Between that read and a plain release, a
 * second invocation of the same seated command can START the attempt — `startSeatedRun` stamps it under
 * this same mutex — and a release that checks only the token would then remove a row whose run is under
 * way, letting the second invocation take and start the firing again: two runs under one token, which is
 * the double the whole ledger exists to refuse (found by this lane's own r1 fallback review). So the check
 * and the removal are one locked act here, and an attempt that started in the gap is refused.
 *
 * @param home the state home the ledger lives under
 * @param recipeId the row whose firing is being given back
 * @param slotIso the firing being given back
 * @param holderToken the token this caller took the attempt under
 * @param nowIso the reference instant
 * @returns `given-back` when the row was removed (or was already gone), `started` when its run began first
 */
export function giveBackUnstartedAttempt({
  home,
  recipeId,
  slotIso,
  holderToken,
  nowIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly holderToken: string;
  readonly nowIso: string;
}): Result<
  { readonly kind: "given-back" } | { readonly kind: "started"; readonly at: string },
  RecipeSlotAttemptError
> {
  const lock = acquireLedgerLock({ home, nowIso });
  if (lock.isErr()) {
    return err(RecipeSlotAttemptErrors.notWritten({ reason: lock.error, recipeId, slotIso }));
  }
  try {
    const stored = readSlotAttempt({ home, recipeId, slotIso });
    if (stored.isErr()) {
      return err(stored.error);
    }
    if (stored.value === null) {
      return ok({ kind: "given-back" });
    }
    if (stored.value.holderToken !== holderToken) {
      return err(RecipeSlotAttemptErrors.tokenMismatch({ holder: stored.value.holder, recipeId, slotIso }));
    }
    if (stored.value.runStartedAtIso !== null) {
      return ok({ at: stored.value.runStartedAtIso, kind: "started" });
    }
    try {
      rmSync(slotPath({ home, recipeId, slotIso }), { force: true });
    } catch (cause) {
      return err(RecipeSlotAttemptErrors.notWritten({ reason: errorMessage({ error: cause }), recipeId, slotIso }));
    }
    return ok({ kind: "given-back" });
  } finally {
    lock.value.release();
  }
}
