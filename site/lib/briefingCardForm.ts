/**
 * The form a briefing card must pass before a panel may draw it: no field carries text its record did not hold.
 *
 * An act card once drew PROBLEM as "Only a recorded ask carries a problem statement; this row comes from a different
 * register", STAKES as "Only a recorded ask states its risk, blast radius and still-real check" and LEAN as "No verb
 * states a lean on an act already taken": filler on every card, always unfilled. A card carries no such junk.
 * `./queueCard.ts` leaves such a field `undefined`, and this is the schema half of `AGENTS.md` rule 7: a card
 * that fills a field its register cannot fill is REFUSED, never drawn with the sentence in it.
 *
 * The criterion is CAUSAL, never a phrase list. A field is an explanation of absence when the card draws text for
 * it while the record the card was built from holds no value for it — so a recorded problem that happens to open
 * "No verb states a lean…" is drawn, and the same words in a lean slot whose record has no lean are refused. A
 * card alone cannot say which, because a recorded sentence and a fallback sentence with identical words look the
 * same once built; the caller names the record's {@link BriefingCardBasis} at the site that read it
 * (`./queueRows.ts`). Apart from `./queueCard.ts` because that module imports nothing.
 */
import type { BriefingCard } from "./queueCard";
import type { ReasonWords } from "./quotedReason";

/**
 * Whether a panel may draw a card: `refused` says which check refused it — the console's own sentence, or, where a
 * read failed, the console's lead with the read's reason kept apart so the page says it plainly beneath.
 */
export type QueueCardForm = { readonly kind: "drawn" } | { readonly kind: "refused"; readonly why: ReasonWords };

/** Whether the record a card was built from holds a value for a field. */
export type FieldBasis = "present" | "absent";

/** For each optional field a briefing card draws, whether its record holds a value — read off the record itself. */
export interface BriefingCardBasis {
  readonly what: FieldBasis;
  readonly problem: FieldBasis;
  readonly stakes: FieldBasis;
  readonly lean: FieldBasis;
}

/**
 * The first text a card draws for a field its record left empty, in the order the card draws them.
 *
 * @param card the built card
 * @param basis what the record the card was built from holds
 * @returns the field and its text, or `undefined` when every drawn field is the record's own
 */
export function unheldField({
  card,
  basis,
}: {
  card: BriefingCard;
  basis: BriefingCardBasis;
}): { readonly field: keyof BriefingCardBasis; readonly text: string } | undefined {
  if (card.what !== undefined && basis.what === "absent") {
    return { field: "what", text: card.what.whole };
  }
  if (card.problem !== undefined && basis.problem === "absent") {
    return { field: "problem", text: card.problem };
  }
  if (card.stakes !== undefined && basis.stakes === "absent") {
    return { field: "stakes", text: card.stakes.risk };
  }
  if (card.lean !== undefined && basis.lean === "absent") {
    return { field: "lean", text: card.lean };
  }
  return undefined;
}

/**
 * Whether a built briefing card may be drawn: refused, quoting the first field its record did not hold.
 *
 * @param card the built card
 * @param basis what the record the card was built from holds
 * @returns `drawn`, or the refusal
 */
export function briefingCardForm({ card, basis }: { card: BriefingCard; basis: BriefingCardBasis }): QueueCardForm {
  const unheld = unheldField({ basis, card });
  if (unheld === undefined) {
    return { kind: "drawn" };
  }
  return {
    kind: "refused",
    why: `This card would draw a ${unheld.field} its record does not hold ("${unheld.text}"), so it is refused rather than drawn.`,
  };
}
