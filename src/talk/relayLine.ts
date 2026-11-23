/**
 * The grammar of a relay's delivery line — the turn `./supervisorDelivery.ts`'s `relayTurnLine` types into the
 * chair, opening `[voice relay talk-<12 hex>] ` — read back out of a transcript. Pure, and apart from the delivery
 * module so a reader of transcripts never loads the cmux machinery that types the line.
 */

/**
 * The wrapper Claude Code puts round text that arrived as a paste. A relay line long enough is delivered as one, so
 * MEASURED on one chain the relay opened inside it rather than at the turn's start
 * (`slopweaver profile words --since 1d --how written` listed four of them as the owner's).
 */
// Quote-aware: a `>` inside a quoted attribute value does not close the tag.
const PASTE_OPENER = /^<pasted_content\b(?:[^>"']|"[^"]*"|'[^']*')*>/u;

/** The exact head `relayTurnLine` writes: the marker, the slug `relaySlug` mints, and the space after. */
const RELAY_LINE_HEAD = /^\[voice relay (talk-[0-9a-f]{12})\] /u;

/**
 * The head a delivery line opens with.
 *
 * @param slug the relay row's slug
 * @returns `[voice relay <slug>] `
 */
export function relayLineHead({ slug }: { slug: string }): string {
  return `[voice relay ${slug}] `;
}

/**
 * The phrase every delivery line carries after the owner's words, whichever tail it is cut to — and so what tells a delivery
 * from a turn the owner typed that merely opens with the marker.
 *
 * @param slug the relay row's slug
 * @returns ` — full row <slug>; verify with slopweaver talk log.`
 */
export function relayLineVerify({ slug }: { slug: string }): string {
  return ` — full row ${slug}; verify with slopweaver talk log.`;
}

/**
 * The text of a turn with one leading paste wrapper, and the whitespace either side of it, taken off.
 *
 * @param text the turn's text
 * @returns what the turn opens with once unwrapped
 */
export function unwrapPaste({ text }: { text: string }): string {
  return text.trimStart().replace(PASTE_OPENER, "").trimStart();
}

/**
 * The minted slug a turn's opening head names, bare or inside a paste wrapper, whatever follows it. Every delivery
 * line the console has typed opens with this head, while the tail after it has changed (the first lines ended
 * `— row <slug> carries all of it; …`), so this is the read for naming which relay a console line points at — never
 * for deciding a turn IS a delivery, which is {@link relayLineSlug}'s.
 *
 * @param text the turn's text
 * @returns the `talk-<12 hex>` slug, or `undefined` when the turn does not open with the head
 */
export function relayLineHeadSlug({ text }: { text: string }): string | undefined {
  return RELAY_LINE_HEAD.exec(unwrapPaste({ text }))?.[1];
}

/**
 * The relay row a delivery line names, when the turn opens exactly the way the console's delivery does — bare or
 * inside a paste wrapper — and carries the delivery's verify phrase for that same slug. A marker anywhere but the
 * start, a slug not in the minted `talk-<12 hex>` shape, or a turn opening with the marker and going on in the owner's own
 * words (`[voice relay talk-…] why did this not go out?`) is not a delivery line.
 *
 * The phrase is looked for anywhere after the head rather than at the end: MEASURED, 6 of 204 delivery
 * lines in the chain had more text after it (`slopweaver supervisor intake --since <start-iso> --now
 * <end-iso> --json` on a build before this rule).
 *
 * @param text the turn's text
 * @returns the `talk-<12 hex>` slug, or `undefined` when the turn is not a delivery line
 */
export function relayLineSlug({ text }: { text: string }): string | undefined {
  const opened = unwrapPaste({ text });
  const slug = relayLineHeadSlug({ text });
  if (slug === undefined || !opened.includes(relayLineVerify({ slug }))) {
    return undefined;
  }
  return slug;
}
