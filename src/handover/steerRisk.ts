/**
 * Whether a deliverable the owner EXPLICITLY STEERED is at risk — judged off the row's own register, the moment the
 * risk is knowable, never at the deadline.
 *
 * A steered deliverable at risk gets a floating note AND a voice cut-in the minute it is known. The failure this
 * closes is a seat parked on a clock behind a door rule the owner had already waived, which the owner found out
 * about shortly before the deadline by reading the supervisor chat
 * (`docs/doctrine-rationale/explicit-steer.md`). Every reason below is one that journal could carry, written as a
 * STATE rather than an elapsed time: the minute a clock-park lands on a steered row is the minute nobody is
 * working it, and no threshold has to be guessed to say so.
 *
 * ONE reason per row, the first in {@link SteerRiskReason}'s order, so one row is one note: a second reason
 * standing at once is in the note's details, never a second note on the owner's screen. Each reason carries an
 * `identity` built from durable facts (its kind and the instant it began), which is what the monitor keys on, so
 * a reason that changes re-cuts the note and one that stands does not.
 *
 * **Residue, stated.** A seat that is RUNNING but going slowly carries none of these states, so it reads on
 * track until it names its own uncertainty with `handover risk` or the instant the owner set passes. That is the half a
 * journal cannot see, and it is why the seat's own `handover risk` is the first reason, not an afterthought.
 *
 * Pure: an already-parsed doc, its journal and an instant in; a verdict out. No filesystem, no clock.
 */

import { runDisposition } from "./boardTypes.js";
import { type DerivedRowState, derivedRowState } from "./derivedRowState.js";
import type { HandoverDoc } from "./doc.js";
import type { RunEvent } from "./ledger.js";
import { OWNER_WAIT_KIND, ownerWaitOf } from "./ownerWait.js";
import { activeParkedCheckpoint } from "./parked.js";
import { registeredAskOf } from "./registeredAsk.js";
import { type SteerRuling, standingExplicitSteer } from "./ruling.js";

/** What a question's identity opens with while it is the owner's, on the Queue. */
const ASKED = "asked ";

/** What it opens with once answered or paused: the seat still stopped on it, no card for it. */
const UNASKED = "unasked ";

/**
 * Whether a reason stands on a question to the owner — the owner's on the Queue, or one answered or paused that the seat is still
 * stopped on — which the note keys on even behind the lead, so the question moving always re-cuts it.
 *
 * @param reason the reason to test
 * @returns whether its identity is a question's
 */
export function onQuestion({ reason }: { reason: SteerRiskReason }): boolean {
  return reason.identity.startsWith(ASKED) || reason.identity.startsWith(UNASKED);
}

/**
 * One reason a steered deliverable is at risk, in PRECEDENCE order. `sinceIso` is the instant the register first
 * carried it; `identity` is what a note keys on.
 */
export type SteerRiskReason =
  /** A session named the uncertainty with `handover risk` and nobody has cleared it since. */
  | { readonly kind: "named"; readonly identity: string; readonly sinceIso: string; readonly why: string }
  /**
   * The run stopped on a question to the owner that is the OWNER's — `ownerWaitOf` says so, the verdict the Queue
   * draws the ask card off — or the row is a registered ask with no run that the Queue lists, so it waits on the
   * owner's answer there.
   */
  | {
      readonly kind: "waiting-on-owner";
      readonly identity: string;
      readonly sinceIso: string;
      readonly question: string;
    }
  /** The seat closed on a clock, or on nothing, so nobody is working the deliverable until it is reseated. */
  | { readonly kind: "parked"; readonly identity: string; readonly sinceIso: string; readonly wakeAtIso?: string }
  /** A session gave the current cycle up. */
  | { readonly kind: "abandoned"; readonly identity: string; readonly sinceIso: string; readonly why: string }
  /** The seat died and was reaped, so nobody is working it. */
  | { readonly kind: "orphaned"; readonly identity: string; readonly sinceIso: string }
  /** The instant the owner named has passed and nothing shipped. */
  | { readonly kind: "overdue"; readonly identity: string; readonly sinceIso: string };

