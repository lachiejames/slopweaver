/**
 * ONE CADENCE SLOT AS AN EVENT WITH AN ID — the record that makes an automation run exactly once.
 *
 * **The rule**: a recipe never double runs and is never missed; it runs exactly once, and if it fails it is
 * picked up again and retried in a way that causes no further problem — the whole class solved the way webhook
 * idempotency is solved, never a patch on one symptom. The three symptoms it removes: messages missing from
 * today, a post made twice, and a failure that never came back.
 *
 * ## The one idea: a firing is an EVENT, and an event has an id
 *
 * A Stripe webhook handler does not decide what to do by looking at a clock. It looks the event id up in a
 * table it owns, and every decision — act, skip, retry, give up — comes from what that row says. This module
 * is that table's row. The id is derived from `(recipeId, slotIso)` rather than minted, so every dispatcher
 * on the machine computes the SAME id for the same firing with nothing to agree about
 * (`./slotLedger.ts#slotAttemptKey`, whose header says why it keys off the firing's ISO instant rather than
 * off `./identity.ts#recipeSlotHash`'s local-date pair).
 *
 * Everything else here is a consequence of that one idea, and the consequences are what close the failure
 * modes measured before it existed:
 *
 * - **Two ticks cannot both run one slot**, because the second one reads the first one's row. Until this
 *   existed, `cli/commands/automation/runDue.ts` only READ a claim for a run-here row and never took one:
 *   measured, two concurrent `slopweaver automation run-due --home <tmp>` both printed `· ran ·` for
 *   the same slot on the same `verb-run` row.
 * - **A crash between the effect and the stamp is VISIBLE**, because the row is written BEFORE the effect
 *   and says so. Measured the same day: with `<home>/live/recipe` unwritable the verb was dispatched, the
 *   stamp refused with `EACCES`, and `automation due` read the row due again for the SAME slot — forever. The
 *   only thing that stopped a duplicate was the DESTINATION's own per-id refusal.
 * - **A failure is retried, and a retry is not a new run**, because the row carries an attempt count.
 *
 * ## The retry schedule is the CADENCE, not a second clock
 *
 * Deliberately NOT a state machine with its own scheduler. A slot that failed simply does not advance the
 * watermark (`./definitionRunStore.ts`), and `./definitionDue.ts` then judges the row due for that same slot
 * again, because the firing it covers is still the newest one after the watermark. At the row's OWN NEXT
 * FIRING the count moves on and `chooseSlot` abandons the failed slot — so **a slot's retries live inside
 * its own period** with no field expressing it. That is also what keeps it true that a machine off
 * for days must not come back and run days of catch-up.
 *
 * A second answer to "is this row due" is the same defect one layer up. So the only thing this row adds to
 * the schedule is a FLOOR: how long after a failed attempt the next one may start.
 *
 * ## Where the numbers come from
 *
 * {@link MAX_ATTEMPTS_PER_SLOT} is the one named constant, and the backoff is derived from the ROW's own
 * cadence period rather than from minutes — the same reasoning `./definitionClaim.ts` uses for a lease, and
 * for the same reason: a bare number of minutes here would be exactly the invented threshold this design refuses. Attempt _n_ of _N_ waits `period / 2^(N - n)` before the next one may start, so
 * the waits are `period/4` then `period/2`, and 1/4 + 1/2 < 1: every attempt of a slot fits inside that
 * slot's own period without the last one racing the next firing. Check it rather than trusting it:
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/live/automation/slotAttempt.test.ts`.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type RecipeSlotAttemptError, RecipeSlotAttemptErrors } from "./slotAttemptErrors.js";

/** The schema version new code writes. A reader accepts only this one — nothing older has ever existed. */
export const RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION = 1;

/**
 * How many attempts one slot gets before it is declared dead and handed to a person.
 *
 * Three rather than a tuned number: with the doubling backoff above, three attempts are the most that fit
 * inside one cadence period without the last one starting after the next firing has already made the row
 * due for a newer slot.
 */
