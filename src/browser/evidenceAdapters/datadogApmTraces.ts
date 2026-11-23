/**
 * The Datadog Trace Explorer adapter — the second page `browser shot` can wait for and crop to, and the
 * one the three daily alert digests actually cite.
 *
 * ## Why it exists: a delivery failure is a SPAN, and only a span
 *
 * MEASURED on this install. The `growth-ops` row's five probes are metric sums over
 * `event_kit.delivery`, and every one of them cites a `traces` view, because the failures exist nowhere
 * else: `service:jobs-api env:(prod OR production) event-deliver` over 24 hours returned 11,569 log events
 * and all of them read `[event-deliver] Successfully delivered`, while
 * `@acme.event_kit.delivery_status:failed` matched ZERO logs and 3,213 spans. So a digest whose images
 * come from the Log Explorer could only ever picture the successes.
 *
 * ## Measured through the governed relay, against the APM Trace Explorer (`/apm/traces?…viz=timeseries`)
 *
 * - The panel is `.trace_analytics-visualization`, exactly one per page, holding both the chart and the
 *   count. `[data-testid="groups-view"]` — the Log Explorer's panel — is ABSENT here, which is why forcing
 *   the logs target on this address answers `the target's own element is not on the page`. This page
 *   carries no `data-testid` at all that names a view, a panel or a chart, so the class is the selector;
 *   `trace_analytics-visualization` is a plain name rather than one of the build-hashed
 *   `panel-module_BKYtEq_…` classes around it, which is the distinction
 *   `datadog-visual-proof-branch-is-the-better-reference` records as the one that survives a deploy.
 * - The chart is the shared `.timeseries-chart-root`, five canvases, and `getImageData` is not tainted:
 *   the data layer sampled 212,061 pixels at stride 7 and 60,249 carried alpha, the overlay 4,362, the
 *   other three zero.
 * - The count is a BUTTON reading `3.23k indexed spans` inside the panel, against the same probe's metric
 *   total of 3,213 for the same window. It is ABBREVIATED — `k` and `M` — which is why
 *   {@link SPAN_COUNT_PATTERN} carries a suffix and the parse multiplies. The number is a witness that the
 *   data request answered, never a claim the card makes; the card's own count comes from the API.
 * - The ZERO state is not a zero — it is a different panel. A query matching nothing renders
 *   `No matching traces found · 5,655,609 spans found in the past 15 min · …` with NO chart root inside
 *   the panel at all, so there is nothing to photograph. The adapter reports it as a summary of zero with
 *   that text, and readiness then refuses the capture for want of a chart. That refusal is correct: a
 *   probe firing on a metric while its own trace view holds nothing is a disagreement between two
 *   witnesses, and shipping a picture of the empty state as evidence for a count is the failure to avoid.
 * - No `[role="progressbar"]` was observed inside the panel in either state, so this page's readiness
 *   rests on the count, the canvas ink and the network-quiet clock rather than on a loading indicator.
 *   The progress count is still read: zero here is a measurement, not an assumption.
 * - The query editor and the time-range picker are the shared ones (`./datadogExplorer.ts`), at 1304x177
 *   and 375x28 respectively on a 1512x662 viewport.
 *
 * Repro for any of it, with the survey snippet of the day:
 * `slopweaver browser shot --url '<an /apm/traces?…viz=timeseries link>' --target datadog-apm-traces-v1:timeseries --json`
 */

import { explorerObserveSource } from "./datadogExplorer.js";

/** The visualization panel — exactly one per Trace Explorer page, holding the chart and the count.
 * @internal
 */
export const TARGET_SELECTOR = ".trace_analytics-visualization";

/**
 * The count sentence, with Datadog's own abbreviation: `78 indexed spans`, `3.23k indexed spans`.
 *
 * Exported so the parse and its test read the same pattern.
 * @internal
 */
export const SPAN_COUNT_PATTERN = "/([\\d.,]+)\\s*([kKmM]?)\\s+indexed spans/";

/** The `No matching traces found` panel, which renders INSTEAD of the chart.
 * @internal
 */
export const ZERO_STATE_PATTERN = "/no matching traces found/i";

/**
 * The summary read.
 *
 * Two sentences, one field. The populated panel's `<n> indexed spans` fills both counts, because the
 * Trace Explorer's count is ungrouped — there is no "N values found" here, so a group count would have to
 * be invented, and `visualEvidence/readiness.ts` only ever asks whether the count is above zero. The
 * zero-state panel fills both with zero and carries its own sentence as the text, so a reader of the
 * refusal sees what the page actually said.
 * @internal
 */
const READ_SUMMARY = `
      const SPANS = ${SPAN_COUNT_PATTERN};
      const ZERO_STATE = ${ZERO_STATE_PATTERN};
      const scale = (suffix) => {
        if (suffix === "k" || suffix === "K") {
          return 1000;
        }
        if (suffix === "m" || suffix === "M") {
          return 1000000;
        }
        return 1;
      };
      const counted = Array.from(target.querySelectorAll("button,div,span")).filter((el) => SPANS.test(textOf(el)) && textOf(el).length < 60);
      if (counted.length > 0) {
        const smallest = counted.reduce((best, next) => (textOf(next).length < textOf(best).length ? next : best));
        const text = textOf(smallest).slice(0, MAX_TEXT);
        const match = SPANS.exec(text);
        const spans = Math.round(count(match[1]) * scale(match[2]));
        summary = { groups: spans, logs: spans, rect: rectOf(smallest), text, visibility: visibilityOf(smallest) };
      } else {
        const empty = Array.from(target.querySelectorAll("div,span")).filter((el) => ZERO_STATE.test(textOf(el)) && textOf(el).length < 120);
        if (empty.length > 0) {
          const smallest = empty.reduce((best, next) => (textOf(next).length < textOf(best).length ? next : best));
          summary = { groups: 0, logs: 0, rect: rectOf(smallest), text: textOf(smallest).slice(0, MAX_TEXT), visibility: visibilityOf(smallest) };
        }
      }
`;

/**
 * The Trace Explorer's in-page observation.
 *
 * @returns the source text of the zero-argument function `page.evaluate` runs
 */
export function datadogApmTracesObserveSource(): string {
  return explorerObserveSource({ readSummary: READ_SUMMARY, targetSelector: TARGET_SELECTOR });
}
