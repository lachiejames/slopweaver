/**
 * The once-per-turn delivery of a registered relay toward the pinned supervisor's chat — the effect `./relayRun.ts`
 * ends on, apart so the verb's own file stays the order of its steps: a spoken console relay is held for the chair's
 * quiet batch (`./courierRun.ts` types it), any other is typed here through {@link typeTurnOnce}.
 */
import { realReachWaits } from "../../../cmux/reach.js";
import { logger } from "../../../lib/logger.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { relayAnswerAtDelivery } from "../../../talk/answerContextRead.js";
import type { Delivery, DeliveryVia } from "../../../talk/deliveryOutcome.js";
import { holdForChair } from "../../../talk/relayCourierHandoff.js";
import { claimDelivery } from "../../../talk/relayDeliveryClaim.js";
import { markDelivered, markDeliveryLead, type TurnRecord } from "../../../talk/relayStore.js";
import { callContextAtDelivery } from "../../../talk/steerCallContextRead.js";
import { deliverRelayToSupervisor, type SupervisorDeliveryHost } from "../../../talk/supervisorDelivery.js";
import type { ConsoleOriginArgs } from "./consoleOriginArgs.js";

/**
 * Deliver a registered relay toward the supervisor's chat. A relay of what they said on a console call is held for the
 * chair's next quiet batch (`../../../talk/relayCourierHandoff.ts`), which names it two minutes after their last word,
 * beside anything they said after it; any other — a session's `--typed` relay of what they typed to it, or a hand run — is
 * typed at once, at most once per turn, as it always was.
 *
 * Only a relay a console spawned, one that passed its console-origin gate (`./consoleOrigin.ts`), is held. A hand run
 * cmux refuses is refused as it always was, its delivery `failed (cmux-access-denied)`. The residue, stated: a
 * same-user process can pass the console flags itself, as it can already write their files directly — this closes the
 * accident, never the forgery.
 *
 * @param args whether this relay is typed into the chair at all, and the console that spawned it, if one did
 * @param home the state home the turn store lives under
 * @param lead what the relay read out of their words for a held draft or the card on screen, opening the line
 * @param record the registered turn
 * @returns the turn as it now stands, its delivery recorded
 */
export async function deliverOnce({
  args,
  home,
  lead,
  record,
}: {
  args: { deliverToSupervisor: boolean; consoleOrigin: ConsoleOriginArgs | undefined };
  home: string;
  lead: string | undefined;
  record: TurnRecord;
}): Promise<TurnRecord> {
  if (!args.deliverToSupervisor) {
    return record;
  }
  const spokenOnConsole = args.consoleOrigin !== undefined && !record.typed;
  if (spokenOnConsole) {
    // A retry finds it `held` and only makes sure its request is queued.
    return holdOnce({ home, record });
  }
  if (record.delivery !== null) {
    return record;
  }
  const current = withStoredLead({ home, lead, record });
  return typeTurnOnce({ deliver: overFreshClient({ via: "direct" }), home, record: current, via: "direct" });
}

/**
 * Hold a spoken console relay for the chair's batch, saying when its request could not be queued. No lead is stored:
 * the batch names the relay by its slug, never by a line of its own.
 */
function holdOnce({ home, record }: { home: string; record: TurnRecord }): TurnRecord {
  const held = holdForChair({ home, nowIso: new Date().toISOString(), record });
  if (held.unqueued !== undefined) {
    logger.error({
      msg: `talk relay: held for the chair's batch, but its request was not queued — ${held.unqueued}; a retry queues it, and handover intake names it once its batch is overdue`,
    });
  }
  return held.record;
}

/**
 * The delivery seam over a cmux connection opened for one line and closed after it — a connection that throws
 * becomes a `cmux-unreachable` delivery, never a throw.
 *
 * @param via which process is typing, named on the delivery a thrown connection becomes
 * @returns the seam {@link typeTurnOnce} types through
 */
