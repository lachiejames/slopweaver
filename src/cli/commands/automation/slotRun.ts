/**
 * TAKE a cadence firing — the one door every recipe dispatcher goes through before it runs anything. The
 * SETTLE that closes what a take handed out is `./slotSettle.ts`.
 *
 * `cli/commands/automation/runDue.ts` runs a row in this process and `cli/commands/automation/seat.ts` opens a
 * session for one; before this module they coordinated through two different mechanisms and only one of
 * them had a lease at all. The whole CLASS must be closed rather than one symptom,
 * so there is exactly one take and exactly one settle, and a kind's run shape changes WHO calls them, never
 * what they mean.
 *
 * ## What a take decides, in one place
 *
 * `live/automation/slotLedger.ts` answers "may I have this firing" from the ledger alone. This module is the
 * layer above it that turns a refusal into the right ACT:
 *
 * - **held / cooling / settled** — report it and run nothing. None of those is a failure; a second tick
 *   finding a firing already taken is the mechanism working.
 * - **abandoned** — an attempt whose lease expired with nothing settled, so the effect MAY have landed.
 *   `live/automation/slotAttempt.ts#retryAfterUnknownIsSafe` decides from what the effect can prove, and this
 *   module performs whichever half it answers: retake it, or declare the firing dead and hand it to a
 *   person.
 * - **exhausted** — every attempt this firing gets has been spent. Declare it dead, stamp the watermark
 *   past it so the schedule moves on, and hold the row on its finding.
 *
 * ## A failure HOLDS the row, and its finding is a BOARD ROW
 *
 * A row that fails once is paused until its fix lands, never cooled and fired again to
 * fail the same way. So a `failed` settle and a death both go through `./slotFailureHold.ts#holdOnFailure`,
 * which places a failure hold (`live/automation/failureHoldStore.ts`) and, unless a failure hold already stands,
 * registers ONE p0 finding through `slopweaver handover register` — the same verb `seat.ts` already calls, through
 * the same door (rule 3). `AGENTS.md`: the board is the ONLY register of what is in flight, so the finding is
 * the row the owner reads, and settling it is what lifts the hold. A take reads that hold again at the moment it
 * takes, and judges a run stranded on an earlier firing before it runs this one (`./slotStranded.ts`).
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { nextFiringAfter, RecipeClaimErrors } from "../../../live/automation/definitionClaim.js";
import type { ProcessAlive } from "../../../live/automation/holderLiveness.js";
import {
  coolingWhy,
  MAX_ATTEMPTS_PER_SLOT,
  type RecipeSlotAttempt,
  type RecipeSlotVerdict,
} from "../../../live/automation/slotAttempt.js";
import type { RecipeSlotAttemptError } from "../../../live/automation/slotAttemptErrors.js";
import { beginSlotAttempt, retakeAbandonedSlot, type SlotAttemptTake } from "../../../live/automation/slotLedger.js";
import {
  type AbandonedVerdict,
  abandonedDeath,
  type DeadLetter,
  type DeadLetterDeps,
  deadLetter,
  refusedLine,
} from "./slotDeadLetter.js";
import { heldSinceRead, holdStranded, writeUnlessHeld } from "./slotStranded.js";

// The settle is its own module, re-exported so a dispatcher still reaches take and settle through one door.
export { settleSlot } from "./slotSettle.js";

/** The edges a take or a settle reaches, injected so both dispatchers are testable with plain fakes. */
export interface SlotRunDeps extends DeadLetterDeps {
  /** Mints an attempt's holder token. */
  readonly mintId: () => string;
  /** Whether a stored attempt's holder pid still runs — `recipeHolderAlive` in production. */
  readonly processAlive: ProcessAlive;
}

/** What a take answered: the attempt this caller now holds, or the line saying why it has none. */
export type SlotTake =
  | { readonly kind: "taken"; readonly attempt: RecipeSlotAttempt }
  | { readonly kind: "refused"; readonly line: string; readonly failed: boolean; readonly died: boolean };

/** The row's own next firing after an instant — the lease every attempt takes. */
function leaseFor({ definition, nowIso }: { definition: RecipeDefinition; nowIso: string }): Result<string> {
  const next = nextFiringAfter({ afterIso: nowIso, cadence: definition.cadence });
  if (typeof next !== "string") {
    // Forwarded from the domain's own factory rather than authored here: `src/cli/commands/automation` is on the
    // `error-shape-threshold` debt list, which only shrinks, and the union already says this exact thing.
    return err([
      RecipeClaimErrors.cadenceUnschedulable({
        cadence: definition.cadence,
        reason: next.error,
        recipeId: definition.recipeId,
      }).message,
    ]);
  }
  return ok(next);
}