export const MAX_ATTEMPTS_PER_SLOT = 3;

/**
 * Every reason a slot can be retired without ever succeeding, as the ledger stores it.
 *
 * `KILLED_BY_SIGNAL` is the attempt whose own `automation run-due` process received SIGHUP, SIGINT or SIGTERM while
 * its effect ran and retired itself before exiting (`cli/commands/automation/runDueSignal.ts`) — a
 * `store-backup-daily` firing a caller's `timeout 900` killed was once only read abandoned a tick later, as an
 * `OUTCOME_UNKNOWN` naming no cause.
 *
 * `HOLDER_GONE` is an attempt whose run STARTED and then vanished with nothing settled — its holder process
 * gone, or its lease run out. A read-only row used to be retaken blindly there; MEASURED, the
 * calendar and fathom resyncs each carried three seated attempts that started and died, and nothing judged
 * any of them. A run that dies mid-way is a failure, so it holds the row like any other.
 */
export const RECIPE_SLOT_DEATH_REASONS = [
  "ATTEMPTS_EXHAUSTED",
  "OUTCOME_UNKNOWN",
  "KILLED_BY_SIGNAL",
  "HOLDER_GONE",
] as const;

/** Why a slot was retired without ever succeeding. */
export type RecipeSlotDeathReason = (typeof RECIPE_SLOT_DEATH_REASONS)[number];

/** How one attempt at a slot ended. */
export type RecipeSlotOutcome =
  | { readonly kind: "succeeded"; readonly settledAtIso: string; readonly exitCode: number }
  | {
      /**
       * The verb RAN and declined to act yet — `cli/exitCodes.ts` § `EXIT_DEFERRED`. The attempt is given
       * BACK rather than spent, so this row reads `open` at the SAME attempt number again.
       *
       * It is an outcome rather than a deletion, and that is the whole of the finding: the
       * deferral used to be recorded by removing the row, so the only trace a deferred firing left anywhere
       * was the tick's own stdout. `vulnfix-digest-acme-admin` deferred every slot for two days while
       * `definition-runs.json` still read `exitCode: 0` from the last firing that did run — "has not posted
       * for two days" and "posted twice, fine" were the same bytes.
       */
      readonly kind: "deferred";
      readonly settledAtIso: string;
      /** What the verb said it was waiting for, so a reader never has to re-run the row to find out. */
      readonly detail: string;
    }
  | {
      readonly kind: "failed";
      readonly settledAtIso: string;
      readonly exitCode: number | null;
      readonly detail: string;
      /** The earliest instant the next attempt may start — the derived floor, never a schedule. */
      readonly retryNotBeforeIso: string;
    }
  | {
      readonly kind: "dead";
      readonly settledAtIso: string;
      readonly reason: RecipeSlotDeathReason;
      readonly detail: string;
    };

