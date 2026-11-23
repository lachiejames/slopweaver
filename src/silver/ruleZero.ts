/**
 * Rule zero — **an item that is somebody else's move is not on the list.**
 *
 * The owner's ruling, on a ranked list whose top item told them to approve and
 * merge five pull requests that were already sitting with named reviewers. Two things were wrong with that
 * at once: the work had already been sent, and merging it was not the owner's job even when it had not been. The
 * same mistake, repeated across the set, is what made a list of about eight real things read as fifty.
 *
 * The rule has three parts, and the second and third are what stop it becoming "hide everything":
 *
 *  1. An item waiting on somebody else is **off the list**.
 *  2. It comes back after a **silence threshold** — {@link DEFAULT_THRESHOLD_HOURS}, the owner's to change, and
 *     one number in one file rather than a rewrite.
 *  3. When it comes back the action is to **chase that person**, never to do their half. "Bump the
 *     reviewer" or "add a second reviewer". Never "approve and merge".
 *
 * Measured effect on the owner's real data: of 31 open pull requests, 23 were waiting on
 * somebody else and exactly one was past 48 hours. That single rule turned "26 blocked on review" — half
 * the first list — into one row.
 *
 * **Nobody's move is a fourth case, and conflating it with the owner's was a separate reported defect.** The owner
 * re-queued a pull request themselves and the list read it as having no reviewer, so it told them to find one.
 * An item with nobody on it is only the owner's move when they have not already acted; once they have, the next move
 * belongs to whatever the owner handed it to. {@link WhoseMove} carries that distinction rather than inferring it
 * from an empty reviewer field.
 *
 * Pure — no I/O, no clock. The caller supplies `nowIso`, so a run over a frozen fixture judges time the way
 * the fixture's own manifest says to rather than by the wall clock.
 */

import { absentAsNumber } from "#lib/absent.js";

/**
 * Whose move an item is waiting on.
 *
 * `other` carries `who` because the chase action has to name a person, and a card that says "chase
 * somebody" is the kind of undefined phrasing the owner rejected outright.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export type WhoseMove =
  | { readonly party: "owner" }
  | { readonly party: "other"; readonly who: string }
  | { readonly party: "nobody"; readonly ownerAlreadyActed: boolean };

/**
 * What rule zero decides about one item.
 *
 * `chase` is deliberately not a flavour of `show`. The two put different words on the card — one says do
 * the work, the other says push the person sitting on it — and collapsing them is exactly the error that
 * produced "approve and merge" for work already out for review.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export type ListVerdict = "show" | "suppress" | "chase";

/**
 * A rule-zero decision, with the reason a card shows and the silence it measured.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export interface RuleZeroDecision {
  readonly verdict: ListVerdict;
  /** One clause, shown to the owner, because a rank they cannot argue with is a rank they cannot correct. */
  readonly reason: string;
  /** Whole hours since the item last moved. Reported on every verdict so a card can say how long. */
  readonly silentHours: number;
  /** Who to chase. Present ONLY on `chase`, where naming the person is the action. */
  readonly chase?: string;
}

/**
 * The silence an item waiting on somebody else must accumulate before it returns to the list.
 *
 * 48 hours because the owner declined to move it when asked, having been offered 24. At 24 exactly one
 * more row came back on the data in front of the owner. It is one number in one file on purpose: changing
 * the owner's mind about it should cost an edit, not a redesign.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const DEFAULT_THRESHOLD_HOURS = 48;

/**
 * Whole hours between two instants, floored, and never negative.
 *
 * An item whose last movement is in the FUTURE relative to `nowIso` reports zero rather than a negative
 * age. That happens for real — a provider clock running ahead, or a frozen fixture replayed at an earlier
 * `--now` than one of its own events — and a negative age would sail under every threshold silently.
 *
 * @param fromIso the earlier instant, normally the item's last movement
 * @param toIso the later instant, normally the run's own `now`
 * @returns whole hours between them, or `undefined` when either instant is unparseable
 */
export function hoursBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return undefined;
  }
  return Math.max(0, Math.floor((to - from) / 3_600_000));
}

/**
 * Apply rule zero to one item.
 *
 * An unparseable `lastMovedIso` is NOT treated as infinitely old. The silence threshold is the only thing
 * that can put somebody else's item back in front of the owner, so a timestamp nobody can read must not be able
 * to trip it — that would chase a colleague on the strength of a parse failure. Such an item suppresses,
 * and says so.
 *
 * @param move whose move the item is waiting on
 * @param lastMovedIso when the item last moved, by the source's own clock
 * @param nowIso the run's own instant, supplied rather than read, so a frozen fixture judges its own time
 * @param thresholdHours how long somebody else's item must sit silent before it returns as a chase
 * @returns the verdict, the reason a card shows, the silence measured, and who to chase
 */
export function applyRuleZero({
  move,
  lastMovedIso,
  nowIso,
  thresholdHours = DEFAULT_THRESHOLD_HOURS,
}: {
  move: WhoseMove;
  lastMovedIso: string;
  nowIso: string;
  thresholdHours?: number;
}): RuleZeroDecision {
  const measured = hoursBetween({ fromIso: lastMovedIso, toIso: nowIso });
  const silentHours = absentAsNumber({ value: measured, whenAbsent: 0 });

  if (move.party === "owner") {
    return { reason: "waiting on you", silentHours, verdict: "show" };
  }

  if (move.party === "nobody") {
    if (move.ownerAlreadyActed) {
      return { reason: "you have already acted; nobody else has been asked yet", silentHours, verdict: "suppress" };
    }
    return { reason: "nobody has been asked yet", silentHours, verdict: "show" };
  }

  if (measured === undefined) {
    return {
      reason: `sitting with ${move.who}, and its last movement has no readable date`,
      silentHours,
      verdict: "suppress",
    };
  }
  if (silentHours < thresholdHours) {
    return { reason: `sitting with ${move.who} for ${String(silentHours)}h`, silentHours, verdict: "suppress" };
  }
  return {
    chase: move.who,
    reason: `${move.who} has had this for ${String(silentHours)}h with no movement`,
    silentHours,
    verdict: "chase",
  };
}

/**
 * Whether a decision puts the item in front of the owner at all — the one question a ranker asks before it
 * bothers scoring anything, given a name so no caller re-derives it and forgets `chase`.
 *
 * @param decision the rule-zero decision to test
 * @returns true for `show` and `chase`, false for `suppress`
 */
export function isOnTheList({ decision }: { decision: RuleZeroDecision }): boolean {
  return decision.verdict !== "suppress";
}
