/**
 * The one rule about a card's AGE: every card says when the world it describes was last read, and a card
 * whose subject the owner's own ruling has already settled stops being a card.
 *
 * A card whose artifact looks a day old reads as stale, and the owner has been served stale cards in react-now
 * before, so the age is stated on the card rather than left to be inferred.
 *
 * MEASURED on a rendered briefing and on the twenty renders before it. Reproduce with the committed script:
 *
 * ```
 * yarn tsx scripts/briefingCardAge.ts --open-pages <open-pages.json> --briefings '<glob of rendered html>'
 * ```
 *
 * - Of the 28 cards on the version the owner read, **21 carried a datable premise and all 21 were over 12
 *   hours old**; 18 were over 24 hours; the oldest was 261.3 hours, a page the owner had deferred.
 * - Over the last twenty renders: 534 card-appearances, 420 datable, **418 of them over 12 hours**.
 * - The other 114 — every hand-written me-facing card, every time it appeared — **carried no age at all**,
 *   because `./openPageCards.ts`'s `cardFor` took a ranked page's `landedIso` and dropped it.
 *
 * ## What lands here, and the half that does NOT
 *
 * A card is re-graded every tick against the owner's turns and dropped when overtaken. Only the decidable
 * half of that is built, because **later in time is not the same as overtook.** `LockInRow` carries an
 * instant, an identity and an outcome — it is not an exhaustive stream of the owner's turns, and it holds no
 * semantic relation to a card it never names. A rule that invalidated every card older than the owner's last
 * utterance would drop cards still waiting to be answered.
 *
 * The evidence for the caution is on the page itself. A Slack post that settled one card reached no ledger
 * for fifteen hours, and three pages the owner ruled on within half an hour were all correctly re-aimed by
 * hand on the very next render. The work is being done every tick, by a sweep remembering to do it.
 *
 * So this module lands the halves that ARE decidable, and the module doc is where that boundary is stated
 * rather than discovered:
 *
 * - **Every card carries a premise instant**, and a missing, unparseable or future one is refused.
 * - **The page shows the age**, so a 23-hour card announces itself before a word of it is read.
 * - **A page the owner's own ruling has settled stops producing a card.** `./openArtifacts.ts` already derives
 *   that from the lock-in ledger by EXACT identity, and already lapses a ruling once the page moves — which is
 *   the narrow, keyed relation the blocked half lacks. A non-valid page stays in the ranked index, where the
 *   existing contract deliberately keeps it, and simply stops carrying a question.
 *
 * **There is no age CAP here on purpose.** Whether an old but un-overtaken card is dropped, re-graded or
 * merely stamped is the owner's call about their own attention. A cap would drop 21 of the 28 cards served in
 * the measurement above, including three answered inside eight minutes.
 *
 * Pure: instants in, refusals out. No clock of its own — the caller supplies `nowIso`.
 */
import type { BriefingArtifactValidity, BriefingCardPremise } from "../outbound/briefing/types.js";

/**
 * The instant a premise's age is measured from.
 *
 * `landedIso` for an artifact rather than `updatedIso`, because the age the owner reads off a page is how long
 * it has been in front of them — a republish does not make an eleven-day-old question new. `updatedIso` exists
 * for the lapse relation, not for the age.
 *
 * @param premise the card's premise
 * @returns the instant the card's age is measured from
 */
export function premiseInstant({ premise }: { premise: BriefingCardPremise }): string {
  if (premise.kind === "artifact") {
    return premise.landedIso;
  }
  if (premise.kind === "pull-request") {
    return premise.observedIso;
  }
  return premise.readIso;
}

/**
 * How old a card's premise is, in whole hours, at `nowIso`.
 *
 * @param premise the card's premise
 * @param nowIso the run's own instant
 * @returns whole hours, floored, and 0 for a premise read in the same hour
 */
export function premiseAgeHours({ premise, nowIso }: { premise: BriefingCardPremise; nowIso: string }): number {
  const then = Date.parse(premiseInstant({ premise }));
  const now = Date.parse(nowIso);
  return Math.floor((now - then) / 3_600_000);
}

/**
 * The age line a card renders above its question, in the words the owner reads it in.
 *
 * Hours up to two days and whole days past that, because "261 hours" is a number to convert and "10 days" is
 * one that is not. The exact instant sits beside it for the same reason every other stamp on this page does:
 * an age is only checkable against the instant it was computed from.
 *
 * @param premise the card's premise
 * @param nowIso the run's own instant
 * @returns the line, e.g. `premise 6 hours old`
 */
