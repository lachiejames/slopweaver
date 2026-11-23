/**
 * The evidence-capture snippet — navigate, WAIT FOR THE TARGET, photograph, observe again. The fourth
 * closed relay operation, and the one `browser shot` runs by default.
 *
 * ## Why a flat settle could never have fixed the incident
 *
 * `pageVisitSnippet.ts` does `goto` then `waitForTimeout(settleMs)`. An earlier worker
 * had already raised that to 20 seconds and the panel was STILL empty, because a sleep cannot settle on
 * "the data arrived" — it settles on a clock. Meanwhile the facet sidebar kept expanding, the document grew
 * 3.8x taller, and `fullPage: true` photographed all of it. More settle produced a worse picture.
 *
 * So this snippet polls. Every {@link POLL_INTERVAL_MS} it runs the adapter's source-owned observation
 * (`./evidenceAdapters/datadogLogs.ts`) and a network-quiet clock, and it takes the picture only once two
 * consecutive polls are both READY by the same predicate Node will re-judge with — the constants are baked
 * in from `visualEvidence/readiness.ts` so the two cannot disagree — and the target's geometry has not
 * moved between them. Expiry is a `timeout` result carrying the last observation, never a picture: a
 * caller sees WHICH condition never held.
 *
 * ## The picture is the VIEWPORT, the page is scrolled to frame the target, and the crop happens in Node
 *
 * Never `fullPage: true` here. `visualEvidence/observation.ts` carries the measurement: a full-page capture
 * of this very page photographed the chart's canvases BLANK while the DOM reported them drawn, because the
 * stitch emulates a taller viewport and the canvases are cleared by the resize — which is the incident's
 * most likely mechanism. So once the target is ready the snippet scrolls the page so the union of the
 * target and its context sits inside the viewport (bottom-aligned, so a sticky top bar cannot cover the
 * query), re-observes — every region now carries a `visibility` judged with `elementFromPoint` — parks a
 * synthetic pointer in the bottom-right corner so a hover menu the owner's real cursor opened is not
 * photographed, and takes a plain viewport screenshot. The crop is computed from those viewport rectangles
 * on decoded bytes in Node (`visualEvidence/crop.ts`), a pure function with a test; a `clip` here would
 * move the one judgement this pipeline exists to make into a string that runs in the owner's browser.
 *
 * ## What varies, and what does not
 *
 * Four values are baked in as JSON literals: the URL, the screenshot path, the readiness timeout and the
 * adapter's observation source — which is itself a fixed string from a module in this tree, chosen by
 * the closed target id, never supplied by a caller. Everything else is fixed here. There is no selector
 * parameter and no evaluate parameter; an unknown target refuses before any source is built.
 */
import { captureZoomFor, type EvidenceTarget, evidenceTargetLabel } from "../visualEvidence/evidenceTarget.js";
import { MIN_INK_SAMPLES, MIN_NETWORK_QUIET_MS } from "../visualEvidence/readiness.js";
import { datadogApmTracesObserveSource } from "./evidenceAdapters/datadogApmTraces.js";
import { datadogLogsObserveSource } from "./evidenceAdapters/datadogLogs.js";
import { NAVIGATION_TIMEOUT_MS, SCREENSHOT_TIMEOUT_MS } from "./pageVisitSnippet.js";

/**
 * How often the target is observed while waiting.
 * @internal
 */
export const POLL_INTERVAL_MS = 500;

/** The longest a caller may wait for readiness; with navigation and the shot it fits the relay's 120s. */
export const MAX_READINESS_TIMEOUT_MS = 60_000;

/** The readiness wait when a caller states none. */
export const DEFAULT_READINESS_TIMEOUT_MS = 30_000;

/**
 * The adapter's observation source for one closed target.
 *
 * Exhaustive over the union, so a target id added to `evidenceTarget.ts` without an adapter here is a
 * compile error rather than a fall-through to some other page's selectors.
 *
 * @param target the closed target
 * @returns the source of the zero-argument function `page.evaluate` runs
 */
export function observeSourceFor({ target }: { target: EvidenceTarget }): string {
  // Keyed by plain string on purpose: a forged adapter id arriving through a JSON document is a runtime
  // fact the type cannot see, and the lookup has to refuse it rather than index past the table.
  const sources: Readonly<Partial<Record<string, () => string>>> = {
    "datadog-apm-traces-v1": datadogApmTracesObserveSource,
    "datadog-logs-v1": datadogLogsObserveSource,
  };
  const source = sources[target.adapterId];
  if (source === undefined) {
    throw new Error(`no adapter for ${target.adapterId}`);
  }
  return source();
}

/**
 * How long a zoomed page is left to re-lay-out before it is first observed. Not a readiness test — the
 * poll loop is — just enough that the first observation is not of a page mid-reflow.
 */
const ZOOM_SETTLE_MS = 2_500;

