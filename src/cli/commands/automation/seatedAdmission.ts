/**
 * Admitting a SPAWN-shaped row into the session `automation seat` opened for it — the whole of what a claim
 * token buys, and the one case where that session takes a firing itself.
 *
 * Split out of `./runDue.ts` along the seam the token draws: everything here runs only when `--claim-id`
 * was given, and nothing here is reached by an ordinary tick. `./runDueAttempt.ts#admitRow` is the caller.
 *
 * ## The token names the SESSION, not one firing
 *
 * A seat takes the firing its row is due for and leases it to the row's own next firing
 * (`live/automation/definitionClaim.ts` says why no other expiry is allowed). So a session opened minutes before
 * that firing arrives holding an attempt the schedule has already overtaken. MEASURED
 * (`recipe-seat-hands-a-session-a-claim-that`): `automation seat` took `resync-corpus-fathom`'s earlier
 * firing under a lease ending at the row's next firing, 114 seconds away — the session ran the row just after
 * that next firing, the due judgement chose it, nothing held that firing, and the session was refused with
 * nothing run. The sibling finding (`a-seated-resync-pass-loses-its-remaining-claims-when-it-runs-past-the-
 * next-firing`) is the same mechanism from the other side: a pass holding 21 rows ran past the next firing
 * and its last two rows were refused the same way.
 *
 * The fix is on THIS side rather than the seat's, and that is a rule rather than a preference: a seat
 * refusing a lease "shorter than a session can boot" would be an invented threshold, and a seat cannot take the NEXT firing because it has not happened yet. What the session
 * has is a token, so the token is what {@link carrySeatForward} reads.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { startUnlessHeld } from "../../../live/automation/failureHoldStore.js";
import type { RecipeSlotAttempt, RecipeSlotVerdict } from "../../../live/automation/slotAttempt.js";
import type { RecipeSlotAttemptError } from "../../../live/automation/slotAttemptErrors.js";
import { giveBackUnstartedAttempt } from "../../../live/automation/slotLedger.js";
import { findAttemptHeldBy } from "../../../live/automation/slotLedgerScan.js";
import { startSeatedRun } from "../../../live/automation/slotSeatedRun.js";
import type { RowOutcome } from "./rowRunners.js";
import { type SlotRunDeps, takeSlot } from "./slotRun.js";

/** What admitting one row answered: the attempt it now holds, or the outcome to report instead. */
export type RowAdmission =
  | {
      readonly kind: "admitted";
      readonly attempt: RecipeSlotAttempt;
      /**
       * The firing the seat originally took, when {@link carrySeatForward} moved this session onto the
       * firing the row is due for now; `null` on every ordinary admission.
       */
      readonly carriedFrom: string | null;
    }
  | { readonly kind: "refused"; readonly outcome: RowOutcome };

/**
 * The outcome line a carried seat prints above its run, so the transcript says which firing ran and why.
 *
 * @param carriedFrom the firing the seat took and this session was moved off
 * @returns the line, as an outcome that ran nothing itself
 */
export function carriedForwardOutcome({
  carriedFrom,
  definition,
  slotIso,
}: {
  carriedFrom: string;
  definition: RecipeDefinition;
  slotIso: string;
}): RowOutcome {
  return {
    detail: [],
    exitCode: null,
    failed: false,
    line:
      `recipe ${definition.recipeId} · seat carried forward · the seat's firing ${carriedFrom} never started ` +
      `under this token before the row's next firing, so its due firing ${slotIso} runs instead`,
    ran: false,
    recipeId: definition.recipeId,
  };
}

