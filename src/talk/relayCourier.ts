/**
 * The store moves behind the chair's quiet batch (`./chairWake.ts`, `./chairWakeShell.ts`): read the relays the voice
 * holds for the chair's next batch, and once a batch line has reached the chat, record that on every relay it named and
 * take its request out of the queue — plus the recovery of what a courier from before the batch left in `claimed/`.
 *
 * ## Held until a batch reaches the chat, never claimed
 *
 * A relay's own line carries the owner's words, so it is typed at most once: a turn's `.delivery` claim is taken before
 * the paste (`./relayDeliveryClaim.ts`), and a doubled line would read as the owner saying it twice. A batch line
 * carries none of the owner's words, only each relay's board slug (`./chairBatchLine.ts`), so the trade turns over: a
 * batch typed twice costs the chair one more `talk log` read of a row it already has, while a relay dropped because
 * one paste was refused — the owner's unsent words in the box, a console cmux will not serve — is one the owner said
 * and the chair never heard of. So a held
 * relay stays held, its request pending, until a line naming it reaches the chat (`typed`, `queued`, `unconfirmed` or
 * `stranded`); a line refused before anything was pasted leaves it for the next batch. Two typists never carry one relay
 * at once: the shell decides under the chair-wake lock, and a wake in flight names the relays it carries.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { HeldRelay } from "./chairWake.js";
import type { Delivery } from "./deliveryOutcome.js";
import {
  courierTurns,
  finishCourier,
  pendingRequest,
  type RelayCourierError,
  RelayCourierErrors,
  requeueCourier,
  withdrawCourier,
} from "./relayCourierStore.js";
import { deliveryClaimed } from "./relayDeliveryClaim.js";
import { heardEdges } from "./relayHeardCut.js";
import { markDelivered, readTurn, type TurnRecord } from "./relayStore.js";

/** What became of one request: carried on a batch line that reached the chat, or dropped and why. */
export interface CourierOutcome {
  readonly turnId: string;
  /** `typed` rode a batch line that reached the chat; `skipped` was no held relay, and was taken out of the queue. */
  readonly kind: "typed" | "skipped";
  /** The batch's delivery sentence, or why the request was dropped. */
  readonly detail: string;
}

/** What recovery did with one request a stopped courier left claimed. */
export interface CourierRecovery {
  readonly turnId: string;
  /** `requeued` had no delivery claim, so nothing was typed; `left` had one, and is never typed again. */
  readonly kind: "requeued" | "left";
}

/** The relays a batch may carry now, and the requests read and dropped because they were no held relay. */
export interface HeldRelays {
  readonly held: readonly HeldRelay[];
  readonly dropped: readonly CourierOutcome[];
}

/** The outcomes that put a batch line in the chat, or may have: each relay it named is no longer held. */
const REACHED: ReadonlySet<Delivery["kind"]> = new Set<Delivery["kind"]>([
  "typed",
  "queued",
  "unconfirmed",
  "stranded",
]);

/**
 * Why a turn a request names is not a held relay, or `undefined` when it is: registered on the board, and held for a
 * batch or — a request queued before the batch existed — carrying no delivery yet.
 */
function notHeld({ record }: { record: TurnRecord }): string | undefined {
  if (record.state !== "registered") {
    return `the turn is ${record.state}, not registered on the board`;
  }
  if (record.delivery !== null && record.delivery.kind !== "held") {
    return `the turn already carries a delivery (${record.delivery.kind})`;
  }
  // The turn record's parser takes any string as a delivery's instant, so this is where a held relay's is checked: a
  // batch orders and dates by it, and an instant that does not parse would throw there.
  const heldAt = heldAtOf({ record });
  if (Number.isNaN(Date.parse(heldAt))) {
    return `the turn's held instant "${heldAt}" is not an instant`;
  }
  return undefined;
}

/**
 * When a held turn was held: its `held` delivery's instant, else — a request from before the batch — when it was
 * registered or staged.
 */
function heldAtOf({ record }: { record: TurnRecord }): string {
  if (record.delivery !== null) {
    return record.delivery.atIso;
  }
  if (record.registeredAtIso !== null) {
    return record.registeredAtIso;
  }
  return record.stagedAtIso;
}

/**
 * The held turn one pending request names, or why it is none: its request must parse as a request for that turn — a
 * malformed one is dropped and said, never carried and later deleted unread — and its turn must be held.
 */
function heldTurn({
  home,
  turnId,
}: {
  home: string;
  turnId: string;
}): { readonly record: TurnRecord; readonly why?: never } | { readonly record?: never; readonly why: string } {
  const request = pendingRequest({ home, turnId });
  if (request.isErr()) {
    return { why: `the courier request could not be read: ${request.error.message}` };
  }
  const turn = readTurn({ home, turnId });
  if (turn.isErr()) {
    return { why: `the turn could not be read: ${turn.error.message}` };
  }
  const why = notHeld({ record: turn.value });
  if (why !== undefined) {
    return { why };
  }
  return { record: turn.value };
}

/**
 * Every relay held for the chair, oldest first, and every request that is malformed or whose turn cannot be read or is
 * no held relay. A
 * read: nothing is removed here — a caller that has decided and can say what was dropped takes those out with
 * {@link pruneDropped}, so they are not read again every pass.
 *
 * @param home the state home
 * @returns the held relays and what was dropped, or the store failure that stopped the read
 */