export function premiseAgeLine({ premise, nowIso }: { premise: BriefingCardPremise; nowIso: string }): string {
  const hours = premiseAgeHours({ nowIso, premise });
  if (hours < 1) {
    return "premise read this hour";
  }
  return `premise ${agePhrase({ hours })} old`;
}

/**
 * How long ago something happened, in the words the owner reads it in — the thresholds, shared.
 *
 * Hours up to two days and whole days past that, for {@link premiseAgeLine}'s own reason: "261 hours" is a
 * number to convert and "10 days" is one that is not. It is a function rather than two copies of the
 * same arithmetic because `./sectionQuality.ts` dates the ranked open-pages index with it, and a second
 * opinion about when hours become days would put two differently-worded ages on one page.
 *
 * @internal — the wording {@link premiseAgeLine} and {@link landedAgeLine} share.
 *
 * @param hours whole hours, as {@link premiseAgeHours} counts them
 * @returns the phrase, without a verb — `6 hours`, `10 days`
 */
function agePhrase({ hours }: { hours: number }): string {
  if (hours < 48) {
    return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
  }
  return `${String(Math.floor(hours / 24))} days`;
}

/**
 * The age the ranked open-pages index prints beside one page, in the words the owner reads it in.
 *
 * LANDING age rather than a premise read: nobody read the page's contents at that instant, it appeared then.
 * Same thresholds as a card's, through {@link agePhrase}, so the two ages on one page cannot word the same
 * elapsed time differently.
 *
 * **A landing LATER than the reference instant is named rather than rounded away.** It is an ordinary state
 * here and not the incoherence it would be on a card — the open-pages document is read when the page is
 * built, and the reference is when the world was read — but calling it "this hour" would state something
 * false about a page that landed days afterwards.
 *
 * @param landedIso when the page landed
 * @param nowIso the instant the ranked band was read, which is when the page was built
 * @returns the line, e.g. `landed 6 hours ago`
 */
export function landedAgeLine({ landedIso, nowIso }: { landedIso: string; nowIso: string }): string {
  const hours = Math.floor((Date.parse(nowIso) - Date.parse(landedIso)) / 3_600_000);
  if (hours < 0) {
    return "landed after this page read the world";
  }
  if (hours < 1) {
    return "landed this hour";
  }
  return `landed ${agePhrase({ hours })} ago`;
}

/**
 * Why a premise instant is not one a reader can act on.
 *
 * @param instant the instant a card declared
 * @param nowIso the run's own instant
 * @returns the refusal, or `undefined` when the instant is real and in the past
 */
export function unusablePremiseInstant({ instant, nowIso }: { instant: string; nowIso: string }): string | undefined {
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed)) {
    return `"${instant}" is not an instant a clock can parse, so the card's age cannot be computed.`;
  }
  if (parsed > Date.parse(nowIso)) {
    return `"${instant}" is in the future, so the card claims to have read a world that has not happened yet.`;
  }
  return undefined;
}

/**
 * Whether a ranked page still has a question left in it for the owner.
 *
 * `valid` alone. `partly-ruled` means a ruling of the owner's still holds over part of what the page asks, and
 * `superseded` means the owner pointed somewhere else — in both cases the question the card carries is one
 * already moved past, which is the defect this rule exists to stop. Both marks stay in the ranked index;
 * `skills/supervisor/reference/one-index.md` is deliberate that a page the owner has ruled on remains visible
 * there.
 *
 * @param validity the mark `./openArtifacts.ts` derived from the lock-in ledger
 * @returns true when the page may still be projected as a card
 */
export function stillAsks({ validity }: { validity: BriefingArtifactValidity }): boolean {
  return validity.mark === "valid";
}

/** The shape that replaces a card whose premise instant is missing or unusable.  *
 * @internal — the one sentence `./reactNowCard.ts`'s refusal ends in, shared so the wording cannot drift.
 */
export const PREMISE_ADVICE =
  "Every card says when the world it describes was last read, so the page can show its age and the next " +
  "tick can tell whether anything has moved since.";

/**
 * The gate's refusal for a card whose premise instant cannot be read.
 *
 * @param card the card's 1-based position within the react-now block
 * @param reason what {@link unusablePremiseInstant} found
 * @returns one line naming the card, the problem and what a premise is for
 */
export function premiseRefusal({ card, reason }: { card: number; reason: string }): string {
  return `card ${String(card)} carries no usable premise instant — ${reason} ${PREMISE_ADVICE}`;
}