/**
 * Move a seated session onto the firing its row is due for NOW, when the firing its seat took has been
 * overtaken before the session could start it.
 *
 * MEASURED (`recipe-seat-hands-a-session-a-claim-that`): `automation seat` took
 * `resync-corpus-fathom`'s earlier firing under a lease ending at the row's own next firing, 114 seconds
 * away, which `live/automation/definitionClaim.ts` says is the only expiry a lease may have. The session it
 * opened ran the row just after that next firing, the due judgement chose it, nothing held that firing, and the
 * session was refused with nothing run. The sibling finding
 * (`a-seated-resync-pass-loses-its-remaining-claims-when-it-runs-past-the-next-firing`) is the same
 * mechanism reached from the other side: a pass holding 21 rows ran past the next firing and its last two
 * rows were refused the same way.
 *
 * The fix is on THIS side rather than the seat's, and that is a rule rather than a preference: a seat
 * refusing a lease "shorter than a session can boot" would be an invented threshold, and a seat cannot take the NEXT firing because it has not happened yet. What the
 * session has is a token, so the token is what this reads. An open attempt under it that never started
 * proves nothing ran — `startSeatedRun` stamps `runStartedAtIso` under the ledger mutex BEFORE the effect —
 * so the stale attempt is given back exactly as a seat whose session never opened gives one back, and the
 * due firing is taken afresh under the same holder and the same token, then started. A due firing another
 * seat already holds is refused by the ledger's own verdict, so the token can never cause a firing someone
 * else took to run twice; a token whose attempt already started is not carried, because the run it
 * describes may be under way in another pane.
 *
 * @param claimId the token this process was given by its seat
 * @param definition the spawn-shaped row being run
 * @param home the state home the ledger lives under
 * @param slotDeps the take/settle edges, whose mint is REPLACED by the seat's token so the settling token
 *   stays the one the session was handed
 * @param slotIso the firing the row is due for now
 * @returns the admission onto the due firing, or `null` when this token holds nothing that can be carried
 */
async function carrySeatForward({
  claimId,
  definition,
  home,
  slotDeps,
  slotIso,
}: {
  claimId: string;
  definition: RecipeDefinition;
  home: string;
  slotDeps: SlotRunDeps;
  slotIso: string;
}): Promise<RowAdmission | null> {
  const recipeId = definition.recipeId;
  const stale = findAttemptHeldBy({ holderToken: claimId, home, recipeId });
  if (stale === null) {
    return null;
  }
  // The scan above is unlocked and the "never started" fact it read can go stale: a second invocation of the
  // same seated command may START this attempt between that read and this write. So the check and the
  // removal are ONE locked act in the ledger, never a read here followed by a plain release (r1 review).
  const given = giveBackUnstartedAttempt({
    holderToken: claimId,
    home,
    nowIso: slotDeps.now(),
    recipeId,
    slotIso: stale.slotIso,
  });
  if (given.isErr()) {
    return refusal({ line: `recipe ${recipeId} · REFUSED · ${given.error.message}`, recipeId });
  }
  if (given.value.kind === "started") {
    return refusal({
      line:
        `recipe ${recipeId} · REFUSED · this token's seated run of firing ${stale.slotIso} already started at ` +
        `${given.value.at} and has not settled — a second invocation of the seated command runs nothing`,
      recipeId,
    });
  }
  const taken = await takeSlot({
    definition,
    deps: { ...slotDeps, mintId: () => claimId },
    holder: stale.holder,
    // The carried TAKE stays PID-less, as the seat's own take is; `startCarriedRun` stamps this process's pid.
    holderPid: null,
    home,
    slotIso,
  });
  if (taken.kind === "refused") {
    // FAILED whatever the take's own verdict says: on an ordinary tick a held firing is a fact about the
    // schedule and the tick goes on, but this session was SEATED for this row and did not run it, and its
    // exit code is what the seated session reads. The line still says who holds it.
    return refusal({ line: `${taken.line} — the seat carried from ${stale.slotIso} runs nothing`, recipeId });
  }
  return startCarriedRun({ claimId, carriedFrom: stale.slotIso, home, nowIso: slotDeps.now(), recipeId, slotIso });
}

/**
 * Give back the firing a seat took for a row that is NOT DUE when its seated command runs, so the attempt
 * does not sit open until its lease runs out.
 *
 * MEASURED (`corpus-resyncs-die-mid-run-before-their-lease-settles`): a seat took the
 * `0 *&#47;4` resyncs' firing for one session, slack ran first for forty minutes, and by then github and
 * linear read DEFERRED to their next-firing successor. The tick passes only DUE rows on, so the token was never read,
 * `run-due` exited 0, and both attempts stayed open with `runStartedAtIso` null until that successor — where
 * `automation status` read them abandoned and `fleet-unhealthy` reported two syncs dying mid-run that never ran.
 *
 * Only a LIVE row's firing is given back — deferred, current or unschedulable. A held or disabled row keeps its
 * attempt unstarted on purpose, so the seat's firing is retaken once the hold lifts. The removal is the same
 * locked check-and-remove {@link carrySeatForward} makes, so a run another invocation started in the gap is
 * left alone.
 *
 * @param claimId the token this process was given by its seat
 * @param definition the spawn-shaped row the tick judged not due
 * @param home the state home the ledger lives under
 * @param nowIso the reference instant the ledger lock is judged against
 * @returns the outcome to report, or `null` when this token holds no open attempt on the row
 */
