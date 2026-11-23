/**
 * What a collapsed Queue card says beside its title: which kind of request it is, and its priority when there is a
 * read on one. The collapsed card includes the title, the kind of request it is (an ask, a draft), and the priority
 * when there is a read on it — and when it was last checked, which is the currency mark's (`./cardCurrencyMark.ts`).
 *
 * The kind tile and the pill stay off the row, since "Post", then "posts as you", then "six", then "reply" is too much: one short word and one band in
 * the meta column, never a pile of labels in front of the question.
 *
 * Pure: a row's kind and tags in, two words out.
 */
import type { Kind } from "../components/console/queueKinds";
import type { CardTag } from "./queueTagsInherited";

/** Each register's word on a collapsed card — short, and the word the owner uses for it. */
export const KIND_WORD: Readonly<Record<Kind, string>> = {
  act: "done for you",
  ask: "ask",
  draft: "held reply",
  hand: "your hands",
  import: "import question",
  post: "draft as you",
  pr: "pull request",
  review: "review draft",
};

/** The bands a priority may read as, most urgent first — the board's own (`--priority p0|p1|p2|p3`). */
const BANDS: readonly string[] = ["p0", "p1", "p2", "p3"];

/**
 * The most urgent priority a card carries: the `priority=` tags it inherits from the board rows it belongs to, plus
 * the band its own ask row declares. A value outside the board's bands is no read, and is not drawn.
 *
 * @param tags the card's inherited tags
 * @param own the band its own board row declares, on an ask
 * @returns the band, or `undefined` when there is no read on one
 */
export function collapsedPriorityOf({
  tags,
  own,
}: {
  tags: readonly CardTag[];
  own: string | undefined;
}): string | undefined {
  const named = tags.filter((tag) => tag.key === "priority").map((tag) => tag.value);
  if (own !== undefined) {
    named.push(own);
  }
  return BANDS.find((band) => named.includes(band));
}
