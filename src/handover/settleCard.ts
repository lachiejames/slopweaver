/**
 * What `handover settle` does about the hand card a talk relay's row was spoken over — pure.
 *
 * Answering is not always finishing ('explain this' is not 'done'), so the card does not just vanish: whoever
 * settles the owner's answer also says what happens to the card, done, re-cut, or kept with the reason. So a row whose relay names an OPEN `hand:<id>` needs `--card done` or
 * `--card kept --card-why`, a card a re-cut superseded needs `--card recut --card-new <that posting>`, and every
 * other row — no relay, no card, a card of another kind, a hand card closed any other way — settles exactly as it
 * did, with a `--card` there refused as a caller mistake rather than quietly ignored.
 *
 * Only `hand:` cards: the hand register is the one with an open / settled / re-cut lifecycle this can perform. An
 * ask's own ruling already moves it, and the other kinds have no settling of their own to write.
 */
import type { HandCardFate } from "../hand/cardFate.js";
import { err, ok, type Result } from "../lib/result.js";
import { cardKeyParts } from "../talk/cardLanding.js";

import { ASK_SETTLEMENTS } from "./rowKind.js";
import { type SettleCardError, SettleCardErrors } from "./settleCardErrors.js";

/** What the settle said happens to the card. */
export type CardDisposition =
  | { readonly kind: "done" }
  | { readonly kind: "recut"; readonly successor: string }
  | { readonly kind: "kept"; readonly why: string };

/** What the settle will do about the card, once every check has passed. */
export type CardPlan =
  | { readonly kind: "none" }
  | { readonly kind: "done"; readonly cardKey: string; readonly id: string; readonly did: string }
  | { readonly kind: "recut"; readonly cardKey: string; readonly id: string; readonly successor: string }
  | {
      readonly kind: "kept";
      readonly cardKey: string;
      readonly id: string;
      readonly why: string;
      /** The relay's `talk:<turnId>`: the kept landing lifts this relay's words and no other steer's. */
      readonly relayAnchor: string;
    };

/**
 * Read `--card`, `--card-why` and `--card-new` into one disposition, refusing every combination that says two
 * things at once.
 *
 * @returns the disposition, `undefined` when none was passed, or the first misuse
 */
export function cardDispositionOf({
  card,
  cardWhy,
  cardNew,
}: {
  card: string | undefined;
  cardWhy: string | undefined;
  cardNew: string | undefined;
}): Result<CardDisposition | undefined, SettleCardError> {
  if (card === undefined) {
    const stray = strayCompanion({ allowed: undefined, cardNew, cardWhy });
    return stray === undefined
      ? ok(undefined)
      : err(SettleCardErrors.companionMisplaced({ disposition: "", flag: stray }));
  }
  if (card !== "done" && card !== "recut" && card !== "kept") {
    return err(SettleCardErrors.cardFlagInvalid({ value: card }));
  }
  const allowed = companionOf({ disposition: card });
  const stray = strayCompanion({ allowed, cardNew, cardWhy });
  if (stray !== undefined) {
    return err(SettleCardErrors.companionMisplaced({ disposition: card, flag: stray }));
  }
  if (card === "done") {
    return ok({ kind: "done" });
  }
  const given = (card === "kept" ? cardWhy : cardNew)?.trim();
  if (given === undefined || given.length === 0) {
    return err(SettleCardErrors.companionMissing({ disposition: card, flag: allowed! }));
  }
  return ok(card === "kept" ? { kind: "kept", why: given } : { kind: "recut", successor: given });
}

/** The one companion flag a disposition takes, or `undefined` for `done`. */
function companionOf({ disposition }: { disposition: "done" | "recut" | "kept" }): string | undefined {
  if (disposition === "kept") {
    return "--card-why";
  }
  if (disposition === "recut") {
    return "--card-new";
  }
  return undefined;
}

/** The first companion flag passed that the disposition does not take, or `undefined`. */
function strayCompanion({
  allowed,
  cardWhy,
  cardNew,
}: {
  allowed: string | undefined;
  cardWhy: string | undefined;
  cardNew: string | undefined;
}): string | undefined {
  if (cardWhy !== undefined && allowed !== "--card-why") {
    return "--card-why";
  }
  if (cardNew !== undefined && allowed !== "--card-new") {
    return "--card-new";
  }
  return undefined;
}