/** The network-quiet clock and the observe/ready helpers — fixed, installed before navigation. */
const READY_HELPERS = `  const observe = async () => {
    const seen = await page.evaluate(observeInPage);
    seen.networkQuietMs = Date.now() - lastNetworkAt;
    seen.observedAtMs = Date.now() - t0;
    return seen;
  };
  const sameRect = (a, b) => {
    if (a === null || b === null) {
      return a === b;
    }
    return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
  };
  const candidateReady = (o) => {
    if (o.targetMatches !== 1 || o.targetRect === null || o.progressIndicators > 0 || o.networkQuietMs < minQuiet) {
      return false;
    }
    if (o.summary === null || o.chart.rect === null || o.chart.canvasCount === 0 || o.chart.inkError !== null) {
      return false;
    }
    if (o.query === null || o.timeRange === null) {
      return false;
    }
    if (o.summary.groups > 0) {
      return o.chart.inkSamples >= minInk;
    }
    // Zero-results needs ZERO ink, the same rule visualEvidence/readiness.ts applies. The two predicates
    // are deliberately identical: a page-side test that admitted what Node refuses would poll to a "ready"
    // the pipeline then throws away, and one that admitted what Node ADMITS-but-shouldn't would be worse.
    return o.summary.logs === 0 && o.chart.inkSamples === 0;
  };
  const parkPointer = async () => {
    try {
      const size = await page.evaluate(() => ({ h: window.innerHeight, w: window.innerWidth }));
      await page.mouse.move(size.w - 2, size.h - 2);
    } catch {
      // A pointer that cannot be parked costs a possible flyout in the frame, never the capture.
    }
  };
`;

/**
 * Zoom the page out when its adapter says its evidence stack does not fit the window, then let the console
 * re-lay-out and redraw before the first observation. `visualEvidence/evidenceTarget.ts` carries the
 * measurement and the factor; a zoom of 1 touches nothing at all.
 */
const ZOOM_PAGE = `  if (zoom !== 1) {
    await page.evaluate((factor) => { document.documentElement.style.zoom = String(factor); }, zoom);
    await page.waitForTimeout(${String(ZOOM_SETTLE_MS)});
  }
`;

/** The poll loop: ready once two consecutive observations pass the predicate with unmoved geometry. */
const POLL_LOOP = `  let previous = null;
  let before = null;
  let readiness = "timeout";
  let polls = 0;
  while (Date.now() - t0 < readinessTimeoutMs) {
    const current = await observe();
    polls += 1;
    if (candidateReady(current) && previous !== null && candidateReady(previous) && sameRect(previous.targetRect, current.targetRect) && sameRect(previous.chart.rect, current.chart.rect)) {
      before = current;
      readiness = "ready";
      break;
    }
    previous = current;
    before = current;
    await page.waitForTimeout(pollMs);
  }
`;

/**
 * Frame the evidence: scroll so the union of the chart, the summary, the query and the time range ends
 * at the viewport's bottom edge. Bottom-aligned on purpose — the page's sticky top bar covers whatever
 * scrolls under it, and the query editor is the first thing to go. The results panel's own box is NOT in
 * the union: its bottom padding is a quarter of the viewport of nothing. No padding in the scroll target:
 * MEASURED, the sticky bar is 81 CSS px tall and the query editor starts at 141, so 12px of
 * padding put the editor's top 5px under the bar.
 */
const FRAME_AND_REOBSERVE = `  let pageText = null;
  if (readiness === "ready") {
    const rects = [before.chart.rect, before.summary.rect, before.query.rect, before.timeRange.rect];
    const top = Math.min(...rects.map((r) => r.y)) + before.scroll.y;
    const bottom = Math.max(...rects.map((r) => r.y + r.height)) + before.scroll.y;
    const wanted = Math.max(0, Math.ceil(bottom - before.viewport.height));
    if (Math.abs(wanted - before.scroll.y) > 1 && bottom - top <= before.viewport.height) {
      await page.evaluate((y) => window.scrollTo(window.scrollX, y), wanted);
      await page.waitForTimeout(400);
    }
    await parkPointer();
    before = await observe();
    pageText = await page.evaluate(readPageText, maxTextNodes);
  }
  const geometry = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
`;

/**
 * The most text nodes and form values the page-text walk reads before it stops and reports itself truncated.
 * @internal
 */
export const MAX_PAGE_TEXT_NODES = 5_000;

/**
 * The most elements the walk visits looking for an iframe or an open shadow root, whose text it cannot read.
 * @internal
 */
export const MAX_OPAQUE_WALK_ELEMENTS = 20_000;

/**
 * The page's VISIBLE text, read once the frame is final and immediately before the shutter — every text node whose
 * box lies in the viewport, every shown form value (never a password field's), and the boxes of every region whose
 * text this walk cannot read: an iframe's document, an open shadow root. A closed shadow root is invisible to any
 * page script, which is the residue `visualEvidence/frameText.ts` names. The crop is applied in Node
 * (`visualEvidence/frameText.ts`'s `pageFrameText`), against the same viewport rectangles the crop itself is
 * decided from, so the text recorded is the text inside the picture.
 *
 * Exported for `browser console-shot`'s capture spec (`src/__tests__/e2e/capture/`), which evaluates the same source in
 * its own test browser, so the two capture verbs read a frame's text one way.
 */
