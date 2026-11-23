/**
 * The words the still-real row leads with: what happened, in the owner's terms, rather than a bare "confirmed 2.4d ago".
 *
 * A bare "confirmed" folds two events into one word — when the owner raised the thing, and when the fleet last
 * checked it still stood — and the reader cannot tell which. So the row names
 * each one it has a record of: "you raised this on a console call 2.4d ago" when the card carries the owner's words, "the
 * fleet last checked it" for the `--still-real` instant, and one clause when the two read the same.
 *
 * Where the owner raised it is `./sourceBlockWords.ts`'s `WHERE_HE_SAID`, the same words the source block opens on, so the row
 * and the quote above it never name one event two ways. Pure: the caller supplies the ages from its own clock.
 */
import type { HisWordsWhere } from "../components/live/readHisWords";
import { WHERE_HE_SAID } from "./sourceBlockWords";

/** When and where the owner raised what a card is about, as the caller aged it — absent when the card carries no words of theirs. */
export interface RaisedAt {
  readonly where: HisWordsWhere;
  /** The age of the owner's words, as the panel prints an age (`2.4d ago`). */
  readonly age: string;
}

/**
 * The still-real row's lead, before its dash and the ask's own `--still-real` line.
 *
 * @param raised where and how long ago the owner raised it, when the card carries their words
 * @param checkedAge how long ago the fleet last checked it still stands, when the ask recorded that instant
 * @returns the lead, in the owner's terms
 */
export function stillRealLead({
  raised,
  checkedAge,
}: {
  raised: RaisedAt | undefined;
  checkedAge: string | undefined;
}): string {
  if (raised === undefined) {
    if (checkedAge === undefined) {
      return "nothing records when the fleet last checked this";
    }
    return `the fleet last checked this ${checkedAge}`;
  }
  const said = `you raised this ${WHERE_HE_SAID[raised.where]} ${raised.age}`;
  if (checkedAge === undefined) {
    return `${said}; nothing records when the fleet last checked it`;
  }
  if (checkedAge === raised.age) {
    return `${said}, and the fleet checked it then`;
  }
  return `${said}; the fleet last checked it ${checkedAge}`;
}