export function heldRelays({ home }: { home: string }): Result<HeldRelays, RelayCourierError> {
  const pending = courierTurns({ home, stage: "pending" });
  if (pending.isErr()) {
    return err(pending.error);
  }
  const held: HeldRelay[] = [];
  const dropped: CourierOutcome[] = [];
  for (const turnId of pending.value) {
    const read = heldTurn({ home, turnId });
    if (read.record !== undefined) {
      held.push({
        heard: read.record.heard,
        heardEdges: heardEdges({ turn: read.record }),
        heldAtIso: heldAtOf({ record: read.record }),
        slug: read.record.slug,
        turnId,
      });
      continue;
    }
    dropped.push({ detail: read.why, kind: "skipped", turnId });
  }
  return ok({
    dropped,
    held: held.toSorted((a, b) => Date.parse(a.heldAtIso) - Date.parse(b.heldAtIso)),
  });
}

/**
 * Take every request {@link heldRelays} read as no held relay out of the queue — once the caller has decided and can
 * report them, so a failure after the read never removes a request whose drop nobody was told.
 *
 * @param home the state home
 * @param dropped what the read dropped
 * @returns nothing, or the store failure that left the rest queued, to be read again
 */
export function pruneDropped({
  home,
  dropped,
}: {
  home: string;
  dropped: readonly CourierOutcome[];
}): Result<void, RelayCourierError> {
  for (const { turnId } of dropped) {
    const removed = withdrawCourier({ home, turnId });
    if (removed.isErr()) {
      return err(removed.error);
    }
  }
  return ok(undefined);
}

/**
 * Record a batch line's outcome on one relay it named, and take its request out of the queue — only when the line
 * reached the chat. A line refused before anything was pasted changes nothing, so the relay rides the next batch.
 *
 * @param home the state home
 * @param turnId the held relay the line named
 * @param delivery what became of the batch line
 * @param batchAtIso when the batch was decided — the wake record's own instant, named in the relay's detail so `talk
 *   log` ties every relay to the one line that carried it
 * @returns what became of the relay, `undefined` while it stays held, or the store failure that left it standing
 */
export function settleHeldRelay({
  home,
  turnId,
  delivery,
  batchAtIso,
}: {
  home: string;
  turnId: string;
  delivery: Delivery;
  batchAtIso: string;
}): Result<CourierOutcome | undefined, RelayCourierError> {
  if (!REACHED.has(delivery.kind)) {
    return ok(undefined);
  }
  const turn = readTurn({ home, turnId });
  if (turn.isErr()) {
    return err(RelayCourierErrors.turnUnwritable({ turnId, why: turn.error.message }));
  }
  if (turn.value.delivery?.kind !== "held") {
    // Another batch already carried it: its delivery stands, and only the request this one named is cleared.
    return withdrawCourier({ home, turnId }).map((): CourierOutcome => ({
      detail: `already delivered, ${String(turn.value.delivery?.kind)} — the quiet batch of ${batchAtIso} left it as it stood`,
      kind: "skipped",
      turnId,
    }));
  }
  const carried: Delivery = { ...delivery, detail: `on the quiet batch of ${batchAtIso}: ${delivery.detail}` };
  // Written before the request goes: a crash between leaves a request whose turn is no longer held, which the next
  // read drops — never a held turn with no request, which nothing would carry.
  const written = markDelivered({ delivery: carried, home, record: turn.value });
  if (written.isErr()) {
    return err(RelayCourierErrors.turnUnwritable({ turnId, why: written.error.message }));
  }
  return withdrawCourier({ home, turnId }).map((): CourierOutcome => ({
    detail: `${carried.kind} — ${carried.detail}`,
    kind: "typed",
    turnId,
  }));
}

/**
 * Put back what a stopped courier took but never claimed, and drop what it claimed: a claim may be a line already
 * pasted, so that turn is left for the board and `handover reconcile`, never typed a second time. Only a courier from
 * before the quiet batch took requests; a batch leaves them pending.
 *
 * @param home the state home
 * @returns one recovery per request found claimed
 */
export function recoverCourier({ home }: { home: string }): Result<CourierRecovery[], RelayCourierError> {
  const claimed = courierTurns({ home, stage: "claimed" });
  if (claimed.isErr()) {
    return err(claimed.error);
  }
  const recoveries: CourierRecovery[] = [];
  for (const turnId of claimed.value) {
    const recovered = recoverOne({ home, turnId });
    if (recovered.isErr()) {
      return err(recovered.error);
    }
    recoveries.push(recovered.value);
  }
  return ok(recoveries);
}

/** Recovery for one claimed request. An unreadable claim is treated as taken: at most once. */
function recoverOne({ home, turnId }: { home: string; turnId: string }): Result<CourierRecovery, RelayCourierError> {
  const claim = deliveryClaimed({ home, turnId });
  if (claim.isOk() && !claim.value) {
    return requeueCourier({ home, turnId }).map((): CourierRecovery => ({ kind: "requeued", turnId }));
  }
  return finishCourier({ home, turnId }).map((): CourierRecovery => ({ kind: "left", turnId }));
}