/** One cadence slot's row: who is running it, under what lease, on which attempt, and how it ended. */
export interface RecipeSlotAttempt {
  readonly schemaVersion: typeof RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION;
  readonly recipeId: string;
  /** The cadence firing this row covers, as `./definitionDue.ts` chose it. */
  readonly slotIso: string;
  /** 1-based. A retry increments it; it is never reset while the slot is open. */
  readonly attempt: number;
  /** Who is running it, as free text a reader can chase — a board slug, a workspace name, a verb. */
  readonly holder: string;
  /**
   * The token the holder quotes back to settle this attempt.
   *
   * It is the same guarantee `./definitionClaim.ts`'s `claimId` bought and it is here for the same named
   * failure: a worker finishing after a successor took the slot would otherwise settle the SUCCESSOR's
   * attempt, and both runs would look like one.
   */
  readonly holderToken: string;
  /**
   * The process performing the effect IN-PROCESS, or `null` when no process outlives the take.
   *
   * Only `automation run-due` sets it, because only there does the process that took the attempt also run it —
   * so its disappearance proves the attempt will never be settled. A seat or a claim leaves it `null`: its
   * CLI exits the moment it has seated the session, which is exactly why `./definitionClaim.ts` refused pid
   * liveness for claims, and a pid there would read the attempt dead a second after it was taken.
   *
   * MEASURED: a `store-backup-daily` run-due was killed by its caller's `timeout 1700` before it
   * settled, and every tick after it printed HELD for the rest of the cadence period with nothing running.
   */
  readonly holderPid: number | null;
  readonly startedAtIso: string;
  /**
   * When the RUN of this attempt actually began, or `null` while nothing has started it.
   *
   * It exists for the seat path, where the attempt is opened by `automation seat` and performed later by the
   * session it opened. Without it, admission there was a READ — and a read admits every time, so two
   * invocations of the seated command quoting one token both reached the effect. Setting this under the
   * ledger mutex makes admission a compare-and-set, which is what "at most once" actually requires.
   */
  readonly runStartedAtIso: string | null;
  /**
   * The row's own next firing after this attempt started, past which the attempt is abandoned.
   *
   * Derived, with no TTL constant to tune, exactly as `./definitionClaim.ts` derived a claim's expiry — a
   * lease can never outlive the schedule it belongs to, because at the next firing the row is due again
   * whatever any lease says.
   */
  readonly leaseExpiresIso: string;
  /** `null` while the attempt is still running. */
  readonly outcome: RecipeSlotOutcome | null;
}

/**
 * Why an open attempt was judged abandoned: its lease ran out, or the process named as performing it is gone.
 *
 * Typed rather than read back out of a line, so the dead letter says which one happened.
 */
export type RecipeSlotAbandonment =
  { readonly kind: "lease-expired" } | { readonly kind: "holder-gone"; readonly holderPid: number };

/** What a dispatcher should do about one slot, having read its row. */
export type RecipeSlotVerdict =
  /**
   * Nothing holds this slot and nothing is owed for it; take it as this attempt.
   *
   * `attempt` is 1 for a slot nothing has ever attempted, and the STORED number again for one whose last
   * attempt deferred — a deferral spends no attempt, so a row waiting on a prerequisite for a week must not
   * exhaust itself into a dead letter while nothing is wrong.
   */
  | { readonly kind: "open"; readonly attempt: number }
  /** A previous attempt failed and its floor has passed; take it as attempt n. */
  | { readonly kind: "retry"; readonly attempt: number; readonly previousDetail: string }
  /** Something is running it under a live lease. */
  | { readonly kind: "held"; readonly holder: string; readonly leaseExpiresIso: string; readonly attempt: number }
  /**
   * A previous attempt failed and its floor has NOT passed.
   *
   * It carries the failure's own detail and instant because a COOLING line is often read hours after the
   * failure it replays. MEASURED: three store rows failed in-process in the evening, and an observer
   * hours later, reading only "attempt 1 failed; the next may start at <time>", took it for a fresh failure
   * and blamed the stale-build gate, which cannot reach an in-process verb at all.
   */
  | {
      readonly kind: "cooling";
      readonly retryNotBeforeIso: string;
      readonly attempt: number;
      /** When the failed attempt settled. */
      readonly failedAtIso: string;
      /** What the failed attempt recorded about itself. */
      readonly previousDetail: string;
    }
  /** This slot is finished with — succeeded, or declared dead. */
  | { readonly kind: "settled"; readonly outcome: RecipeSlotOutcome }
  /**
   * An attempt started and nothing ever settled it — its lease expired, or the process performing it is
   * gone. The effect MAY have happened. Whether retrying is safe is not this module's call —
   * {@link retryAfterUnknownIsSafe} decides it from what the kind's destination can prove.
   */
  | {
      readonly kind: "abandoned";
      readonly attempt: number;
      readonly holder: string;
      /** The judged row's own token, so a retirement can prove it still writes onto THIS attempt. */
      readonly holderToken: string;
      readonly abandonment: RecipeSlotAbandonment;
      /**
       * Whether the attempt's run STARTED — a run began under the seat (`runStartedAtIso`), or the process
       * performing it in-process was named (`holderPid`). One that never started may be taken again; one that
       * started and vanished is a failure.
       */
      readonly ran: boolean;
    }
  /** Every attempt this slot gets has been spent. */
  | {
      readonly kind: "exhausted";
      readonly attempt: number;
      /** The judged row's own token, so a retirement can prove it still writes onto THIS attempt. */
      readonly holderToken: string;
      readonly previousDetail: string;
    };

