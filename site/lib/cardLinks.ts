/**
 * The words a link on a Queue card reads as. Links render one
 * way — the beautified citation chip, the site's own mark as its icon — and a label reads "thread in dev-alerts",
 * never "the thread in dev-alerts", and never a raw URL. The chip's mark already says it is Slack, so the `#` and
 * the article are noise.
 *
 * Pure: a label in, the words out.
 */
import { citedAddress } from "./citationDisplay";

/** A label that is an address rather than words: a scheme, or a bare `www.` host. */
const URL_SHAPED = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/iu;

/** The article a label opens with. */
const LEADING_ARTICLE = /^the\s+/iu;

/** A Slack place's `#` after "in" — `thread in #dev-alerts` — which the chip's own Slack mark already says. */
const CHANNEL_HASH = /(?<=\bin\s)#(?=[\p{L}\p{N}_-])/gu;

/**
 * What a card's link reads as: the label its record gave, without a leading "the" or a channel's `#`; where that
 * label is empty or is itself an address, the place the address names (`./citationDisplay.ts`), so no raw URL is
 * ever drawn.
 *
 * @param label the words the record gave the link
 * @param url where it goes, named instead of a label that is an address
 * @returns the words the chip draws
 */
export function cardLinkLabel({ label, url }: { label: string; url: string }): string {
  const trimmed = label.trim();
  if (trimmed.length === 0 || URL_SHAPED.test(trimmed)) {
    return citedAddress({ url }).place;
  }
  return trimmed.replace(LEADING_ARTICLE, "").replaceAll(CHANNEL_HASH, "");
}
