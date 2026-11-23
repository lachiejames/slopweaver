/**
 * What an opened Queue card is related to — the rows it belongs to, what they wait on, the pull requests they name —
 * and a board row in its own words. Split out of `./cardProperties.ts`.
 */

import type { BoardRow } from "../components/live/read";
import type { RelatedItem } from "./cardPropertiesTypes";

/** What a pull-request URL reads as, `owner/repo#N`. */
const PULL_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/u;

/** A `pr=` tag's spelling, `owner/repo#N`. */
const PULL_TAG = /^([^/#\s]+\/[^/#\s]+)#(\d+)$/u;

/** The longest a related row's words run before they are cut at a word. */
const ROW_LABEL_MAX = 80;

/**
 * A board row in its own words — its open question, else its summary's first sentence, else its reason — cut at a
 * word past {@link ROW_LABEL_MAX}, so a related line reads as what the row is about rather than its slug.
 *
 * @returns the words
 */
export function rowLabel({ row }: { row: Pick<BoardRow, "question" | "summary" | "reason"> }): string {
  let words = row.reason;
  if (row.summary !== undefined && row.summary.trim().length > 0) {
    words = row.summary.trim().split(/(?<=[.!?])\s/u)[0]!;
  }
  if (row.question !== undefined && row.question.trim().length > 0) {
    words = row.question.trim();
  }
  if (words.length <= ROW_LABEL_MAX) {
    return words;
  }
  const cut = words.slice(0, ROW_LABEL_MAX);
  const space = cut.lastIndexOf(" ");
  if (space <= 0) {
    return `${cut}…`;
  }
  return `${cut.slice(0, space)}…`;
}

/**
 * A pull request as the panel links it, from a URL or a `pr=` tag; `undefined` for anything else.
 *
 * @returns the related item
 */
function pullOf({ text }: { text: string }): RelatedItem | undefined {
  const url = PULL_URL.exec(text);
  if (url !== null) {
    return { href: `https://github.com/${url[1]}/pull/${url[2]}`, kind: "pr", label: `${url[1]}#${url[2]}` };
  }
  const tag = PULL_TAG.exec(text);
  if (tag !== null) {
    return { href: `https://github.com/${tag[1]}/pull/${tag[2]}`, kind: "pr", label: text };
  }
  return undefined;
}

/**
 * Everything a card is related to: the rows it belongs to other than its own, what they wait on, and the pull
 * requests they name — each once, the card's own pull request excluded.
 *
 * @param own the row the card IS, never listed as related to itself
 * @param self the card's own pull request, `owner/repo#N`, never listed as related to itself
 * @param board every row the board read, so a row another waits on reads in its own words
 * @returns the related items, rows first
 */
export function relatedOf({
  rows,
  own,
  self,
  pullTags,
  board,
}: {
  rows: readonly BoardRow[];
  own: BoardRow | undefined;
  self: string | undefined;
  pullTags: readonly string[];
  board: readonly BoardRow[];
}): readonly RelatedItem[] {
  const items: RelatedItem[] = [];
  const seen = new Set<string>();
  const add = ({ key, item }: { key: string; item: RelatedItem }): void => {
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  };
  for (const row of rows) {
    if (row !== own) {
      add({
        item: { kind: "row", label: rowLabel({ row }), slug: row.slug, status: row.status },
        key: `row:${row.slug}`,
      });
    }
  }
  for (const row of rows) {
    for (const slug of row.blockedBy) {
      const blocker = board.find((each) => each.slug === slug);
      let label = "a row the board does not hold";
      if (blocker !== undefined) {
        label = rowLabel({ row: blocker });
      }
      add({ item: { kind: "blocked-by", label, slug }, key: `blocked:${slug}` });
    }
  }
  const texts = [...rows.flatMap((row) => row.prUrls), ...pullTags];
  for (const text of texts) {
    const item = pullOf({ text });
    if (item?.kind === "pr" && item.label !== self) {
      add({ item, key: `pr:${item.label}` });
    }
  }
  return items;
}