/**
 * Take one cadence firing for this caller, performing whatever the ledger's verdict actually requires.
 *
 * @param request the row, its edges and its taker — spread whole into a refusal's resolution
 * @returns the attempt now held, or the line saying why nothing runs
 */
export async function takeSlot(request: {
  /** The row being run. */
  readonly definition: RecipeDefinition;
  readonly deps: SlotRunDeps;
  /** Who is taking it — a verb name, a board slug, a workspace. */
  readonly holder: string;
  /** The process that will run the effect in THIS process, or `null` when the taker exits first. */
  readonly holderPid: number | null;
  /** The state home the ledger lives under. */
  readonly home: string;
  /** The firing this run covers, as the due verdict chose it. */
  readonly slotIso: string;
}): Promise<SlotTake> {
  // Each named field is read exactly once, and nothing else on `request` is: the refusal below spreads this
  // snapshot of the six, never `request` itself.
  const { definition, deps, holder, holderPid, home, slotIso } = request;
  const taker = { definition, deps, holder, holderPid, home, slotIso };
  const held = heldSinceRead({ definition, home, slotIso });
  if (held !== null) {
    return held;
  }
  const nowIso = deps.now();
  const lease = leaseFor({ definition, nowIso });
  if (lease.isErr()) {
    return { died: false, failed: true, kind: "refused", line: lease.error.join("; ") };
  }
  const strandedTake = await holdStranded({ definition, deps, holder, home, nowIso, slotIso });
  if (strandedTake !== null) {
    return strandedTake;
  }
  const holderToken = deps.mintId();
  const taken = guardedTake({
    definition,
    home,
    nowIso,
    slotIso,
    write: () =>
      beginSlotAttempt({
        holder,
        holderPid,
        holderToken,
        home,
        leaseExpiresIso: lease.value,
        nowIso,
        processAlive: deps.processAlive,
        recipeId: definition.recipeId,
        slotIso,
      }),
  });
  if (taken.kind !== "verdict") {
    return taken;
  }
  return resolveRefusal({ ...taker, holderToken, lease: lease.value, nowIso, verdict: taken.verdict });
}

/**
 * One ledger write guarded by a hold landing since the roster was read, reduced to the take it settles — or the
 * verdict the ledger refused it with, which only the caller knows how to act on. Shared by a first take and a
 * retake, so the two cannot drift on what a refused or failed write reports.
 */
function guardedTake({
  definition,
  home,
  nowIso,
  slotIso,
  write,
}: {
  readonly definition: RecipeDefinition;
  readonly home: string;
  readonly nowIso: string;
  readonly slotIso: string;
  readonly write: () => Result<SlotAttemptTake, RecipeSlotAttemptError>;
}): SlotTake | { readonly kind: "verdict"; readonly verdict: RecipeSlotVerdict } {
  const guarded = writeUnlessHeld({ definition, home, nowIso, slotIso, write });
  if (guarded.kind === "refused") {
    return guarded.take;
  }
  const written = guarded.written;
  if (written.isErr()) {
    return { died: false, failed: true, kind: "refused", line: written.error.message };
  }
  if (written.value.kind === "taken") {
    return { attempt: written.value.attempt, kind: "taken" };
  }
  return { kind: "verdict", verdict: written.value.verdict };
}

/**
 * The line a refusal that runs NOTHING prints — every verdict that is neither a death nor a retake. PURE.
 *
 * Split out so {@link resolveRefusal} reads as a dispatch rather than as six line-builders: none of these
 * arms does anything, they only have to say the right true sentence about what the ledger found.
 *
 * @param recipeId the row being judged
 * @param slotIso the firing being judged
 * @param verdict what the ledger answered
 * @returns the line, or `undefined` when this verdict calls for an ACT rather than a sentence
 */
function quietRefusalLine({
  recipeId,
  slotIso,
  verdict,
}: {
  recipeId: string;
  slotIso: string;
  verdict: RecipeSlotVerdict;
}): string | undefined {
  // OPEN and RETRY never reach here from a take that refused — the ledger only refuses what it will not
  // hand over. They DO reach here from a retake whose firing another dispatcher settled in between, which
  // is a race rather than a mistake: nothing ran, nothing is owed, and the next tick judges it afresh.
  if (verdict.kind === "open" || verdict.kind === "retry") {
    return refusedLine({ recipeId, slotIso, what: "another dispatcher changed it first — nothing ran" });
  }
  if (verdict.kind === "held") {
    return refusedLine({
      recipeId,
      slotIso,
      what: `HELD · attempt ${String(verdict.attempt)} is running under ${verdict.holder} until ${verdict.leaseExpiresIso}`,
    });
  }
  if (verdict.kind === "cooling") {
    return refusedLine({ recipeId, slotIso, what: coolingWhy({ verdict }) });
  }
  if (verdict.kind === "settled") {
    return refusedLine({ recipeId, slotIso, what: `already ${verdict.outcome.kind} — nothing to run` });
  }
  return undefined;
}