/** What the judge says about one row. */
export type SteerRiskVerdict =
  | { readonly kind: "unsteered" }
  /** Shipped, settled, finished, or withdrawn by hand — nothing left to be at risk. */
  | { readonly kind: "ended"; readonly steer: SteerRuling }
  | { readonly kind: "on-track"; readonly steer: SteerRuling }
  | {
      readonly kind: "at-risk";
      readonly steer: SteerRuling;
      readonly reason: SteerRiskReason;
      /** Every OTHER reason standing at once, in precedence order — what the note's details add. */
      readonly alsoStanding: readonly SteerRiskReason[];
    };

/**
 * Judge one row: is it explicitly steered, and if so, what in its register says the deliverable is at risk.
 *
 * A row that shipped, was settled, finished its run or was set terminal by hand has `ended`; a row abandoned or
 * reaped is at RISK, because a seat giving up or dying is exactly the news the owner wants first.
 *
 * @param doc the row as its front-matter declares it
 * @param events its journal's decoded events, in order
 * @param nowIso the instant to judge at — a replay passes its own frozen clock
 * @returns the verdict
 */
export function judgeSteerRisk({
  doc,
  events,
  nowIso,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  nowIso: string;
}): SteerRiskVerdict {
  const steer = standingExplicitSteer({ events });
  if (steer === undefined) {
    return { kind: "unsteered" };
  }
  const state = derivedRowState({ doc, events });
  const run = runDisposition({ events, unreadableLines: [] });
  const endedByHand = state.statusFrom === "authored" && (state.status === "cancelled" || state.status === "rejected");
  if (state.settlement !== undefined || state.status === "done" || run.kind === "finished" || endedByHand) {
    return { kind: "ended", steer };
  }
  const [reason, ...alsoStanding] = steerRiskReasons({ derived: state, doc, events, nowIso, run, steer });
  return reason === undefined ? { kind: "on-track", steer } : { alsoStanding, kind: "at-risk", reason, steer };
}

/**
 * Every reason the register carries, in precedence order.
 *
 * @returns the reasons, empty when the row reads on track
 */
function steerRiskReasons({
  derived,
  doc,
  events,
  nowIso,
  run,
  steer,
}: {
  derived: DerivedRowState;
  doc: HandoverDoc;
  events: readonly RunEvent[];
  nowIso: string;
  run: ReturnType<typeof runDisposition>;
  steer: SteerRuling;
}): readonly SteerRiskReason[] {
  const reasons: SteerRiskReason[] = [];
  // Only risks named SINCE the standing steer count: one named under a superseded steer, or before the owner steered at
  // all, is about a different instance of the work.
  const sinceSteer = events.slice(events.indexOf(steer));
  const named = sinceSteer.findLast((event) => event.kind === "steer-risk");
  if (named?.kind === "steer-risk" && named.standing === "at-risk") {
    reasons.push({ identity: `named ${named.atIso}`, kind: "named", sinceIso: named.atIso, why: named.why });
  }
  reasons.push(...questionReasons({ derived, doc, run }));
  const parked = activeParkedCheckpoint({ events });
  // A park on CI is a seat waiting on the checks it pushed — work in motion. A park with no wake is a park on the owner's
  // answer, which the question above already names, so it adds a reason only when no question stands.
  if (parked?.wake?.kind === "at") {
    const { atIso: wakeAtIso } = parked.wake;
    reasons.push({ identity: `parked ${parked.atIso}`, kind: "parked", sinceIso: parked.atIso, wakeAtIso });
  } else if (parked !== undefined && parked.wake === undefined && run.kind !== "waiting-on-owner") {
    reasons.push({ identity: `parked ${parked.atIso}`, kind: "parked", sinceIso: parked.atIso });
  }
  const ended = events.findLast((event) => event.kind === "abandoned" || event.kind === "orphaned");
  if (run.kind === "abandoned" && ended?.kind === "abandoned") {
    reasons.push({ identity: `abandoned ${ended.atIso}`, kind: "abandoned", sinceIso: ended.atIso, why: run.why });
  }
  if (run.kind === "orphaned" && ended?.kind === "orphaned") {
    reasons.push({ identity: `orphaned ${ended.atIso}`, kind: "orphaned", sinceIso: ended.atIso });
  }
  const { deliverByIso } = steer.explicitSteer;
  if (deliverByIso !== undefined && Date.parse(nowIso) >= Date.parse(deliverByIso)) {
    reasons.push({ identity: `overdue ${deliverByIso}`, kind: "overdue", sinceIso: deliverByIso });
  }
  return reasons;
}