/**
 * How long after a failed attempt the next one may start, as a fraction of the row's own cadence period.
 *
 * `period / 2^(MAX - attempt)`: the waits double, and every one of a slot's attempts fits inside that slot's
 * own period. PURE.
 *
 * @param periodMs the row's cadence period — the gap between this slot and its next firing
 * @param attempt the attempt that just failed, 1-based
 * @returns how many milliseconds must pass before the next attempt may start
 */
export function retryFloorMs({ periodMs, attempt }: { readonly periodMs: number; readonly attempt: number }): number {
  const remaining = Math.max(MAX_ATTEMPTS_PER_SLOT - attempt, 1);
  return Math.floor(periodMs / 2 ** remaining);
}

/**
 * Whether retrying an ABANDONED attempt — one whose effect may or may not have reached the world — is safe.
 *
 * The rule is what the effect can PROVE, and it has exactly three answers:
 *
 * - a run that only READS is idempotent by construction, so a retry is free;
 * - a run whose write goes through a destination that takes this slot's idempotency key can be retried,
 *   because the destination refuses the second delivery (`outbound/slack/sendReservation.ts`);
 * - a run whose write goes somewhere with no key must NOT be retried. A `verb-run` row's argv is arbitrary
 *   by design, so nothing here can know whether its verb already wrote. The slot is declared dead with
 *   `OUTCOME_UNKNOWN` and handed to a person, because a visible dead-letter row is not a missing message in
 *   the owner's sense — the owner is told — while silently re-running a verb that may already have written is
 *   the double that must never happen.
 *
 * PURE.
 *
 * @param writes whether this row's own declared effect can write at all
 * @param destinationTakesKey whether the kind's destination accepts this slot's idempotency key
 * @returns true when the attempt may simply be taken again
 */
export function retryAfterUnknownIsSafe({
  writes,
  destinationTakesKey,
}: {
  readonly writes: boolean;
  readonly destinationTakesKey: boolean;
}): boolean {
  if (!writes) {
    return true;
  }
  return destinationTakesKey;
}

/** Whether a lease is still live at an instant. An unparseable expiry reads as EXPIRED — the fail-safe way. */
function leaseIsLive({ leaseExpiresIso, nowIso }: { leaseExpiresIso: string; nowIso: string }): boolean {
  const expiresMs = Date.parse(leaseExpiresIso);
  if (Number.isNaN(expiresMs)) {
    return false;
  }
  return Date.parse(nowIso) < expiresMs;
}

/**
 * The verdict for a row whose attempt is still open — abandoned when its holder process is gone, held under
 * its lease, or abandoned past it.
 */
function openAttemptVerdict({
  stored,
  holderAlive,
  nowIso,
}: {
  stored: RecipeSlotAttempt;
  holderAlive: boolean | null;
  nowIso: string;
}): RecipeSlotVerdict {
  const ran = stored.runStartedAtIso !== null || stored.holderPid !== null;
  // Only a definite `false` abandons early. `null` (no pid, or nobody probed) keeps the lease-only judgement,
  // and a probe that could not tell reads alive at its source — both fail toward HELD, never toward a retake.
  if (stored.holderPid !== null && holderAlive === false) {
    return {
      abandonment: { holderPid: stored.holderPid, kind: "holder-gone" },
      attempt: stored.attempt,
      holder: stored.holder,
      holderToken: stored.holderToken,
      kind: "abandoned",
      ran,
    };
  }
  if (leaseIsLive({ leaseExpiresIso: stored.leaseExpiresIso, nowIso })) {
    return {
      attempt: stored.attempt,
      holder: stored.holder,
      kind: "held",
      leaseExpiresIso: stored.leaseExpiresIso,
    };
  }
  return {
    abandonment: { kind: "lease-expired" },
    attempt: stored.attempt,
    holder: stored.holder,
    holderToken: stored.holderToken,
    kind: "abandoned",
    ran,
  };
}