/** Turn a ledger refusal into the act it actually calls for. Extracted so {@link takeSlot} stays one read. */
async function resolveRefusal({
  definition,
  deps,
  holder,
  holderPid,
  holderToken,
  home,
  lease,
  nowIso,
  slotIso,
  verdict,
}: {
  definition: RecipeDefinition;
  deps: SlotRunDeps;
  holder: string;
  holderPid: number | null;
  holderToken: string;
  home: string;
  lease: string;
  nowIso: string;
  slotIso: string;
  verdict: RecipeSlotVerdict;
}): Promise<SlotTake> {
  const recipeId = definition.recipeId;
  const quiet = quietRefusalLine({ recipeId, slotIso, verdict });
  if (quiet !== undefined) {
    return { died: false, failed: false, kind: "refused", line: quiet };
  }
  if (verdict.kind === "exhausted") {
    return deadTake({
      letter: await deadLetter({
        definition,
        deps,
        detail: verdict.previousDetail,
        home,
        judged: { attempt: verdict.attempt, holderToken: verdict.holderToken },
        observedBy: holder,
        reason: "ATTEMPTS_EXHAUSTED",
        slotIso,
        what: `all ${String(MAX_ATTEMPTS_PER_SLOT)} attempts failed (${verdict.previousDetail})`,
      }),
    });
  }
  // Spelled as a guard rather than left to fall through: {@link quietRefusalLine} answered every other arm
  // above, so the compiler can no longer see that this one is the only survivor.
  if (verdict.kind !== "abandoned") {
    return {
      died: false,
      failed: false,
      kind: "refused",
      line: refusedLine({ recipeId, slotIso, what: "nothing to run" }),
    };
  }
  return resolveAbandoned({ definition, deps, holder, holderPid, holderToken, home, lease, nowIso, slotIso, verdict });
}

/** A dead-letter arm, as the TAKE path reports it: the same two facts, plus whether a firing was retired. */
function deadTake({ letter }: { letter: DeadLetter }): SlotTake {
  return { died: letter.died, failed: letter.settlement.failed, kind: "refused", line: letter.settlement.line };
}

/** The abandoned arm: retake when a retry can be proved safe, otherwise declare the firing dead. */
async function resolveAbandoned(request: {
  definition: RecipeDefinition;
  deps: SlotRunDeps;
  holder: string;
  holderPid: number | null;
  holderToken: string;
  home: string;
  lease: string;
  nowIso: string;
  slotIso: string;
  verdict: AbandonedVerdict;
}): Promise<SlotTake> {
  const { definition, deps, holder, holderPid, holderToken, home, lease, nowIso, slotIso, verdict } = request;
  const death = abandonedDeath({ definition, verdict });
  if (death !== undefined) {
    const letter = await deadLetter({
      definition,
      deps,
      detail: death.detail,
      home,
      judged: { attempt: verdict.attempt, holderToken: verdict.holderToken },
      observedBy: holder,
      reason: death.reason,
      slotIso,
      what: death.what,
    });
    return deadTake({ letter });
  }
  const retaken = guardedTake({
    definition,
    home,
    nowIso,
    slotIso,
    write: () =>
      retakeAbandonedSlot({
        holder,
        holderPid,
        holderToken,
        home,
        leaseExpiresIso: lease,
        nowIso,
        processAlive: deps.processAlive,
        recipeId: definition.recipeId,
        slotIso,
      }),
  });
  if (retaken.kind !== "verdict") {
    return retaken;
  }
  const line = retakeRefusedLine({ recipeId: definition.recipeId, slotIso, verdict: retaken.verdict });
  return { died: false, failed: false, kind: "refused", line };
}

/**
 * What a refused retake prints. The retake re-judged under its own lock, so it says what it found — a HELD
 * there is a holder now reading alive, not another dispatcher, and the two are different facts to a reader.
 */
function retakeRefusedLine({
  recipeId,
  slotIso,
  verdict,
}: {
  recipeId: string;
  slotIso: string;
  verdict: RecipeSlotVerdict;
}): string {
  const current = quietRefusalLine({ recipeId, slotIso, verdict });
  if (current !== undefined) {
    return current;
  }
  return refusedLine({ recipeId, slotIso, what: "another dispatcher retook it first" });
}