/**
 * The reasons a question stands behind: the run's own, the owner's or paused, and a registered ask with no run.
 *
 * @returns the question reasons, empty when no question stands
 */
function questionReasons({
  derived,
  doc,
  run,
}: {
  derived: DerivedRowState;
  doc: HandoverDoc;
  run: ReturnType<typeof runDisposition>;
}): readonly SteerRiskReason[] {
  const reasons: SteerRiskReason[] = [];
  if (run.kind === "waiting-on-owner") {
    const { askedIso, question } = run;
    // The owner's only when the Queue says so: a question a later ruling of theirs already answered, or one on a paused
    // row, has no ask card, so the note would send them to a Queue with nothing on it. The seat is stopped all the same,
    // so it reads as a park. Each shape has its own identity, so answering or pausing re-cuts the note: a note's id is
    // cut from its key, so one still saying "waiting on you" over a question the owner answered departs and settles.
    if (ownerWaitOf({ derived, run }).kind === OWNER_WAIT_KIND) {
      reasons.push({ identity: `${ASKED}${askedIso}`, kind: "waiting-on-owner", question, sinceIso: askedIso });
    } else {
      reasons.push({ identity: `${UNASKED}${askedIso}`, kind: "parked", sinceIso: askedIso });
    }
  }
  // A registered ask with no run is the owner's on the Queue too (`./registeredAsk.ts`), read by the same function the
  // board places it with, so the note cannot say nothing waits on the owner over a card asking them. The board lists it
  // only with no `blockedBy` standing (`./boardDependencies.ts`), and telling a finished blocker from an open one takes
  // the whole board, so one declaring any blocker is not read as the owner's. Residue, stated: a steered registered ask
  // whose every blocker finished is on the owner's Queue while its note, raised only by another reason, says nothing
  // waits on them.
  if (doc.blockedBy.length > 0) {
    return reasons;
  }
  const registered = registeredAskOf({ derived, doc, run });
  if (registered !== undefined) {
    const { askedIso, question } = registered;
    reasons.push({ identity: `${ASKED}${askedIso}`, kind: "waiting-on-owner", question, sinceIso: askedIso });
  }
  return reasons;
}

/**
 * One reason as a sentence the owner reads — what is wrong, never how the register knows it.
 *
 * @param reason the reason to say
 * @returns the sentence
 */
export function steerRiskSentence({ reason }: { reason: SteerRiskReason }): string {
  switch (reason.kind) {
    case "named":
      return `the seat named a risk: ${reason.why}`;
    case "waiting-on-owner":
      return `it is stopped on a question to you: ${reason.question}`;
    case "parked":
      return reason.wakeAtIso === undefined
        ? "its seat closed and nobody is working it"
        : `its seat closed until ${reason.wakeAtIso}, so nobody is working it`;
    case "abandoned":
      return `the seat gave it up: ${reason.why}`;
    case "orphaned":
      return "its seat died, so nobody is working it";
    case "overdue":
      return `the time you set, ${reason.sinceIso}, has passed and it has not shipped`;
  }
}