export const PAGE_TEXT_SOURCE = `(maxNodes) => {
    const nodes = [];
    const opaque = [];
    let truncated = false;
    const boxOf = (r) => ({ height: r.height, width: r.width, x: r.x, y: r.y });
    const inViewport = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
    const shown = (el) => {
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
    };
    const keep = (text, r) => {
      if (nodes.length >= maxNodes) {
        truncated = true;
        return false;
      }
      nodes.push({ rect: boxOf(r), text });
      return true;
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null && !truncated; node = walker.nextNode()) {
      const text = node.data.replace(/\\s+/g, " ").trim();
      if (text === "" || node.parentElement === null || !shown(node.parentElement)) {
        continue;
      }
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (inViewport(r)) {
        keep(text, r);
      }
    }
    for (const el of document.querySelectorAll("input, textarea, select")) {
      const type = String(el.getAttribute("type") || "").toLowerCase();
      if (truncated || type === "password" || type === "hidden" || !shown(el)) {
        continue;
      }
      const raw = el.tagName === "SELECT" ? (el.selectedOptions[0] ? el.selectedOptions[0].text : "") : String(el.value || "");
      const text = raw.replace(/\\s+/g, " ").trim();
      const r = el.getBoundingClientRect();
      if (text !== "" && inViewport(r)) {
        keep(text, r);
      }
    }
    const all = document.querySelectorAll("*");
    for (let i = 0; i < all.length && i < ${String(MAX_OPAQUE_WALK_ELEMENTS)}; i += 1) {
      const el = all[i];
      const tag = el.tagName;
      if (tag === "IFRAME" || tag === "FRAME" || tag === "EMBED" || tag === "OBJECT" || el.shadowRoot !== null) {
        const r = el.getBoundingClientRect();
        if (inViewport(r)) {
          opaque.push(boxOf(r));
        }
      }
    }
    if (all.length > ${String(MAX_OPAQUE_WALK_ELEMENTS)}) {
      truncated = true;
    }
    return { nodes, opaque, truncated };
  }`;

/** The viewport screenshot, bounded and retried once with the tab activated, then the after-observation. */
function shootBlock(): string {
  return `  let screenshotWritten = false;
  let screenshotError = null;
  let after = null;
  if (readiness === "ready") {
    for (let attempt = 1; attempt <= 2 && !screenshotWritten; attempt += 1) {
      if (attempt === 2) {
        try {
          await page.bringToFront();
        } catch (error) {
          screenshotError = "the tab could not be activated: " + String(error);
        }
      }
      try {
        await page.screenshot({ fullPage: false, path: screenshotPath, timeout: ${String(SCREENSHOT_TIMEOUT_MS)} });
        screenshotWritten = true;
        screenshotError = null;
      } catch (error) {
        screenshotError = String(error);
      }
    }
    after = await observe();
  }
`;
}

/**
 * The snippet `run-code` executes for one evidence capture.
 *
 * @param url the page to open
 * @param screenshotPath where Playwright writes the viewport PNG
 * @param target which source-owned observation to wait on
 * @param readinessTimeoutMs how long the poll loop may run before it reports `timeout`
 * @returns the snippet source
 */
export function evidenceCaptureSnippet({
  url,
  screenshotPath,
  target,
  readinessTimeoutMs,
}: {
  url: string;
  screenshotPath: string;
  target: EvidenceTarget;
  readinessTimeoutMs: number;
}): string {
  return `async (page) => {
  const url = ${JSON.stringify(url)};
  const screenshotPath = ${JSON.stringify(screenshotPath)};
  const readinessTimeoutMs = ${JSON.stringify(readinessTimeoutMs)};
  const targetLabel = ${JSON.stringify(evidenceTargetLabel({ target }))};
  const observeInPage = ${observeSourceFor({ target })};
  const readPageText = ${PAGE_TEXT_SOURCE};
  const maxTextNodes = ${String(MAX_PAGE_TEXT_NODES)};
  const zoom = ${String(captureZoomFor({ target }))};
  const minInk = ${String(MIN_INK_SAMPLES)};
  const minQuiet = ${String(MIN_NETWORK_QUIET_MS)};
  const pollMs = ${String(POLL_INTERVAL_MS)};
  const t0 = Date.now();
  let lastNetworkAt = Date.now();
  const touch = () => { lastNetworkAt = Date.now(); };
  page.on("request", touch);
  page.on("requestfinished", touch);
  page.on("requestfailed", touch);
  try {
    await page.goto(url, { timeout: ${String(NAVIGATION_TIMEOUT_MS)}, waitUntil: "load" });
  } catch (error) {
    return JSON.stringify({ failure: String(error) });
  }
${READY_HELPERS}${ZOOM_PAGE}  await parkPointer();
${POLL_LOOP}${FRAME_AND_REOBSERVE}${shootBlock()}  return JSON.stringify({
    after,
    before,
    elapsedMs: Date.now() - t0,
    finalUrl: page.url(),
    geometry,
    pageText,
    polls,
    readiness,
    screenshotError,
    screenshotWritten,
    targetLabel,
    title: await page.title().catch(() => ""),
  });
}`;
}