export function giveBackSeatNotDue({
  claimId,
  definition,
  home,
  nowIso,
}: {
  claimId: string;
  definition: RecipeDefinition;
  home: string;
  nowIso: string;
}): RowOutcome | null {
  const recipeId = definition.recipeId;
  const held = findAttemptHeldBy({ holderToken: claimId, home, recipeId });
  if (held === null) {
    return null;
  }
  const given = giveBackUnstartedAttempt({ holderToken: claimId, home, nowIso, recipeId, slotIso: held.slotIso });
  if (given.isErr()) {
    return failedOutcome({ line: `recipe ${recipeId} · REFUSED · ${given.error.message}`, recipeId });
  }
  if (given.value.kind === "started") {
    return notRunOutcome({
      line:
        `recipe ${recipeId} · not due · this token's seated run of firing ${held.slotIso} already started at ` +
        `${given.value.at}, so it is left to settle`,
      recipeId,
    });
  }
  return notRunOutcome({
    line:
      `recipe ${recipeId} · seat given back · its firing ${held.slotIso} never started under this token and the ` +
      "row is not due now, so the attempt is removed rather than left open to its lease; the row's next due " +
      "firing takes it",
    recipeId,
  });
}

/**
 * A seated start the definition hold lock did not let through: held or retired since seating runs nothing with
 * nothing wrong, and a busy lock leaves the attempt unstarted for the next invocation, also nothing wrong.
 */
function heldOrBusy({
  guarded,
  recipeId,
}: {
  guarded: { readonly kind: "busy" | "held"; readonly why: string };
  recipeId: string;
}): RowAdmission {
  if (guarded.kind === "held") {
    return notRun({ line: `recipe ${recipeId} · HELD since this session was seated — ${guarded.why}`, recipeId });
  }
  return notRun({ line: `recipe ${recipeId} · not started · ${guarded.why}; its attempt stays unstarted`, recipeId });
}

/** The outcome of a seated row that ran nothing here with nothing wrong. */
function notRunOutcome({ line, recipeId }: { line: string; recipeId: string }): RowOutcome {
  return { detail: [], exitCode: null, failed: false, line, ran: false, recipeId };
}

/** Start the run of a firing this session has just carried its seat onto. */
function startCarriedRun({
  carriedFrom,
  claimId,
  home,
  nowIso,
  recipeId,
  slotIso,
}: {
  carriedFrom: string;
  claimId: string;
  home: string;
  nowIso: string;
  recipeId: string;
  slotIso: string;
}): RowAdmission {
  const guarded = startUnlessHeld({
    home,
    nowIso,
    recipeId,
    start: () => startSeatedRun({ holderPid: process.pid, holderToken: claimId, home, nowIso, recipeId, slotIso }),
  });
  if (guarded.kind !== "started") {
    return heldOrBusy({ guarded, recipeId });
  }
  const started = guarded.value;
  if (started.isErr()) {
    return refusal({ line: `recipe ${recipeId} · REFUSED · ${started.error.message}`, recipeId });
  }
  if (started.value.kind === "refused") {
    return refusal({ line: seatedRunNotOpenLine({ recipeId, slotIso, verdict: started.value.verdict }), recipeId });
  }
  return { attempt: started.value.attempt, carriedFrom, kind: "admitted" };
}

/** One refusal of a seated row: a line, and the FAILED flag every one of them carries. */
function refusal({ line, recipeId }: { line: string; recipeId: string }): RowAdmission {
  return { kind: "refused", outcome: failedOutcome({ line, recipeId }) };
}

/** The outcome of a seated row refused for something wrong. */
function failedOutcome({ line, recipeId }: { line: string; recipeId: string }): RowOutcome {
  return { detail: [], exitCode: null, failed: true, line, ran: false, recipeId };
}

/** A seated row that runs nothing here with nothing wrong: not this session's to run, or held since seating. */
function notRun({ line, recipeId }: { line: string; recipeId: string }): RowAdmission {
  return { kind: "refused", outcome: notRunOutcome({ line, recipeId }) };
}

