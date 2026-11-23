/**
 * What became of a steer the owner spoke over a Queue card — pure: the evidence about one relay in, one verdict out.
 *
 * A card the owner has just steered on collapses and leaves the list at once, so it feels like the AI has quickly
 * heard and is working on it. That is an optimistic update, and it costs trust if the card looks worked on when it
 * is not yet. The page collapses the card
 * the moment the relay is sent (`site/components/console/steered.tsx`); this is the authority that then says
 * whether the collapse was TRUE.
 *
 * ## Settled means positive evidence, never delivery
 *
 * A relay's line typed into the chair's chat is not the chair acting on it, so delivery is not read here at all.
 * What settles a steer is the same evidence `./relayIntake.ts` already clears a relay on — a settlement on its row,
 * a run event of work taken up since it registered, an intake mark on its `talk:<turnId>` pointer — plus the same
 * row evidence on the row its landing names when that is another (a steer on an ask is a ruling on THAT ask, so the
 * ask's own row is where a session takes it up), and, for a check-in, the word the relay itself wrote on the act
 * (`./checkInRuling.ts`, provenance `talk:<turnId>`).
 *
 * ## The deadline is the chair's next pass, and a pass that never comes
 *
 * MEASURED over 124 card-landed relays: the chair's intake mark, when there was one, came a
 * median 1.8 minutes after registration, and 31 of the 39 timed ones before the next tick; 59 had no evidence at
 * all, 18 to 72 hours later. Those 59 are the silent loss. So a steer still unacted once the first tick
 * that STARTED after it registered has finished comes back — a tick that started before it had already read its
 * intake. And a chair that runs no pass at all for {@link CHAIR_DOWN_MS} brings it back too, saying so, rather than
 * leaving the card collapsed on a promise nothing is keeping. Tick gaps over the same window: median 21 minutes,
 * p90 44 (`supervisor-ticks.jsonl` `finalisedIso`). A later action still settles a returned steer.
 */

import type { RelayRowAction } from "./relayIntake.js";

/** How long after registering a steer may wait with no chair pass at all before it comes back: two tick gaps. */
export const CHAIR_DOWN_MS = 45 * 60_000;

/**
 * How long a registered relay may stand with no landing on its card before that is read as the landing having
 * failed rather than not yet written — `talk relay` lands in the same run that registers, in milliseconds.
 */
export const LANDING_GRACE_MS = 2 * 60_000;

/** One piece of positive evidence that somebody acted on a steer. */
type SteerAction =
  | RelayRowAction
  | { readonly kind: "intake-mark"; readonly atIso: string; readonly markKind: string; readonly witness: string }
  | { readonly kind: "check-in-ruling"; readonly atIso: string };

/** Where the relay's own landing on its card stands in the card-landing ledger. */
export type SteerLanding =
  /** `workSlug`: the row the landing says acts on the owner's words — the relay's own, or the ask those words are a ruling on. */
  | { readonly kind: "active"; readonly workSlug: string }
  | { readonly kind: "lifted"; readonly why: string; readonly kept: boolean }
  | { readonly kind: "never" };

/** Everything known about one registered relay that named a card. */
export interface SteerEvidence {
  readonly registeredAtIso: string;
  readonly landing: SteerLanding;
  /** The first action evidence, or `undefined` when there is none, or why a source of it could not be read. */
  readonly action: SteerAction | undefined | { readonly kind: "unread"; readonly why: string };
  /** The first chair tick that started at or after registration and has finished, when one has. */
  readonly chairPass: { readonly startedIso: string; readonly finalisedIso: string } | undefined;
  /** Whether the tick ledger was read; a deadline judged on an unread ledger would invent a pass. */
  readonly ticksRead: boolean;
}

/** Why a steer the page collapsed is back on the Queue. */
type SteerRevertReason = "kept" | "restored" | "landing-missing" | "missed-pass" | "chair-down";

/** What became of one steer. */
export type SteerVerdict =
  /** Recorded, landed, and nothing has acted on it yet, inside the deadline. */
  | { readonly kind: "awaiting" }
  | { readonly kind: "settled"; readonly action: SteerAction }
  | {
      readonly kind: "reverted";
      readonly reason: SteerRevertReason;
      /** The restore's own reason, for `kept` and `restored`. */
      readonly why?: string;
      /** The pass that came and went, for `missed-pass`. */
      readonly passFinalisedIso?: string;
    }
  /** A source this verdict needs could not be read, so no verdict is claimed. */
  | { readonly kind: "unread"; readonly why: string };

/**
 * Judge one steer, in the order the evidence outranks itself: a restore puts the card back whatever else happened
 * (a `kept` settle is the chair answering AND leaving the card up), then action settles it, then a landing that
 * never happened, then the pass that came and went, then the pass that never came.
 *
 * @param evidence what the ledgers hold about the relay
 * @param nowIso the instant judged at
 * @returns the verdict
 */
export function steerVerdict({ evidence, nowIso }: { evidence: SteerEvidence; nowIso: string }): SteerVerdict {
  const { landing, action, chairPass } = evidence;
  const waitedMs = Date.parse(nowIso) - Date.parse(evidence.registeredAtIso);
  // An instant that does not parse would compare false against every deadline and wait forever, and the
  // relay line carrying it is malformed, so it is unread before any verdict — the site reads it the same way.
  if (Number.isNaN(waitedMs)) {
    return { kind: "unread", why: `its registration time ${evidence.registeredAtIso} does not parse` };
  }
  if (landing.kind === "lifted") {
    return { kind: "reverted", reason: landing.kept ? "kept" : "restored", why: landing.why };
  }
  if (action?.kind === "unread") {
    return { kind: "unread", why: action.why };
  }
  if (action !== undefined) {
    return { action, kind: "settled" };
  }
  if (landing.kind === "never" && waitedMs >= LANDING_GRACE_MS) {
    return { kind: "reverted", reason: "landing-missing" };
  }
  if (!evidence.ticksRead) {
    return { kind: "unread", why: "the chair's tick ledger did not read, so whether a pass has run is unknown" };
  }
  if (chairPass !== undefined) {
    return { kind: "reverted", passFinalisedIso: chairPass.finalisedIso, reason: "missed-pass" };
  }
  if (waitedMs >= CHAIR_DOWN_MS) {
    return { kind: "reverted", reason: "chair-down" };
  }
  return { kind: "awaiting" };
}

/**
 * The first chair pass that could have read a relay: the earliest tick that STARTED at or after it registered.
 *
 * @param ticks the ticks read, in any order
 * @param registeredAtIso when the relay registered
 * @returns that tick's start and finish, or `undefined` when none has finished since
 */
export function firstPassAfter({
  ticks,
  registeredAtIso,
}: {
  ticks: readonly { readonly startedIso: string; readonly finalisedIso: string }[];
  registeredAtIso: string;
}): { readonly startedIso: string; readonly finalisedIso: string } | undefined {
  const floor = Date.parse(registeredAtIso);
  const eligible = ticks.filter((tick) => Date.parse(tick.startedIso) >= floor);
  if (eligible.length === 0) {
    return undefined;
  }
  return eligible.reduce((first, tick) => (Date.parse(tick.startedIso) < Date.parse(first.startedIso) ? tick : first));
}
