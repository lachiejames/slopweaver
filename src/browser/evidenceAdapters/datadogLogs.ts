/**
 * The Datadog Log Explorer adapter — the ONE page `browser shot` can wait for and crop to today, with every
 * selector and every predicate fixed here and measured against the live console.
 *
 * ## Measured against the Log Explorer (`/logs?…viz=timeseries&agg_q=service`)
 *
 * Read through the governed relay with a bounded survey snippet, polling every three seconds after `load`:
 *
 * - The results panel is `[data-testid="groups-view"]`, one per page, present from ~2.1s. Its chart is
 *   `.timeseries-chart-root` and appears at ~4.4s, drawn on THREE `<canvas>` layers (2180x588 backing
 *   pixels for a 1454x392 CSS box); the SVG layers beside them (`svg_under`, `svg_over`, `cursor_layer`)
 *   carry one path and a handful of rects whatever the data, so an SVG-element count is not a witness here.
 * - Loading is `[role="progressbar"][aria-busy="true"][aria-label="Loading"]`, two of them inside the
 *   panel at ~3.4s and none from ~6.7s.
 * - The summary reads `2 service values found ( based on 32 logs )` once populated, `0 service values
 *   found ( based on 0 logs )` for a query matching nothing — the zero IS the zero-state; there is no
 *   separate "no logs" element — and is ABSENT until the data request answers. It is split over three
 *   spans, so it is read as the innerText of the smallest element whose text carries the whole sentence.
 * - `getImageData` on the chart canvases is not tainted: the data canvas sampled 183,120 pixels at stride 7
 *   and 9,403 carried alpha; the two overlay canvases 0; every canvas 0 for the zero-results query.
 * - The query editor is `[role="group"][aria-label^="query editor"]` (1824x112 CSS at y=141) and the time
 *   range picker `input[aria-label="Time range picker"]` (376x28 at y=89) — the same control
 *   `src/datadog/shot/panelScript.ts` names.
 * - Network: 993 requests in the first 4.4s, then quiet windows of 2,737ms and 5,001ms; a ~1/s trickle of
 *   `/api/v2/ddr-…` fetches continues, so quiescence is judged as "nothing moved for N ms", never "nothing
 *   in flight".
 * - The top bar (`Views · My View · time range`) and the Timeline header are STICKY: scrolled to y=129 the
 *   query editor sat at viewport y=12, under the bar, while `getBoundingClientRect` still reported it —
 *   which is why every region carries a `visibility` judged with `elementFromPoint`, not just a rectangle.
 *   Judged as "a sticky or fixed ancestor of whatever is on top", because the query editor's own `Add`
 *   button overlaps its right end in ordinary layout and a plain containment test called that occluded.
 * - The owner's own pointer can be over the page: one viewport capture carried the APM flyout their cursor
 *   had opened over the facet column. The snippet parks a synthetic pointer in the viewport's bottom-right
 *   corner before it photographs; a real cursor that moves again is a residue this cannot close.
 *
 * `6 service values found` above an empty panel — the incident — is the state between the summary's
 * request answering and the chart's, and it is exactly `summary present, canvas ink 0`.
 *
 * ## What the observation deliberately does not carry
 *
 * No body text, no attribute dump, no cookies, no storage. The query editor's text and the time picker's
 * value are the two strings, each capped, and both are what a caption needs a reader to check the claim
 * against. `src/datadog/shot/explorerScript.ts` returns the whole `body.innerText` for its own purpose;
 * this does not, and the transport contract (`../pageTransport.ts`) says why the widening is bounded.
 */

import { explorerObserveSource } from "./datadogExplorer.js";

/** The results panel — exactly one per Log Explorer page. */
export const TARGET_SELECTOR = '[data-testid="groups-view"]';

/**
 * The summary read: the smallest element whose text carries the whole sentence.
 *
 * Log Explorer only. The Trace Explorer counts its data in a different sentence, in a different element —
 * see `./datadogApmTraces.ts`.
 * @internal
 */
const READ_SUMMARY = `
      const SUMMARY = /(\\d[\\d,]*)\\s+\\S+\\s+values?\\s+found\\s*\\(\\s*based on\\s+(\\d[\\d,]*)\\s+logs?\\s*\\)/i;
      const candidates = Array.from(target.querySelectorAll("div,span,p")).filter((el) => SUMMARY.test(textOf(el)));
      if (candidates.length > 0) {
        const smallest = candidates.reduce((best, next) => (textOf(next).length < textOf(best).length ? next : best));
        const text = textOf(smallest).slice(0, MAX_TEXT);
        const match = SUMMARY.exec(text);
        summary = { groups: count(match[1]), logs: count(match[2]), rect: rectOf(smallest), text, visibility: visibilityOf(smallest) };
      }
`;

/**
 * The Log Explorer's in-page observation.
 *
 * @returns the source text of the zero-argument function `page.evaluate` runs
 */
export function datadogLogsObserveSource(): string {
  return explorerObserveSource({ readSummary: READ_SUMMARY, targetSelector: TARGET_SELECTOR });
}
