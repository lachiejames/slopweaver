/**
 * Where a stamp's CHROME goes: the stylesheet that makes a mark visible, and the strip naming every mark.
 *
 * The marks themselves are spliced by `./corrections.ts`; this places the two pieces of chrome around them. On a
 * fragment the stylesheet leads and the strip follows the eyebrow. On a whole published page both go INSIDE the
 * fragment, the shell staying outermost: chrome written ahead of the doctype once threw the page into quirks mode
 * and hid its shell from every reader that recognises one (`src/pages/shell.ts`). A page keeps the shell it was
 * published in — a correction is not a migration.
 *
 * Pure: strings in, a string out.
 */
import { PLATFORM_SHELL_OPEN, SHELL_CLOSE, SHELL_OPEN, unwrapPageFragment } from "../../pages/shell.js";
import { maskNonMarkup } from "./htmlTokens.js";

/**
 * Where the strip is spliced in: directly after the eyebrow, which is the page's other chrome line.
 *
 * Matched against the MASKED page rather than the raw bytes, for the reason `./htmlTokens.ts` exists: a
 * `<script>` quoting `<div class="eyebrow">…</div>` is text, and review `r3-inert` measured a strip spliced
 * into the middle of one such string — where the strip module then correctly declined to take it back out,
 * so neither the round trip nor a second stamp of the same page held.
 */
const EYEBROW_ELEMENT = /<div class="eyebrow">[\s\S]*?<\/div>/i;

/** The stylesheet that makes a mark visible. Stripped by every gate on the page, so it costs no budget. */
const CORRECTION_STYLES = `<style data-corr-style="1">
  .corr { margin: 0 0 1rem; font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: baseline; }
  .corr-lead { font-weight: 600; color: var(--accent, #2E4C8F); }
  .corr a { color: var(--accent, #2E4C8F); }
  .corr-gone, .corr-more, .corr-none { color: var(--muted, #6F7882); }
  [data-corr] { border-left: 3px solid var(--accent, #2E4C8F); padding-left: 0.7rem; scroll-margin-top: 2rem; }
  [data-corr]::before { content: attr(data-corr); display: block; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; color: var(--accent, #2E4C8F); }
  [data-corr="new"] { border-left-color: var(--ok, #2E7D4F); }
  [data-corr="new"]::before { color: var(--ok, #2E7D4F); }
  details[data-corr-inside] > summary::after { content: " — " attr(data-corr-inside); color: var(--accent, #2E4C8F); font-weight: 600; }
</style>
`;

/** One fragment with the correction stylesheet in front and the strip after its eyebrow. */
function fragmentWithChrome({ fragment, strip }: { fragment: string; strip: string }): string {
  // The mask is the same length as the fragment, so this index is an index into `fragment`'s own bytes.
  const eyebrow = EYEBROW_ELEMENT.exec(maskNonMarkup({ html: fragment }));
  if (eyebrow === null) {
    return `${CORRECTION_STYLES}${strip}${fragment}`;
  }
  const at = eyebrow.index + eyebrow[0].length;
  return `${CORRECTION_STYLES}${fragment.slice(0, at)}\n  ${strip}${fragment.slice(at)}`;
}

/**
 * A marked page with its chrome placed: inside the fragment of a whole published page, or around a bare one.
 *
 * @param html the page with its marks already spliced, a fragment or a whole shelled document
 * @param strip the rendered strip element
 * @returns the page to publish
 */
export function withCorrectionChrome({ html, strip }: { html: string; strip: string }): string {
  const shelled = unwrapPageFragment({ html });
  if (shelled === undefined) {
    return fragmentWithChrome({ fragment: html, strip });
  }
  const opener = shelled.shell === "house" ? SHELL_OPEN : PLATFORM_SHELL_OPEN;
  return `${opener}${fragmentWithChrome({ fragment: shelled.fragment, strip })}${SHELL_CLOSE}`;
}