/**
 * The hand step a relay's `about` names, when it names one.
 *
 * @param about the relay's `about`: a card key, or empty
 * @returns the step id, or `undefined` for no card or a card of another kind
 */
export function handCardIdOf({ about }: { about: string }): string | undefined {
  const parts = cardKeyParts({ cardKey: about });
  return parts?.kind === "hand" ? parts.id : undefined;
}

/**
 * The account a `done` writes on the card: the row and the witness that ended it, so a retry can recognise its
 * own settling and nothing else's.
 *
 * @param settlement how the row ended
 * @param witness what `--witness` carried
 * @returns the `did`
 */
export function settleCardDid({
  settlement,
  slug,
  witness,
}: {
  settlement: string;
  slug: string;
  witness: string;
}): string {
  return `${settlement} on handover row ${slug} — witness: ${witness}`;
}

/** A did {@link settleCardDid} wrote, with the row it names: only a real settlement leads one. */
const SETTLE_DID = new RegExp(`^(?:${ASK_SETTLEMENTS.join("|")}) on handover row (\\S+) — witness: `, "u");

/**
 * Whether one of a card's settlements came from a settle of the same row, whatever settlement or witness that
 * attempt carried: a retry after a crash may word either differently, and its first attempt's done still stands.
 *
 * @param did the account this settle would write
 * @param dids every account the card was settled with
 * @returns whether this row already settled the card
 */
export function settledByThisRow({ did, dids }: { did: string; dids: readonly string[] }): boolean {
  const slug = SETTLE_DID.exec(did)?.[1];
  return dids.some((one) => one === did || (slug !== undefined && SETTLE_DID.exec(one)?.[1] === slug));
}

/**
 * Decide what the settle does about the card, or why it cannot settle.
 *
 * @param about the relay's `about`, empty when the row is no relay's or the relay named no card
 * @param fate the named hand card's fate, `undefined` when `about` names no hand card
 * @param disposition what the settle said
 * @param did the account a `done` writes — and the one a retry's earlier `done` wrote
 * @param relayAnchor the row's `talk:<turnId>`, which a kept card's landing is scoped to
 * @returns the plan
 */
export function cardPlanOf({
  about,
  fate,
  disposition,
  did,
  relayAnchor,
}: {
  about: string;
  fate: HandCardFate | undefined;
  disposition: CardDisposition | undefined;
  did: string;
  relayAnchor: string;
}): Result<CardPlan, SettleCardError> {
  const id = handCardIdOf({ about });
  if (id === undefined || fate === undefined) {
    return nothingToAnswer({
      disposition,
      why: about === "" ? "this row's relay names no card" : `${about} is no hand card`,
    });
  }
  const card = { cardKey: about, id };
  if (fate.kind === "superseded") {
    return recutPlan({ card, disposition, successors: fate.successors });
  }
  if (fate.kind === "open") {
    return openCardPlan({ card, did, disposition, relayAnchor });
  }
  // A `done` this very settle already wrote, before a crash kept the row open: the retry finishes it, and one
  // that forgot --card records the done it wrote rather than settling the row with no disposition.
  const ownDone = disposition === undefined || disposition.kind === "done";
  if (fate.kind === "settled" && ownDone && settledByThisRow({ did, dids: fate.dids })) {
    return ok({ ...card, did, kind: "done" });
  }
  const closed = fate.kind === "settled" ? "is already settled" : "was never posted in the hand register";
  return nothingToAnswer({ disposition, why: `${about} ${closed}` });
}

/** A card a re-cut replaced: only `recut`, naming a posting that really settled it, will do. */
function recutPlan({
  card,
  disposition,
  successors,
}: {
  card: { readonly cardKey: string; readonly id: string };
  disposition: CardDisposition | undefined;
  successors: readonly string[];
}): Result<CardPlan, SettleCardError> {
  if (disposition?.kind !== "recut") {
    return err(SettleCardErrors.recutRequired({ cardKey: card.cardKey, successors }));
  }
  if (!successors.includes(disposition.successor)) {
    return err(SettleCardErrors.recutUnverified({ cardKey: card.cardKey, named: disposition.successor, successors }));
  }
  return ok({ ...card, kind: "recut", successor: disposition.successor });
}

