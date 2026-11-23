/**
 * The relay's half of the quiet batch: a relay the voice registered from the owner's console call is HELD for the chair's next
 * quiet batch (`./chairWake.ts`) rather than typed at once, so a correction the owner speaks a minute later reaches
 * the chair on the same line. The chair needs an interval of at least a couple of minutes before it acts.
 *
 * Holding is two writes, in this order: `held` on the turn, then the request in the courier's queue
 * (`./relayCourierStore.ts`). The turn is written first and never again by the relay, so a crash between leaves a
 * `held` turn with no request — repaired by the voice's retry, which finds it `held` and only re-enqueues (enqueue is
 * idempotent), and otherwise named by `handover intake` once its batch is overdue (`./relayIntake.ts`). The other
 * order would leave a request whose turn carries no delivery yet, which a batch would carry while the relay was still
 * about to write over it.
 */
import type { Delivery } from "./deliveryOutcome.js";
import { enqueueCourier } from "./relayCourierStore.js";
import { markDelivered, type TurnRecord } from "./relayStore.js";

/** The one sentence a held turn's delivery carries. */
export const HELD_DETAIL = "held for the chair's next quiet batch, typed two minutes after the owner's last word";

/**
 * Hold a registered relay for the chair's next quiet batch: mark it `held` (unless it already is, whose instant
 * stands) and queue its request.
 *
 * @param home the state home
 * @param record the registered turn, carrying no delivery or already `held`
 * @param nowIso when it is held — the instant the batch counts as the owner's last word
 * @param enqueue how the request is queued; a test passes one that fails
 * @returns the turn as it now stands, and why its request could not be queued when it could not
 */
export function holdForChair({
  enqueue = enqueueCourier,
  home,
  record,
  nowIso,
}: {
  enqueue?: typeof enqueueCourier;
  home: string;
  record: TurnRecord;
  nowIso: string;
}): { readonly record: TurnRecord; readonly unqueued: string | undefined } {
  if (record.delivery !== null && record.delivery.kind !== "held") {
    // Already on its way or settled: holding it again would put a delivered relay on a second line.
    return { record, unqueued: undefined };
  }
  let current = record;
  if (record.delivery === null) {
    const held: Delivery = { atIso: nowIso, detail: HELD_DETAIL, kind: "held", via: "courier" };
    const written = markDelivered({ delivery: held, home, record });
    if (written.isErr()) {
      return { record, unqueued: `the turn could not be marked held: ${written.error.message}` };
    }
    current = written.value;
  }
  const queued = enqueue({ home, nowIso, turnId: record.turnId });
  if (queued.isErr()) {
    return { record: current, unqueued: queued.error.message };
  }
  return { record: current, unqueued: undefined };
}
