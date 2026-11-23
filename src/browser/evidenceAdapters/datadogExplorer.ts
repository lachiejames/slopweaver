/**
 * What every Datadog explorer capture shares — the console chrome, the canvas ink read, and the shape of
 * the observation each adapter returns.
 *
 * ## Why this file exists at all
 *
 * The Log Explorer and the Trace Explorer are two pages of one console. MEASURED on this install's site,
 * through the governed relay, against `/apm/traces?…viz=timeseries`: the query editor is the same
 * `[role="group"][aria-label^="query editor"]`, the time-range picker the same
 * `input[aria-label="Time range picker"]`, and the chart the same `.timeseries-chart-root` drawn on
 * canvases whose alpha reads without tainting (60,249 of 212,061 sampled pixels on the data layer). What
 * DIFFERS is the panel the chart sits in and the sentence that counts the data — and those two are what an
 * adapter module owns.
 *
 * So the split is by MEASUREMENT rather than by taste: a selector this file carries is one both pages were
 * observed to share, and a selector an adapter carries is one where they were observed to differ. Copying
 * the shared half into a second adapter would have been the drift `datadogLogs.ts` was already written to
 * avoid inside one page.
 *
 * Nothing here decides readiness. `../evidenceCaptureSnippet.ts` polls and `visualEvidence/readiness.ts`
 * judges, both over the observation this file shapes.
 */

/** The chart root inside the panel; its `<canvas>` children are where data is drawn. Both explorers. */
export const CHART_SELECTOR = ".timeseries-chart-root";

/** Datadog's loading indicator, matched by role rather than by its hashed class. */
export const PROGRESS_SELECTOR = '[role="progressbar"]';

/** The query editor group. The `^=` is because the label carries a suffix (`query editor a`). */
export const QUERY_SELECTOR = '[role="group"][aria-label^="query editor"]';

/**
 * The query TEXT inside the editor group — the `role="textbox"` the search bar renders the query in.
 * The group's own `innerText` runs on into the aggregation row (`Group into Fields Show Count of …`),
 * 252 characters on the incident's query; the textbox carries the query alone.
 * @internal
 */
export const QUERY_TEXT_SELECTOR = '[role="textbox"]';

/** The time-range picker input. */
export const TIME_RANGE_SELECTOR = 'input[aria-label="Time range picker"]';

/** Every fourth-plus-three byte, i.e. every seventh pixel's alpha, so a 2180x588 canvas costs ~180k reads.
 * @internal
 */
export const INK_SAMPLE_STRIDE_PX = 7;

/** The most characters of the query or the time range carried back.
 * @internal
 */
export const MAX_CONTEXT_TEXT_CHARS = 300;

/** How many elements the smallest-font walk visits before it stops.
 * @internal
 */
export const MAX_FONT_WALK_ELEMENTS = 3_000;

/** The in-page helpers: rectangles in viewport coordinates, the visibility judgement, text and counts. */
const HELPERS = `
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { height: r.height, width: r.width, x: r.x, y: r.y };
    };
    const visibilityOf = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        return "clipped";
      }
      if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) {
        return "clipped";
      }
      const inset = Math.min(4, r.width / 4, r.height / 4);
      const points = [
        [r.left + inset, r.top + inset],
        [r.right - inset, r.top + inset],
        [r.left + inset, r.bottom - inset],
        [r.right - inset, r.bottom - inset],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (hit === null || el === hit || el.contains(hit)) {
          continue;
        }
        // Something else is on top at this point. A sibling control overlapping an edge (the query
        // editor's own "Add" button sits over its right end) is the page's ordinary layout; what this
        // check exists to catch is a STICKY or FIXED bar the region has scrolled under.
        let node = hit;
        for (let depth = 0; node !== null && depth < 15; depth += 1) {
          const position = window.getComputedStyle(node).position;
          if ((position === "sticky" || position === "fixed") && !node.contains(el)) {
            return "occluded";
          }
          node = node.parentElement;
        }
      }
      return "visible";
    };
    const textOf = (el) => String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    const count = (s) => Number(s.replace(/,/g, ""));
`;

