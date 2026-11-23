/**
 * Prose with addresses in it.
 *
 * A register field is a plain string, and several of them carry URLs the verb pasted in whole. Printed as
 * text they are the wall the queue card exists to remove — measured, the pull-request
 * panel's `slack` line ran four Slack permalinks together on one unbroken line, 300 characters with no
 * space a reader's eye could land on. Repro: `slopweaver browser shot --raw --url
 * 'http://localhost:3100/pull-requests?open=16367'`. Splitting them out lets a panel draw each as the one
 * short label `subjectLabel` (`./queueCard.ts`) already derives, with the address on the link rather than on the page.
 */
import { subjectLabel } from "./queueCard";

/** One run of a register's prose: words to print, or an address to draw as a link. */
export type ProsePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly label: string; readonly url: string };

/** Matches a bare URL inside prose. Trailing sentence punctuation is left to the text run beside it. */
const BARE_URL = /https?:\/\/[^\s<>"]+[^\s<>".,;:)]/gu;

/**
 * Split a register's prose into the runs a panel draws — words as words, addresses as labelled links.
 *
 * @param text the field exactly as the verb wrote it
 * @returns the runs, in order; a string with no address comes back as one text run
 */
export function proseParts({ text }: { text: string }): readonly ProsePart[] {
  const parts: ProsePart[] = [];
  let at = 0;
  for (const match of text.matchAll(BARE_URL)) {
    const [url] = match;
    const start = match.index;
    if (start > at) {
      parts.push({ kind: "text", text: text.slice(at, start) });
    }
    parts.push({ kind: "link", label: subjectLabel({ subject: url }), url });
    at = start + url.length;
  }
  if (at < text.length) {
    parts.push({ kind: "text", text: text.slice(at) });
  }
  return parts;
}
