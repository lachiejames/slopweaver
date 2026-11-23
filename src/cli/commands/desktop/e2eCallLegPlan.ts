/**
 * What the call leg does before it places anything: hold while the owner is on a call, wait out a call it did not place, and —
 * for `--call-card all` — read every open card off a test instance of its own and place a card scenario per card.
 * Split out of `./e2eCallDriver.ts` along that seam: everything here runs before the first scenario, behind the leg's
 * lock. (`./e2eCallPreflight.ts` is each scenario's own session preflight, its microphone and cursors.)
 */
import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { CALL_STEP_IDS, type E2eCallStep } from "../../../desktop/e2eCallPlan.js";
import { cardReadSteps, type E2eCardStepId, placeCardSteps } from "../../../desktop/e2eCardReadPlan.js";
import type { E2eStepResult } from "../../../desktop/e2eReport.js";
import type { E2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import { type HeldConversation, preflightDecision } from "../../../desktop/heldConversations.js";
import type { OnCallHoldError } from "../../../desktop/onCallHold.js";
import { overlappedCallIds, UNENDED_CALLS_KEEP, unendedCallIds } from "../../../desktop/unendedCalls.js";
import { readCalls } from "../../../talk/callStore.js";
import { readCardInventory } from "./e2eCallCardInventory.js";
import { liveLeaseIds } from "./e2eCallEvidenceRead.js";
import { until } from "./e2eCallPage.js";
import { PRODUCTION_HELD_DEPS, readHeldConversations } from "./e2eHeldConversationsRead.js";
import { readOnCallHold } from "./onCallRead.js";

/** What planning the leg needs from the verb. */
export interface E2eCallLegPlanOptions {
  readonly app: string;
  readonly checkout: string;
  /** Every checkout whose console may hold a call of the owner's: the target and each main checkout the owner declares. */
  readonly consoles: readonly string[];
  /** The work context the inventory's instance reads its console in (`--context`). */
  readonly context: E2eWorkContext | undefined;
  readonly home: string;
  readonly steps: readonly E2eCallStep[];
  readonly inventorySurfaces: readonly E2eCardStepId[];
  readonly note: (options: { readonly line: string }) => void;
}

/**
 * Read the whole on-call hold first — a live lease or a microphone another app holds holds the run at once, never
 * waited out (`../../../desktop/onCallHold.ts`) — then wait for no conversation to be held in any of
 * the owner's consoles and no call left open in the shared store, refusing past the wait and at once on a lease that appears
 * during it (`../../../desktop/heldConversations.ts` decides each read), then read the hold again: a call the owner picked up
 * during the wait stops the leg before the press.
 *
 * @param home the state home whose consoles' leases are read
 * @param consoles every checkout whose console registry is asked: the target and each one the owner declares
 * @param waitMs how long a call it did not place is waited out (`foreignCallWaitMs`)
 * @param placed the ids of the calls this leg placed itself, which never hold it back
 * @returns `undefined` once the owner is not on a call and nothing is open, else why no call may be placed
 */
export async function preflight({
  home,
  consoles,
  waitMs,
  placed,
}: {
  home: string;
  consoles: readonly string[];
  waitMs: number;
  placed: readonly string[];
}): Promise<E2eCallError | OnCallHoldError | undefined> {
  const onCall = readOnCallHold({ home });
  if (onCall !== undefined) {
    return onCall;
  }
  let problem: E2eCallError | undefined;
  const clear = await until({
    capMs: waitMs,
    test: async () => {
      const conversations = await heldAcross({ consoles, home });
      // Read after the registry's await, never before it, so a lease taken during that request is seen.
      const leases = liveLeaseIds({ home, nowMs: Date.now() });
      const decision = preflightDecision({ conversations, leases });
      if (decision.kind !== "clear") {
        problem = decision.error;
        return decision.kind !== "wait";
      }
      // Read last, so a call another console opened during the reads above is seen by this one.
      const unended = unendedCallsRead({ home, placed });
      if (unended !== undefined) {
        problem = unended;
        return false;
      }
      problem = undefined;
      return true;
    },
  });
  if (problem !== undefined) {
    return problem;
  }
  if (!clear) {
    // The wait ran out without a read that said clear: never read as clear.
    return E2eCallErrors.callAlreadyLive({ live: 0 });
  }
  return readOnCallHold({ home });
}

/**
 * What every one of the owner's consoles holds, unioned: the owner's call may be in a console the leg does not target,
 * so each declared checkout's registry is asked, and any one unreadable makes the read unreadable.
 *
 * @param consoles the checkouts whose registries are asked
 * @param home the state home holding the older run records
 * @returns every conversation held, or why one registry could not be read
 */
async function heldAcross({
  consoles,
  home,
}: {
  consoles: readonly string[];
  home: string;
}): Promise<Result<readonly HeldConversation[], E2eCallError>> {
  const held: HeldConversation[] = [];
  for (const checkout of new Set(consoles)) {
    const read = await readHeldConversations({ cacheRoot: undefined, checkout, deps: PRODUCTION_HELD_DEPS, home });
    if (read.isErr()) {
      return err(read.error);
    }
    held.push(...read.value);
  }
  return ok(held);
}

/**
 * Every call the shared store says may still be open beside a test call, whichever console holds it.
 *
 * @param home the state home whose call store is read
 * @param placed the ids of the calls this leg placed itself
 * @returns `undefined` when none may be, else why the leg waits — an unreadable store or call file included
 */
function unendedCallsRead({ home, placed }: { home: string; placed: readonly string[] }): E2eCallError | undefined {
  const nowMs = Date.now();
  const read = readCalls({ home, keep: UNENDED_CALLS_KEEP });
  if (read.isErr()) {
    return E2eCallErrors.evidenceUnreadable({ detail: read.error.message, path: "the call store" });
  }
  if (read.value.unreadable.length > 0) {
    const detail = read.value.unreadable.join("; ");
    return E2eCallErrors.evidenceUnreadable({ detail, path: "the call store" });
  }
  const callIds = unendedCallIds({ calls: read.value.calls, nowMs, placed });
  if (callIds.length === 0) {
    return undefined;
  }
  return E2eCallErrors.callStillOpen({ callIds });
}

/**
 * The read AFTER a scenario: every call this leg did not place that was open while it ran, so a call of the owner's that
 * began after the preflight's snapshot stops the leg instead of passing unseen.
 *
 * Two reads, because the store learns of a call only as its console's transcript batches land, and a batch can wait
 * Once the scenario's cleanup has proven this leg's own leases gone, the whole on-call hold is
 * read again: any live lease is the owner's, and so is the real microphone in use, which the test instance never opens. The
 * microphone is what covers a call of the owner's whose console stopped beating its lease and writing its file while the owner is
 * still on it, which the store's quiet window would otherwise read as abandoned. **One residual,
 * stated**: a call the owner both opens and ends inside the scenario, whose batches are still queued at this read, holds no
 * lease and no microphone by then and is in no file yet, so it is not seen; nothing on disk records it until they land.
 *
 * @param home the state home whose call store, leases and microphones are read
 * @param placed the ids of the calls this leg placed itself, the scenario just run included
 * @param fromMs when the scenario's preflight began
 * @param cleaned whether the scenario's cleanup proved its own leases gone, so a live lease is never its own
 * @returns `undefined` when none overlapped, else the overlap — or an unreadable read, which never reads as clear
 */
function overlapAfter({
  home,
  placed,
  fromMs,
  cleaned,
}: {
  home: string;
  placed: readonly string[];
  fromMs: number;
  cleaned: boolean;
}): E2eCallError | OnCallHoldError | undefined {
  const toMs = Date.now();
  if (cleaned) {
    const held = readOnCallHold({ home });
    if (held !== undefined) {
      return held;
    }
  }
  const read = readCalls({ home, keep: UNENDED_CALLS_KEEP });
  if (read.isErr()) {
    return E2eCallErrors.evidenceUnreadable({ detail: read.error.message, path: "the call store" });
  }
  if (read.value.unreadable.length > 0) {
    return E2eCallErrors.evidenceUnreadable({ detail: read.value.unreadable.join("; "), path: "the call store" });
  }
  const callIds = overlappedCallIds({ calls: read.value.calls, fromMs, placed, toMs });
  if (callIds.length === 0) {
    return undefined;
  }
  return E2eCallErrors.callOverlapped({ callIds });
}

/**
 * Why the leg stops after a scenario ran, if it does: its calls not proven ended, or a call it did not place open while
 * it ran.
 *
 * @param fatal the scenario's own stop, a cleanup that failed
 * @param result what it ran
 * @param placed the calls the leg placed before it
 * @param fromMs when its preflight began
 * @param release frees the leg's lock — called when only an overlap stops it ({@link legStop})
 * @returns why the leg stops, or `undefined` to run the next scenario
 */
export function stopAfter({
  fatal,
  result,
  placed,
  fromMs,
  home,
  release,
}: {
  fatal: string | undefined;
  result: E2eStepResult;
  placed: readonly string[];
  fromMs: number;
  home: string;
  release: () => void;
}): string | undefined {
  // The preflight is a snapshot: a call of the owner's begun after it is detected here, and stops the leg —
  // read whatever the cleanup did, so a failed one never hides an overlap.
  const own = result.call === undefined ? [] : result.call.transcriptCallIds;
  const overlap = overlapAfter({ cleaned: fatal === undefined, fromMs, home, placed: [...placed, ...own] });
  const stop = legStop({ fatal, overlap: overlap?.message });
  if (stop?.release === true) {
    release();
  }
  return stop?.message;
}

/**
 * Why the leg stops after a scenario, from its two reasons, and whether its lock is freed. A cleanup that failed keeps
 * the lock on purpose (the plan's rule): a call not proven ended holds it until this process exits, when the lock's
 * dead-holder recovery frees it for the next leg, whose preflight then reads the leases afresh. An overlap alone frees
 * it. Both together are both said.
 *
 * @param fatal the scenario's own stop, a cleanup that failed
 * @param overlap the calls it did not place that were open while it ran, as one line
 * @returns the line the leg stops on and whether to free the lock, or `undefined` to run the next scenario
 */
export function legStop({
  fatal,
  overlap,
}: {
  fatal: string | undefined;
  overlap: string | undefined;
}): { readonly message: string; readonly release: boolean } | undefined {
  if (fatal !== undefined && overlap !== undefined) {
    return { message: `${fatal}; and ${overlap}`, release: false };
  }
  if (fatal !== undefined) {
    return { message: fatal, release: false };
  }
  if (overlap !== undefined) {
    return { message: overlap, release: true };
  }
  return undefined;
}

/**
 * The leg's whole plan: its scenarios, with every card the console draws placed among them when `--call-card all`
 * asked for the inventory — read on a test instance of its own, behind the same preflight as a call.
 *
 * @param options the leg's options
 * @param waitMs how long the preflight waits out a call it did not place
 * @returns the scenarios, or why the inventory could not be read
 */
export async function plannedSteps({
  options,
  waitMs,
}: {
  options: E2eCallLegPlanOptions;
  waitMs: number;
}): Promise<Result<readonly E2eCallStep[], E2eCallError | OnCallHoldError>> {
  if (options.inventorySurfaces.length === 0) {
    return ok(options.steps);
  }
  const refused = await preflight({ consoles: options.consoles, home: options.home, placed: [], waitMs });
  if (refused !== undefined) {
    return err(refused);
  }
  const read = await readCardInventory({
    app: options.app,
    checkout: options.checkout,
    context: options.context,
    home: options.home,
  });
  if (read.isErr()) {
    return err(read.error);
  }
  const { keys, refused: unasked } = read.value;
  const unaskedWords = unasked.length > 0 ? ` (not asked: ${unasked.join(", ")})` : "";
  options.note({ line: `INVENTORY  ${String(keys.length)} card(s): ${keys.join(", ")}${unaskedWords}` });
  const cards = cardReadSteps({ cardKeys: keys, surfaces: options.inventorySurfaces });
  return ok(placeCardSteps({ calls: options.steps, cards, order: CALL_STEP_IDS }));
}