/** The verdict for a row whose last attempt FAILED — cooling, retryable, or out of attempts. */
function failedAttemptVerdict({
  stored,
  outcome,
  nowIso,
}: {
  stored: RecipeSlotAttempt;
  outcome: Extract<RecipeSlotOutcome, { kind: "failed" }>;
  nowIso: string;
}): RecipeSlotVerdict {
  if (stored.attempt >= MAX_ATTEMPTS_PER_SLOT) {
    return {
      attempt: stored.attempt,
      holderToken: stored.holderToken,
      kind: "exhausted",
      previousDetail: outcome.detail,
    };
  }
  const floorMs = Date.parse(outcome.retryNotBeforeIso);
  // An unreadable floor reads as PASSED rather than as blocking forever: a row that can never be retried is
  // a silent row, which is the failure this whole module exists to remove.
  const cooling = !Number.isNaN(floorMs) && Date.parse(nowIso) < floorMs;
  if (cooling) {
    return {
      attempt: stored.attempt,
      failedAtIso: outcome.settledAtIso,
      kind: "cooling",
      previousDetail: outcome.detail,
      retryNotBeforeIso: outcome.retryNotBeforeIso,
    };
  }
  return { attempt: stored.attempt + 1, kind: "retry", previousDetail: outcome.detail };
}

/**
 * The words for a COOLING verdict — the one wording `automation run-due` and `automation seat` both print, so a
 * firing reads the same whichever met it. It names when the attempt failed and why, because the line is
 * routinely read hours after that failure. PURE.
 *
 * @param verdict the cooling verdict to describe
 * @returns the words, without the recipe and slot prefix a caller adds
 */
export function coolingWhy({ verdict }: { readonly verdict: Extract<RecipeSlotVerdict, { kind: "cooling" }> }): string {
  return (
    `COOLING · attempt ${String(verdict.attempt)} failed at ${verdict.failedAtIso} (${verdict.previousDetail}); ` +
    `the next may start at ${verdict.retryNotBeforeIso}`
  );
}

/**
 * What a dispatcher should do about one slot, from its stored row alone. PURE — the caller supplies the
 * clock and the row.
 *
 * @param stored the slot's row, or `null` when nothing has ever attempted it
 * @param holderAlive whether the row's `holderPid` process still runs, resolved by the caller — `null` when
 * the row names no process or nobody probed, which keeps the lease-only judgement
 * @param nowIso the reference instant
 * @returns what to do
 */
export function judgeSlotAttempt({
  stored,
  holderAlive,
  nowIso,
}: {
  readonly stored: RecipeSlotAttempt | null;
  readonly holderAlive: boolean | null;
  readonly nowIso: string;
}): RecipeSlotVerdict {
  if (stored === null) {
    return { attempt: 1, kind: "open" };
  }
  if (stored.outcome === null) {
    return openAttemptVerdict({ holderAlive, nowIso, stored });
  }
  // BEFORE the failed branch and before anything that could read it as settled. A deferred row is takeable
  // again immediately, at the SAME attempt number — the deferral cost the firing nothing, so a row that has
  // deferred ten times is still on attempt 1 and has all three of its attempts left for a real failure.
  if (stored.outcome.kind === "deferred") {
    return { attempt: stored.attempt, kind: "open" };
  }
  if (stored.outcome.kind === "failed") {
    return failedAttemptVerdict({ nowIso, outcome: stored.outcome, stored });
  }
  return { kind: "settled", outcome: stored.outcome };
}