/** A card still on the owner's queue: `done` or `kept` is planned, a missing disposition or a `recut` nothing made is refused. */
function openCardPlan({
  card,
  did,
  disposition,
  relayAnchor,
}: {
  card: { readonly cardKey: string; readonly id: string };
  did: string;
  disposition: CardDisposition | undefined;
  relayAnchor: string;
}): Result<CardPlan, SettleCardError> {
  if (disposition === undefined) {
    return err(SettleCardErrors.dispositionMissing({ cardKey: card.cardKey }));
  }
  if (disposition.kind === "recut") {
    return err(
      SettleCardErrors.recutUnverified({ cardKey: card.cardKey, named: disposition.successor, successors: [] }),
    );
  }
  if (disposition.kind === "kept") {
    return ok({ ...card, kind: "kept", relayAnchor, why: disposition.why });
  }
  return ok({ ...card, did, kind: "done" });
}

/** A row with no card to answer for: settled as before, unless a `--card` claims otherwise. */
function nothingToAnswer({
  disposition,
  why,
}: {
  disposition: CardDisposition | undefined;
  why: string;
}): Result<CardPlan, SettleCardError> {
  return disposition === undefined ? ok({ kind: "none" }) : err(SettleCardErrors.dispositionInapplicable({ why }));
}

/**
 * The front-matter a settled row carries about its card, so an archived row still says what became of it.
 *
 * @param plan what the settle did about the card
 * @returns the fields, empty when there was no card to answer for
 */
export function cardFrontMatterFields({
  plan,
}: {
  plan: CardPlan;
}): readonly { readonly key: string; readonly value: string }[] {
  if (plan.kind === "none") {
    return [];
  }
  const head = [
    { key: "cardDisposition", value: plan.kind },
    { key: "cardDispositionCard", value: plan.cardKey },
  ];
  if (plan.kind === "kept") {
    return [...head, { key: "cardDispositionReason", value: JSON.stringify(plan.why) }];
  }
  if (plan.kind === "recut") {
    return [...head, { key: "cardDispositionSuccessor", value: plan.successor }];
  }
  return head;
}

/**
 * The line `handover settle` prints about the card, or `undefined` when there was none.
 *
 * @param plan what the settle did about the card
 * @returns the line
 */
export function cardOutcomeLine({ plan }: { plan: CardPlan }): string | undefined {
  if (plan.kind === "none") {
    return undefined;
  }
  if (plan.kind === "done") {
    return `  ${plan.cardKey} is settled done, and off the owner's queue`;
  }
  if (plan.kind === "recut") {
    return `  ${plan.cardKey} was re-cut as hand:${plan.successor}, which is the card the owner sees`;
  }
  return `  ${plan.cardKey} stays on the owner's queue, kept because: ${plan.why}`;
}

/**
 * What the effect does once the card's fate is re-read under the hand register's lock: a re-cut is verified or
 * refused, a `done` this settle already wrote is found, and anything that closed the card since the plan refuses
 * rather than being relabelled as this settle's.
 *
 * @param plan what the settle planned, before the lock
 * @param fate the card's fate as the register holds it now, under the lock
 * @returns `write` when the plan's one write should happen, `verified` or `already-applied` when none is owed
 */
export function lockedCardVerdict({
  plan,
  fate,
}: {
  plan: Exclude<CardPlan, { readonly kind: "none" }>;
  fate: HandCardFate;
}): Result<"write" | "verified" | "already-applied", SettleCardError> {
  if (plan.kind === "recut") {
    const verified = fate.kind === "superseded" && fate.successors.includes(plan.successor);
    return verified ? ok("verified") : err(SettleCardErrors.settledOtherwise({ cardKey: plan.cardKey }));
  }
  if (plan.kind === "done" && fate.kind === "settled" && settledByThisRow({ did: plan.did, dids: fate.dids })) {
    return ok("already-applied");
  }
  if (fate.kind !== "open") {
    return err(SettleCardErrors.settledOtherwise({ cardKey: plan.cardKey }));
  }
  return ok("write");
}