/** The line for a seated firing whose attempt is no longer open to start — already started, or overtaken. */
function seatedRunNotOpenLine({
  recipeId,
  slotIso,
  verdict,
}: {
  recipeId: string;
  slotIso: string;
  verdict: RecipeSlotVerdict;
}): string {
  return (
    `recipe ${recipeId} · REFUSED · slot ${slotIso} is ${verdict.kind} — this firing's seated run has already ` +
    "started, or its attempt is no longer open"
  );
}

/** What a seated start the ledger refused prints. PURE. */
function seatedStartFailedLine({ error, recipeId }: { error: RecipeSlotAttemptError; recipeId: string }): string {
  // The ledger's own sentence is about SETTLING, which is what its author was refusing; what the session
  // reading this needs to know is that its token holds nothing on the row at all.
  const why =
    error.code === "SLOT_NOT_HELD"
      ? "no open attempt on this row carries this token — the seat that minted it was released, or the run " +
        "it was minted for already settled"
      : error.message;
  return `recipe ${recipeId} · REFUSED · ${why}`;
}

/**
 * Whether a SPAWN-shaped row may run in THIS process — the whole of what a claim token buys.
 *
 * These rows run in a session a supervisor pass seats, so running one here is only correct
 * when this process IS that session. The token is what proves it: `automation seat` takes the row's firing and
 * hands the token to the workspace it opens, so a caller quoting it back is the seated session and nobody
 * else. The three refusals are deliberately different facts rather than one message — an ordinary tick has
 * nothing wrong with it and should not read as a failure, while a token that does not match is a real
 * mistake.
 *
 * It reads the LEDGER rather than taking a firing, because the seat already took it. Taking it again here
 * would mint a second attempt for a firing this process is already the holder of. The one time it DOES
 * take one is {@link carrySeatForward}: the seat's firing was overtaken by the row's next firing before
 * this session started it, so the token holds an attempt nothing ran under, on a firing the row is no
 * longer due for.
 *
 * @param claimId the token this process was given, or `null` on an ordinary tick
 * @param definition the spawn-shaped row being judged
 * @param home the state home the ledger lives under
 * @param slotDeps the take/settle edges, reached only when a seat is carried forward
 * @param slotIso the firing this run covers
 * @returns the attempt this process holds, or the outcome to report instead
 */
export async function admitSeatedRow({
  claimId,
  definition,
  home,
  slotDeps,
  slotIso,
}: {
  claimId: string | null;
  definition: RecipeDefinition;
  home: string;
  slotDeps: SlotRunDeps;
  slotIso: string;
}): Promise<RowAdmission> {
  const recipeId = definition.recipeId;
  if (claimId === null) {
    return notRun({
      line: `recipe ${recipeId} · SEAT IT · this row runs in a session — \`slopweaver automation seat --limit <n> --model <m>\``,
      recipeId,
    });
  }
  // A row a failure held or a retirement took after this session was seated runs nothing. Its attempt is left
  // unstarted, so it is retaken rather than judged dead once the hold lifts. Asked UNDER the definition hold lock
  // with the start made before it is released (`startUnlessHeld`), so a retirement in another process cannot land
  // between the ask and the start.
  // The start is a compare-and-SET, never a read: a read let two invocations quoting one token both reach the
  // effect for one firing (r1 returned BROKEN on it). THIS process runs the effect, so its pid goes on the
  // attempt, as `./runDueAttempt.ts#admitRow` does for an unseated row.
  const nowIso = slotDeps.now();
  const guarded = startUnlessHeld({
    home,
    nowIso,
    recipeId,
    start: () => startSeatedRun({ holderPid: process.pid, holderToken: claimId, home, nowIso, recipeId, slotIso }),
  });
  if (guarded.kind !== "started") {
    return heldOrBusy({ guarded, recipeId });
  }
  const started = guarded.value;
  if (started.isErr()) {
    const carried = await carrySeatForward({ claimId, definition, home, slotDeps, slotIso });
    if (carried !== null) {
      return carried;
    }
    return refusal({ line: seatedStartFailedLine({ error: started.error, recipeId }), recipeId });
  }
  if (started.value.kind === "taken") {
    return { attempt: started.value.attempt, carriedFrom: null, kind: "admitted" };
  }
  const carried = await carrySeatForward({ claimId, definition, home, slotDeps, slotIso });
  if (carried !== null) {
    return carried;
  }
  return refusal({ line: seatedRunNotOpenLine({ recipeId, slotIso, verdict: started.value.verdict }), recipeId });
}
