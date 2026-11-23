/*
 * The one piece of a queue card's head drawn OUTSIDE its body: the subject line under the title. The people row and the
 * context line are the body's (`./QueueCardBody.tsx`); both halves read the same typed head off
 * `../../lib/queueCard.ts`. No act badge leads the title, because the question already says every label it would.
 */
import type { ReactElement } from "react";

import { drawsPeopleRow, type QueueCard } from "../../lib/queueCard";
import { InlineText } from "./InlineText";

/**
 * The panel's subject line. Plain words on a card whose people row names who it is to by id — a name matched into a
 * chip there would be the second, guessed copy of a chip drawn right below it — else linked as any sentence is.
 *
 * @param card the card the subject belongs to
 * @param text the subject as the drawer head split it out
 * @param known the addresses the row carries, so a `#N` the subject names still links
 * @returns the subject
 */
export function CardSubject({
  card,
  text,
  known,
}: {
  card: QueueCard;
  text: string;
  known: readonly string[];
}): ReactElement {
  if (card.kind === "briefing" && drawsPeopleRow({ card })) {
    return <>{text}</>;
  }
  return <InlineText text={text} known={known} />;
}
