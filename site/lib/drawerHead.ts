/*
 * What the queue drawer's header says, and in which order.
 *
 * A heading that is the register's own word for itself ("Recorded ask") leaves the owner unable to tell what is
 * being asked of them, so the ask leads the panel rather than sitting further down it.
 *
 * The order is not a new opinion: `skills/supervisor/reference/fleet-briefing-shape.md`
 * § "Card shape" already says a card is "a one-sentence question ending in `?`" with a subject that
 * "renders as the title line UNDER the question". The drawer had that pairing inverted. So the question
 * becomes the heading, and the subject and the age the line beneath it. The register's word for itself left
 * that line too, with every other label read before the ask (a label on a card earns its place the same way
 * everything above the cards does); the dialog's accessible name still carries it.
 *
 * Imports nothing, like `./queueCard.ts` and `./recordLines.ts` beside it, so the root unit lane reaches it.
 */

/** One fact on the line under the drawer's heading. */
export interface SubtitlePart {
  readonly kind: "subject" | "age";
  readonly text: string;
}

/**
 * The line under the drawer's heading: what it is about, and how old it is.
 *
 * The drawer joins them with the middot the console already uses between facts on one line, and draws the
 * SUBJECT through its inline citations, so `acme/acme-admin#<number>` or a pull request's address is the chip
 * that links and hovers rather than plain text. An absent age is DROPPED rather than
 * said, because the register is the thing that carries a date and a row without one has nothing to report —
 * unlike a field a record was expected to hold.
 *
 * A subject that is only an internal id — an ask's or a hand step's board slug — is passed as `undefined` and drawn
 * as nothing (no slug or internal identifier on a card).
 *
 * @param subject what the row is about — the repository and number, the channel — or `undefined` where it is a slug
 * @param age the record's own age, already rendered
 * @returns the parts, in the order drawn
 */
export function panelSubtitleParts({
  subject,
  age,
}: {
  subject: string | undefined;
  age: string | undefined;
}): readonly SubtitlePart[] {
  const parts: SubtitlePart[] = [];
  if (subject !== undefined) {
    parts.push({ kind: "subject", text: subject });
  }
  if (age !== undefined) {
    parts.push({ kind: "age", text: age });
  }
  return parts;
}
