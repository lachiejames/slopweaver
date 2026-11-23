/**
 * The monitor backtest snippet — open a monitor's edit page, put its backtest on Past 1 Week, wait for the
 * "Monitor behavior with this threshold" panel to settle, mark it, and photograph the marked region.
 *
 * ## Why it is its own arm rather than an evidence adapter
 *
 * `evidenceCaptureSnippet.ts` waits on an observation shaped for the Log and Trace Explorers — canvas ink, a
 * summary sentence, a query editor — and `admit/sanctionedSeams.ts` classifies its transport read-only on the
 * explicit ground that it clicks nothing. A backtest panel is drawn in SVG, carries no such summary, and is
 * computed over whatever window the picker holds, so reaching it at all needs the picker moved. Bolting that
 * onto `browser shot` would have falsified the sentence its classification rests on. So it is a closed arm
 * of its own, the way `datadogConsoleSnippet.ts`'s palette arm is, and `datadog shot monitor` is the one verb
 * that asks for it.
 *
 * ## What it touches, and why that is a read
 *
 * Two clicks, both on the backtest's own time control: the picker input, and the `Past 1 Week` preset the
 * picker opened, matched by its exact text. That changes which window the console EVALUATES the draft monitor
 * over in this tab; it changes no field of the monitor, and nothing here clicks Save, types, or presses a key.
 * The tab is the relay's own and is closed afterwards, so the window choice leaves with it. Every selector and
 * string is a constant from `datadog/shot/panelScript.ts`; the only values a caller supplies are the URL, the
 * screenshot path and the readiness timeout, each baked in as a JSON literal.
 *
 * ## The marking function crosses as SOURCE, under a `__name` shim
 *
 * `markBacktestPanel` is the ported design's page-side half and is evaluated from its own `toString()`, so
 * the selectors have one definition. Run through `tsx`, esbuild's keep-names wraps every named inner arrow in
 * a `__name(...)` call the page does not define — MEASURED in the acme-admin capture this is ported from, which
 * threw `ReferenceError` until it installed the same shim. Here the shim is a local binding of the expression
 * that calls the function, so it touches no page global.
 *
 * ## Readiness is three things at once, because each alone was measured to lie
 *
 * The panel reads `0 times` while it is still evaluating, so one reading can say a monitor never fires. The
 * poll takes the picture only once two consecutive passes return the identical reading, the region is
 * marked with the Alert count boxed, AND no evaluation-preview call is in flight — the last because a slow
 * seven-day evaluation can leave the previous window's text standing for longer than one poll interval. A
 * query Datadog cannot backtest raises `Query is not supported` instead, which ends the wait as its own state
 * rather than as a timeout.
 *
 * ## The window proof comes off the network, bodies left behind
 *
 * Every `/api/ui/monitor/evaluation_preview` response's URL and status are kept — the URL's `from`/`to` is the
 * one place the window the console computed over is stated as a fact (`datadog/shot/proof.ts`). Previews
 * issued before the preset was chosen are dropped at the switch. No body is read.
 *
 * ## The picture is the VIEWPORT, and the crop happens in Node
 *
 * Never an element screenshot. MEASURED on a monitor's edit page in a browser running Datadog at a
 * zoom below 100%: an element screenshot of the marked region came back the right size with its content
 * shifted half a panel right and down, the Alert count cut off and the rest blank page — and every grade passed
 * it. That is the scale mismatch `visualEvidence/crop.ts` measured on the Explorer arm. So the snippet scrolls
 * the region into view, takes a plain viewport screenshot, and reports the region's viewport rectangle and the
 * page's `devicePixelRatio` read either side of the shutter; `datadog/shot/monitorShot.ts` crops on decoded
 * bytes through the same `decideEvidenceCrop`, and refuses a region that moved or left the frame.
 */
import { markBacktestPanel, markPanelOptions } from "../datadog/shot/panelScript.js";
import { EVALUATION_PREVIEW_PATH } from "../datadog/shot/proof.js";
import { NAVIGATION_TIMEOUT_MS, SCREENSHOT_TIMEOUT_MS } from "./pageVisitSnippet.js";