function overFreshClient({
  via,
}: {
  via: DeliveryVia;
}): (options: { type: (options: { client: SupervisorDeliveryHost }) => Promise<Delivery> }) => Promise<Delivery> {
  return async ({ type }) => {
    try {
      return await withCmuxSessionHost({ body: ({ host }) => type({ client: host }) });
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      return unreachable({ via, why });
    }
  };
}

/**
 * The turn carrying its line's lead, stored so a courier rebuilds the same line. A store write that fails is logged
 * and the lead still rides in memory, so a relay typing it itself loses nothing; only a courier would.
 */
function withStoredLead({
  home,
  lead,
  record,
}: {
  home: string;
  lead: string | undefined;
  record: TurnRecord;
}): TurnRecord {
  const led = markDeliveryLead({ deliveryLead: lead, home, record });
  if (led.isOk()) {
    return led.value;
  }
  logger.error({ msg: `talk relay: the line's lead was not stored for the courier — ${led.error.message}` });
  if (lead === undefined) {
    return record;
  }
  return { ...record, deliveryLead: lead };
}

/** A delivery for a cmux connection that threw before anything was typed. */
function unreachable({ via, why }: { via: DeliveryVia; why: string }): Delivery {
  return {
    atIso: new Date().toISOString(),
    detail: `cmux could not be reached: ${why}`,
    kind: "failed",
    refusal: "cmux-unreachable",
    via,
  };
}

/**
 * Claim a turn's one delivery, record `attempting`, type its line, and record the outcome — the sequence the relay
 * and the chair's courier both run. Any delivery already on the record, or a claim another run holds, types nothing:
 * `attempting` may be a paste that landed before a crash, and a second copy of their words in the chair's chat is worse
 * than a missing one, because the row already carries every word. A store write that fails is logged, never fatal.
 *
 * @param deliver runs `type` over a connected cmux client, and turns a connection that throws into a delivery
 * @param home the state home the turn store lives under
 * @param record the registered turn, its lead already stored
 * @param via which process is typing it
 * @returns the turn as it now stands
 */
export async function typeTurnOnce({
  deliver,
  home,
  record,
  via,
}: {
  deliver: (options: { type: (options: { client: SupervisorDeliveryHost }) => Promise<Delivery> }) => Promise<Delivery>;
  home: string;
  record: TurnRecord;
  via: DeliveryVia;
}): Promise<TurnRecord> {
  if (record.delivery !== null) {
    return record;
  }
  const claimed = claimDelivery({ home, turnId: record.turnId });
  if (claimed.isErr() || !claimed.value) {
    const why = claimed.isErr() ? claimed.error.message : "another run of this turn is already typing it";
    logger.error({ msg: `talk relay: not typed into the supervisor — ${why}` });
    return record;
  }
  const nowIso = (): string => new Date().toISOString();
  const attempting: Delivery = {
    atIso: nowIso(),
    detail: "typing into the supervisor's chat",
    kind: "attempting",
    via,
  };
  const staged = markDelivered({ delivery: attempting, home, record });
  if (staged.isErr()) {
    logger.error({ msg: `talk relay: not typed into the supervisor — ${staged.error.message}` });
    return record;
  }
  const delivery = await deliver({
    type: ({ client }) =>
      deliverRelayToSupervisor({
        client,
        nowIso,
        turn: {
          ...record,
          answer: relayAnswerAtDelivery({ home, record }),
          callContext: callContextAtDelivery({ home, nowIso: nowIso(), typed: record.typed }),
          lead: record.deliveryLead,
        },
        via,
        waits: realReachWaits(),
      }),
  });
  const written = markDelivered({ delivery, home, record: staged.value });
  if (written.isErr()) {
    logger.error({ msg: `talk relay: ${delivery.detail}, but recording it failed — ${written.error.message}` });
    return { ...staged.value, delivery };
  }
  return written.value;
}
