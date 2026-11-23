/**
 * "Come back to it": the Queue cards the owner put off step below every card they have not. A card at the top of the
 * Queue that the owner cannot look at right now is put off, not dismissed. One press records it
 * (`slopweaver queue defer`), and this overlay is the whole of what the record changes: a deferred card keeps its
 * tier, so the answered-or-not accounting (`queueCounts`, the badge) counts it exactly as before, and only the ORDER
 * moves — derived from the ledger on every read, never a rank somebody set. A section heading counts what is drawn
 * under it, so the card counts under the last section rather than its tier's.
 *
 * Pure, so the unit lane holds it without React.
 */
import { type CardDeferrals, isDeferralInstant } from "../components/live/readCardDeferrals";
import type { LiveState } from "../components/live/useLive";
import { clauseAfter } from "./clauseJoin";
import type { StoppingStamp } from "./queueStopping";
import type { StalenessFact } from "./stalenessLabel";
import { parksTheCard, type TriageVerdict } from "./triageWords";

/**
 * Stamp each row the owner deferred with when they did. A reading that has not arrived leaves every row as it is — the
 * cards stay in their own order, never hidden — and {@link deferralGap} says the order is not the owner's yet.
 *
 * @param rows every row the registers hold
 * @param deferrals the `queue deferred` reading
 * @returns the rows, each deferred one carrying `deferredIso`
 */
export function withDeferrals<T extends { readonly key: string; readonly deferredIso?: string }>({
  rows,
  deferrals,
}: {
  rows: readonly T[];
  deferrals: LiveState<CardDeferrals>;
}): readonly T[] {
  if (deferrals.phase !== "ready" || deferrals.value.deferrals.length === 0) {
    return rows;
  }
  // Only an instant stamps a row. This runs after the row's briefing chips were drawn (`./cardBriefingPages.ts`), so
  // any other string would be words the voice reads a briefing from with no chip drawn for it; the
  // reader already refuses such a reading, so this holds the same line for a state built any other way.
  const instants = deferrals.value.deferrals.filter((one) => isDeferralInstant({ iso: one.deferredIso }));
  const when = new Map(instants.map((one) => [one.cardKey, one.deferredIso]));
  return rows.map((row) => {
    const deferredIso = when.get(row.key);
    if (deferredIso === undefined) {
      return row;
    }
    return { ...row, deferredIso };
  });
}

/**
 * Split rows into the ones the owner has not deferred, in the order given, then the deferred ones, oldest deferral
 * first — the card put off longest is the first the owner meets on coming back to them. A card the owner's triage
 * ruling parked comes after every one that is merely deferred, whenever either was put off, so it is the first a full
 * voice list cuts. A card stopping the owner's work is never put below the rest, deferred or not
 * (`./queueStopping.ts`): it stays first every day it stands.
 *
 * @param rows rows already in the page's order
 * @returns the rows to draw first, and the deferred ones to draw after them
 */
export function deferredLast<
  T extends {
    readonly deferredIso?: string;
    readonly stopping?: StoppingStamp;
    readonly triage?: { readonly verdict: TriageVerdict };
  },
>({ rows }: { rows: readonly T[] }): { readonly now: readonly T[]; readonly deferred: readonly T[] } {
  const putOff = (row: T): boolean => row.deferredIso !== undefined && row.stopping === undefined;
  const now = rows.filter((row) => !putOff(row));
  // `toSorted` is stable, so two cards deferred in the same instant keep the page's own order.
  const deferred = rows
    .filter((row) => putOff(row))
    .toSorted(
      (left, right) =>
        Number(parksTheCard({ verdict: left.triage?.verdict })) -
          Number(parksTheCard({ verdict: right.triage?.verdict })) ||
        left.deferredIso!.localeCompare(right.deferredIso!),
    );
  return { deferred, now };
}

/**
 * The staleness mark's fact when the order is not wholly the owner's: the reading failed, or some ledger lines did not
 * read — a mark whose hover says why, never a sentence. Deliberately NOT one of the Queue's missing
 * registers — a deferral moves no count, so a failed read of it must never take the badge's number away — and silent
 * while the first read is in flight, when every card simply stands in its own place.
 *
 * @param deferrals the `queue deferred` reading
 * @returns the fact, or `undefined` when there is nothing to mark
 */
export function deferralGap({ deferrals }: { deferrals: LiveState<CardDeferrals> }): StalenessFact | undefined {
  if (deferrals.phase === "not-measured") {
    return {
      subject: "the cards you put off",
      why: clauseAfter({ clause: "every card stands in its own place", joint: ";", reason: deferrals.why }),
    };
  }
  if (deferrals.phase === "ready" && deferrals.value.unreadable > 0) {
    return {
      subject: `${String(deferrals.value.unreadable)} line(s) of the cards you put off`,
      why: "the ledger line did not parse; one may be back in its own place",
    };
  }
  return undefined;
}