/**
 * The notice Datadog draws in place of the panel for a query it cannot backtest.
 * @internal
 */
export const UNSUPPORTED_NOTICE = "Query is not supported";

/**
 * How often the panel is re-marked and re-read while waiting. The ported capture's interval: a seven-day
 * evaluation repaints in steps far coarser than this, so a tighter poll only buys more passes.
 * @internal
 */
export const BACKTEST_POLL_INTERVAL_MS = 2_000;

/**
 * How long the picker and the panel may take once the page has loaded. A percentile over a week can take
 * the console most of a minute to evaluate, and `relaySession.ts`'s client bound adds this to navigation
 * and two screenshot attempts.
 */
export const BACKTEST_READINESS_MS = 60_000;

/**
 * The expression `page.evaluate` runs on each poll: the marking function's own source, called with its
 * options, under a local `__name` so esbuild's keep-names wrapping resolves inside the page.
 *
 * @returns the expression source
 * @internal
 */
export function markPanelExpression(): string {
  return `(() => { const __name = (fn) => fn; return (${markBacktestPanel.toString()})(${JSON.stringify(markPanelOptions())}); })()`;
}

/** The response hook and the in-flight counter, installed before navigation. */
const PREVIEW_HOOK = `  let previews = [];
  let inFlight = 0;
  const isPreview = (address) => address.includes(previewFragment);
  page.on("request", (request) => { if (isPreview(request.url())) { inFlight += 1; } });
  const settle = (request) => { if (isPreview(request.url())) { inFlight = Math.max(0, inFlight - 1); } };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  page.on("response", (response) => {
    if (isPreview(response.url())) {
      previews.push({ statusCode: response.status(), url: response.url() });
    }
  });
`;

/** Wait for the picker, then put it on the wanted window unless it already reads it. */
const SET_WINDOW = `  let pickerFound = true;
  try {
    await page.locator(pickerSelector).first().waitFor({ timeout: remaining() });
  } catch {
    pickerFound = false;
  }
  let windowError = null;
  let windowSet = false;
  if (pickerFound) {
    const current = await page.locator(pickerSelector).first().inputValue().catch(() => null);
    if (current === wantedWindow) {
      windowSet = true;
    } else {
      try {
        await page.locator(pickerSelector).first().click({ timeout: Math.min(10000, remaining()) });
        previews = [];
        await page.getByText(wantedWindow, { exact: true }).first().click({ timeout: Math.min(10000, remaining()) });
        await page.waitForFunction(
          (wanted) => { const el = document.querySelector(wanted.selector); return el !== null && el.value === wanted.value; },
          { selector: pickerSelector, value: wantedWindow },
          { timeout: Math.min(15000, remaining()) },
        );
        windowSet = true;
      } catch (error) {
        windowError = String(error);
      }
    }
  }
`;

/** Poll until the panel has settled, the notice appeared, or the deadline passed. */
const POLL = `  let readiness = pickerFound ? (windowSet ? "timeout" : "window-unset") : "no-picker";
  let reading = null;
  let previous = null;
  let polls = 0;
  while (windowSet && Date.now() < deadline) {
    polls += 1;
    const unsupported = await page.getByText(unsupportedNotice, { exact: true }).first().isVisible().catch(() => false);
    if (unsupported) {
      readiness = "unsupported";
      break;
    }
    reading = await page.evaluate(markExpression).catch((error) => ({
      alertBoxed: false, marked: false, panelText: null, pickerValue: null, unmet: ["the marking script: " + String(error)],
    }));
    const fingerprint = JSON.stringify(reading);
    if (reading.marked && reading.alertBoxed && inFlight === 0 && fingerprint === previous) {
      readiness = "ready";
      break;
    }
    previous = fingerprint;
    await page.waitForTimeout(pollMs);
  }
`;

