/**
 * Every address a queue row carries, whichever register it came from — what a card's sentences resolve a bare
 * a five-digit `#NNNNN`, `acme-admin 17564` or `ABC-123` against, so the number is a citation chip on every card, not only an ask.
 *
 * On a hand card only one of its numbers once linked. The dialog handed its sentences an ask row's `prUrls` and nothing for any other
 * kind, so a hand step's own place, a pull request's own address and an act's links resolved nothing.
 *
 * A module rather than logic inside `../components/console/QueuePanels.tsx` for the reason `./askLinks.ts` gives:
 * the unit lane does not transform `.tsx`. Imports one pure module and types. Pure: a row in, addresses out.
 */

import { ADDRESS_TRAILING, drawnTexts } from "./inlineCitations";
import type { QueueRow } from "./queueRows";

/** An `https://` address in prose, up to the first space, quote, angle bracket, closing bracket or Slack's `|`. */
const HTTPS = /https:\/\/[^\s<>"'`)\]}|]+/gu;

/**
 * The addresses the record itself carries, by register.
 *
 * @param record the row's own record
 * @returns its addresses, in the record's order
 */
function recordAddresses({ record }: { record: QueueRow["record"] }): readonly string[] {
  if (record.kind === "ask") {
    // Its anchor too, when that is an address: the card shows it, so a bare number it names resolves off it.
    const { prUrls, anchor } = record.row;
    return anchor?.startsWith("https://") === true ? [...prUrls, anchor] : prUrls;
  }
  if (record.kind === "hand") {
    // The note's own address and its place when either is one, then every address the step cites — a step
    // whose `url` is a console page names its pull requests through `cites` alone.
    const { url, where, cites } = record.step;
    const places = [url, where].filter((place): place is string => place?.startsWith("https://") === true);
    if (record.decision === undefined) {
      return [...places, ...cites];
    }
    // A decision step draws its linked ask's sentences, so the ask's own addresses resolve their numbers too.
    const { ask, threadUrl } = record.decision;
    const asked = [ask.anchor, threadUrl].filter((place): place is string => place?.startsWith("https://") === true);
    return [...places, ...cites, ...ask.prUrls, ...asked];
  }
  if (record.kind === "pr") {
    return [record.row.url];
  }
  if (record.kind === "act") {
    if (record.links.kind === "linked") {
      return record.links.links.map((link) => link.url);
    }
    return [];
  }
  if (record.kind === "draft") {
    return record.draft.citations.map((citation) => citation.url);
  }
  if (record.kind === "review") {
    return [record.review.url];
  }
  if (record.kind === "import") {
    // A staged import question names this installation's own store, never an address.
    return [];
  }
  // A parked post: the message's own addresses, so its card's `review PR #N` links while the Slack preview stays as
  // the message will read.
  return [...record.post.fallback.matchAll(HTTPS)].map((match) => match[0].replace(ADDRESS_TRAILING, ""));
}

/**
 * Every address a row carries: its record's own, then each one its card's drawn sentences name, so a number one
 * sentence names bare resolves off the address another sentence spells out. Deduplicated, first seen first.
 *
 * @param row the queue row
 * @returns the addresses
 */
export function cardAddresses({ row }: { row: QueueRow }): readonly string[] {
  const out: string[] = [];
  const add = ({ url }: { url: string }): void => {
    if (!out.includes(url)) {
      out.push(url);
    }
  };
  for (const url of recordAddresses({ record: row.record })) {
    add({ url });
  }
  for (const text of [...drawnTexts({ card: row.card }), row.card.subject, ...foldedTexts({ record: row.record })]) {
    for (const match of text.matchAll(HTTPS)) {
      add({ url: match[0].replace(ADDRESS_TRAILING, "") });
    }
  }
  return out;
}

/**
 * The text a card draws folded beneath its sentences rather than inside them — a detached ask's read reason, which
 * once sat inside the card's what, so an address it names still resolves the numbers the card's own words name,
 * and a file it names is still one `open_card` offers (`./openCard.ts`). Scanned after the drawn
 * sentences: an address only it names comes later in the list than before, which changes nothing unless two of a
 * card's addresses carry the same number.
 *
 * @param record the row's own record
 * @returns the folded texts, none for any record that folds none
 */
export function foldedTexts({ record }: { record: QueueRow["record"] }): readonly string[] {
  if (record.kind !== "ask" || record.row.reasonWhy === undefined) {
    return [];
  }
  return [record.row.reasonWhy];
}