/** The chart read: every canvas's alpha channel, sampled at the stride. */
const READ_CHART = `
      const chartRoot = target.querySelector(CHART);
      if (chartRoot !== null) {
        const canvases = Array.from(chartRoot.querySelectorAll("canvas"));
        let inkSamples = 0;
        let sampledPixels = 0;
        let inkError = null;
        for (const canvas of canvases) {
          try {
            const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < data.length; i += 4 * STRIDE) {
              sampledPixels += 1;
              if (data[i] > 0) {
                inkSamples += 1;
              }
            }
          } catch (error) {
            inkError = String(error);
          }
        }
        chart = { canvasCount: canvases.length, inkError, inkSamples, rect: rectOf(chartRoot), sampledPixels, visibility: visibilityOf(chartRoot) };
      }
`;

/** The smallest computed font size among the target's own text leaves, bounded by MAX_WALK. */
const READ_SMALLEST_FONT = `
      const walk = target.querySelectorAll("*");
      for (let i = 0; i < walk.length && i < MAX_WALK; i += 1) {
        const el = walk[i];
        let ownText = "";
        for (const node of el.childNodes) {
          if (node.nodeType === 3) {
            ownText += node.data;
          }
        }
        if (ownText.trim() === "") {
          continue;
        }
        const size = parseFloat(window.getComputedStyle(el).fontSize);
        if (Number.isFinite(size) && size > 0 && (smallestFontPx === null || size < smallestFontPx)) {
          smallestFontPx = size;
        }
      }
`;

/**
 * Build one explorer adapter's in-page observation, as the source of a zero-argument function
 * `page.evaluate` runs.
 *
 * Every selector is interpolated as a JSON literal and `readSummary` is the adapter's own source text;
 * there is no other input. The function closes over nothing, uses no Web global the evaluation context
 * lacks (`URL` is absent there — see `../pageVisitSnippet.ts`), and returns a plain object
 * `../evidenceCapture.ts` validates field by field.
 *
 * @param targetSelector the one panel this page's data renders in
 * @param readSummary the adapter's own source text, which assigns `summary` from `target`
 * @returns the source text of the function
 */
export function explorerObserveSource({
  targetSelector,
  readSummary,
}: {
  targetSelector: string;
  readSummary: string;
}): string {
  return `() => {
    const TARGET = ${JSON.stringify(targetSelector)};
    const CHART = ${JSON.stringify(CHART_SELECTOR)};
    const PROGRESS = ${JSON.stringify(PROGRESS_SELECTOR)};
    const QUERY = ${JSON.stringify(QUERY_SELECTOR)};
    const QUERY_TEXT = ${JSON.stringify(QUERY_TEXT_SELECTOR)};
    const TIME_RANGE = ${JSON.stringify(TIME_RANGE_SELECTOR)};
    const STRIDE = ${String(INK_SAMPLE_STRIDE_PX)};
    const MAX_TEXT = ${String(MAX_CONTEXT_TEXT_CHARS)};
    const MAX_WALK = ${String(MAX_FONT_WALK_ELEMENTS)};
${HELPERS}
    const targets = document.querySelectorAll(TARGET);
    const target = targets.length === 1 ? targets[0] : null;
    let summary = null;
    let chart = { canvasCount: 0, inkError: null, inkSamples: 0, rect: null, sampledPixels: 0, visibility: null };
    let smallestFontPx = null;
    let progress = 0;
    if (target !== null) {
      progress = target.querySelectorAll(PROGRESS).length;
${readSummary}${READ_CHART}${READ_SMALLEST_FONT}
    }
    const queryEl = document.querySelector(QUERY);
    const queryTextEl = queryEl === null ? null : queryEl.querySelector(QUERY_TEXT);
    const timeEl = document.querySelector(TIME_RANGE);
    return {
      chart,
      document: { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth },
      progressIndicators: progress,
      query: queryEl === null ? null : { rect: rectOf(queryEl), text: textOf(queryTextEl === null ? queryEl : queryTextEl).slice(0, MAX_TEXT), visibility: visibilityOf(queryEl) },
      scroll: { x: window.scrollX, y: window.scrollY },
      smallestFontPx,
      summary,
      targetMatches: targets.length,
      targetRect: target === null ? null : rectOf(target),
      timeRange: timeEl === null ? null : { rect: rectOf(timeEl), text: String(timeEl.value || "").slice(0, MAX_TEXT), visibility: visibilityOf(timeEl) },
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  }`;
}