/** The marked region's viewport rectangle and the frame it sits in, or `null` when the region is gone. */
const READ_FRAME = `  const readFrame = () => page.evaluate((attribute) => {
    const region = document.querySelector("[" + attribute + "]");
    if (region === null) {
      return null;
    }
    const box = region.getBoundingClientRect();
    return {
      devicePixelRatio: window.devicePixelRatio,
      rect: { height: box.height, width: box.width, x: box.x, y: box.y },
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  }, marker).catch(() => null);
`;

/**
 * Frame the marked region, park the synthetic pointer, and photograph the VIEWPORT — twice at most, the second
 * after activating the tab — reading the region's geometry either side of the shutter.
 */
const SHOOT = `  let screenshotWritten = false;
  let screenshotError = null;
  let frame = null;
  let frameAfter = null;
  if (readiness === "ready") {
    await page.locator("[" + marker + "]").first().scrollIntoViewIfNeeded({ timeout: shotTimeoutMs }).catch(() => {});
    try {
      const size = await page.evaluate(() => ({ h: window.innerHeight, w: window.innerWidth }));
      await page.mouse.move(size.w - 2, size.h - 2);
    } catch {
      // A pointer that cannot be parked costs a possible tooltip in the frame, never the capture.
    }
    for (let attempt = 1; attempt <= 2 && !screenshotWritten; attempt += 1) {
      if (attempt === 2) {
        try {
          await page.bringToFront();
        } catch (error) {
          screenshotError = "the tab could not be activated: " + String(error);
        }
      }
      frame = await readFrame();
      try {
        await page.screenshot({ animations: "disabled", path: screenshotPath, timeout: shotTimeoutMs });
        screenshotWritten = true;
        screenshotError = null;
      } catch (error) {
        screenshotError = String(error);
      }
      frameAfter = await readFrame();
    }
  }
`;

/**
 * The snippet `run-code` executes for one monitor backtest capture.
 *
 * @param url the monitor's edit page
 * @param screenshotPath where Playwright writes the PNG of the marked region
 * @param readinessTimeoutMs how long, from the page loading, the picker and the panel may take
 * @returns the snippet source
 */
export function datadogMonitorBacktestSnippet({
  url,
  screenshotPath,
  readinessTimeoutMs,
}: {
  url: string;
  screenshotPath: string;
  readinessTimeoutMs: number;
}): string {
  const options = markPanelOptions();
  return `async (page) => {
  const url = ${JSON.stringify(url)};
  const screenshotPath = ${JSON.stringify(screenshotPath)};
  const readinessTimeoutMs = ${JSON.stringify(readinessTimeoutMs)};
  const pickerSelector = ${JSON.stringify(options.pickerSelector)};
  const wantedWindow = ${JSON.stringify(options.window)};
  const marker = ${JSON.stringify(options.marker)};
  const previewFragment = ${JSON.stringify(EVALUATION_PREVIEW_PATH)};
  const unsupportedNotice = ${JSON.stringify(UNSUPPORTED_NOTICE)};
  const markExpression = ${JSON.stringify(markPanelExpression())};
  const pollMs = ${String(BACKTEST_POLL_INTERVAL_MS)};
  const shotTimeoutMs = ${String(SCREENSHOT_TIMEOUT_MS)};
  const t0 = Date.now();
${PREVIEW_HOOK}  try {
    await page.goto(url, { timeout: ${String(NAVIGATION_TIMEOUT_MS)}, waitUntil: "domcontentloaded" });
  } catch (error) {
    return JSON.stringify({ failure: String(error) });
  }
  const deadline = Date.now() + readinessTimeoutMs;
  const remaining = () => Math.max(1000, deadline - Date.now());
${SET_WINDOW}${POLL}${READ_FRAME}${SHOOT}  return JSON.stringify({
    elapsedMs: Date.now() - t0,
    finalUrl: page.url(),
    frame,
    frameAfter,
    polls,
    previews,
    readiness,
    reading,
    screenshotError,
    screenshotWritten,
    title: await page.title().catch(() => ""),
    windowError,
  });
}`;
}