/**
 * The row to write when an attempt is taken. PURE.
 *
 * @param attempt which attempt this is, 1-based, as {@link judgeSlotAttempt} counted it
 * @param holder who is taking it
 * @param holderPid the process running the effect in-process, or `null` when the taker exits before the run
 * @param holderToken the token the holder quotes back to settle it
 * @param leaseExpiresIso the row's own next firing, past which this attempt is abandoned
 * @param nowIso when the attempt started
 * @param recipeId the row being run
 * @param slotIso the cadence firing this attempt covers
 * @returns the row to persist
 */
export function openSlotAttempt({
  attempt,
  holder,
  holderPid,
  holderToken,
  leaseExpiresIso,
  nowIso,
  recipeId,
  slotIso,
}: {
  readonly attempt: number;
  readonly holder: string;
  readonly holderPid: number | null;
  readonly holderToken: string;
  readonly leaseExpiresIso: string;
  readonly nowIso: string;
  readonly recipeId: string;
  readonly slotIso: string;
}): RecipeSlotAttempt {
  return {
    attempt,
    holder,
    holderPid,
    holderToken,
    leaseExpiresIso,
    outcome: null,
    recipeId,
    runStartedAtIso: null,
    schemaVersion: RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
    slotIso,
    startedAtIso: nowIso,
  };
}

/**
 * The outcome kinds that FINISH a firing — nothing is owed for it and the watermark may move past it.
 *
 * Named as an allow-list rather than as `kind !== "failed"`, and that inversion is the point. An exclusion
 * answers TRUE for every kind added after it was written, so the `deferred` kind would have been stamped as
 * covered the moment it existed — silencing the row until its next firing, which is the one thing
 * `cli/exitCodes.ts` § `EXIT_DEFERRED` exists to prevent. This way a new kind fails closed: it is not
 * retiring until somebody puts it here on purpose.
 */
const RETIRING_OUTCOME_KINDS: ReadonlySet<RecipeSlotOutcome["kind"]> = new Set(["succeeded", "dead"]);

/**
 * Whether one slot's row is finished with, so `./definitionDue.ts`'s watermark may move past it. PURE.
 *
 * A FAILED attempt is deliberately not retiring: leaving the watermark where it is is the whole of the
 * retry, because the row then reads due for the same slot again. A DEFERRED one is not retiring for the
 * same reason and a stronger one — nothing ran at all.
 *
 * @param outcome how the attempt ended
 * @returns true when the slot should be stamped as covered
 */
export function slotIsRetired({ outcome }: { readonly outcome: RecipeSlotOutcome }): boolean {
  return RETIRING_OUTCOME_KINDS.has(outcome.kind);
}

/**
 * Check a settling caller's token against the row it is settling. PURE.
 *
 * An UNHELD slot fails this deliberately: a settle has no attempt to close and no lease to prove it ran
 * under, so honouring one would advance the schedule on a caller's say-so alone.
 *
 * @param stored the slot's row, or `null`
 * @param holderToken the token the caller was given when it took the attempt
 * @param recipeId the row being settled, carried onto the refusal
 * @param slotIso the firing being settled, carried onto the refusal
 * @returns the open row this caller holds, or why it may not settle one
 */
export function settleableAttempt({
  stored,
  holderToken,
  recipeId,
  slotIso,
}: {
  readonly stored: RecipeSlotAttempt | null;
  readonly holderToken: string;
  readonly recipeId: string;
  readonly slotIso: string;
}): Result<RecipeSlotAttempt, RecipeSlotAttemptError> {
  if (stored === null) {
    return err(RecipeSlotAttemptErrors.notHeld({ recipeId, slotIso }));
  }
  if (stored.holderToken !== holderToken) {
    return err(RecipeSlotAttemptErrors.tokenMismatch({ holder: stored.holder, recipeId, slotIso }));
  }
  return ok(stored);
}
