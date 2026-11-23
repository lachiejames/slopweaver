/**
 * The monitor backtest arm's halves that need no browser: what the snippet builder produces, and what the
 * snippet's own JSON becomes.
 *
 * The property worth proving about the source is the one its read-only classification rests on — it clicks
 * the time picker and the one preset, and nothing else; it types and fills nothing; it hooks the network
 * before it navigates. The source is also COMPILED here, and the marking expression RUN against a stub
 * document, because a syntax error in a template string or a missing `__name` shim would otherwise surface
 * only in the owner's browser.
 */
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { monitorBacktestFromOutput } from "../../../browser/datadogMonitorBacktest.js";
import {
  BACKTEST_POLL_INTERVAL_MS,
  datadogMonitorBacktestSnippet,
  markPanelExpression,
  UNSUPPORTED_NOTICE,
} from "../../../browser/datadogMonitorBacktestSnippet.js";
import { relayOperationSnippet } from "../../../browser/relayDispatch.js";
import type { RelayLease } from "../../../browser/relayLease.js";
import { PANEL_MARKER, PAST_ONE_WEEK } from "../../../datadog/shot/panelScript.js";

const ORIGIN = "https://ap1.datadoghq.invalid";
const URL = `${ORIGIN}/monitors/1000003/edit`;
const SHOT = "/x/backtest.png";
const LEASE: RelayLease = { origins: [ORIGIN], platform: "datadog", release: () => {} };
const PREVIEW = `${ORIGIN}/api/ui/monitor/evaluation_preview?from=1000&to=605800`;

/** What the terminal client prints for one operation: an envelope whose `result` is the snippet's JSON. */
function printed(snippet: Record<string, unknown>): string {
  return JSON.stringify({ result: JSON.stringify(snippet) });
}

const FRAME = {
  devicePixelRatio: 1.5,
  rect: { height: 300, width: 700, x: 362, y: 400 },
  viewportHeight: 900,
  viewportWidth: 1600,
};

const READY = {
  elapsedMs: 9_000,
  finalUrl: URL,
  frame: FRAME,
  frameAfter: FRAME,
  polls: 3,
  previews: [
    { statusCode: 200, url: PREVIEW },
    { statusCode: 200, url: "https://elsewhere.invalid/api/ui/monitor/evaluation_preview?from=0&to=1" },
  ],
  readiness: "ready",
  reading: { alertBoxed: true, marked: true, panelText: "12 Alert", pickerValue: PAST_ONE_WEEK, unmet: [] },
  screenshotError: null,
  screenshotWritten: true,
  title: "Monitor",
  windowError: null,
};

describe("the monitor backtest snippet", () => {
  const source = datadogMonitorBacktestSnippet({ readinessTimeoutMs: 60_000, screenshotPath: SHOT, url: URL });

  it("compiles as the async function the terminal client runs", () => {
    expect(() => new Script(`(${source})`)).not.toThrow();
  });

  it("bakes the address, the screenshot path and the wait in as JSON literals", () => {
    expect(source).toContain(`const url = ${JSON.stringify(URL)};`);
    expect(source).toContain(`const screenshotPath = ${JSON.stringify(SHOT)};`);
    expect(source).toContain("const readinessTimeoutMs = 60000;");
    expect(source).toContain(`const pollMs = ${String(BACKTEST_POLL_INTERVAL_MS)};`);
  });

  it("clicks the picker and the exact preset text, and nothing else", () => {
    expect(source.split(".click(").length - 1).toBe(2);
    expect(source).toContain("page.locator(pickerSelector).first().click(");
    expect(source).toContain("page.getByText(wantedWindow, { exact: true }).first().click(");
    expect(source).toContain(`const wantedWindow = ${JSON.stringify(PAST_ONE_WEEK)};`);
  });

  it("types, fills and presses nothing, and never names Save", () => {
    expect(source).not.toContain("keyboard");
    expect(source).not.toContain(".fill(");
    expect(source).not.toContain(".type(");
    expect(source).not.toMatch(/save/i);
  });

  it("hooks the evaluation-preview traffic before it navigates, and drops what came before the switch", () => {
    expect(source.indexOf('page.on("response"')).toBeLessThan(source.indexOf("page.goto("));
    expect(source.indexOf('page.on("request"')).toBeLessThan(source.indexOf("page.goto("));
    expect(source).toContain("previews = [];");
  });

  it("photographs the viewport with the marked region's geometry either side, and only once the panel is ready", () => {
    expect(source).toContain(`const marker = ${JSON.stringify(PANEL_MARKER)};`);
    expect(source).toContain("await page.screenshot({ animations: ");
    expect(source).not.toContain(".first().screenshot(");
    expect(source).not.toContain("fullPage");
    expect(source.indexOf("frame = await readFrame();")).toBeLessThan(source.indexOf("await page.screenshot("));
    expect(source.indexOf("frameAfter = await readFrame();")).toBeGreaterThan(source.indexOf("await page.screenshot("));
    expect(source).toContain('if (readiness === "ready") {');
    expect(source).toContain(JSON.stringify(UNSUPPORTED_NOTICE));
  });

  it("is what the relay dispatches for the datadog-monitor-backtest arm", () => {
    const dispatched = relayOperationSnippet({
      operation: { kind: "datadog-monitor-backtest", readinessTimeoutMs: 60_000, screenshotPath: SHOT, url: URL },
    });
    expect(dispatched).toBe(source);
  });
});

describe("markPanelExpression", () => {
  it("runs in a page with no `__name` of its own, and reports a page without the panel as such", () => {
    /** Stands in for the DOM constructors the function tests `instanceof` against. */
    class StubElement {
      readonly stub = true;
    }
    const page = {
      document: { querySelector: () => null, querySelectorAll: () => [] },
      HTMLElement: StubElement,
      HTMLInputElement: StubElement,
    };
    const result: unknown = runInNewContext(markPanelExpression(), page);
    // `toEqual`, not `toStrictEqual`: the object was built in the context's realm, so its prototype differs.
    expect(result).toEqual({
      alertBoxed: false,
      marked: false,
      panelText: null,
      pickerValue: null,
      unmet: ["the panel heading"],
    });
  });
});

describe("monitorBacktestFromOutput", () => {
  it("keeps the previews on the lease, drops the foreign one, and reports the snippet's own reading", () => {
    const observed = unwrap(monitorBacktestFromOutput({ lease: LEASE, stdout: printed(READY), url: URL }));
    expect(observed.screenshotWritten).toBe(true);
    expect(observed.observation.previewUrls).toStrictEqual([PREVIEW]);
    expect(observed.observation.readiness).toBe("ready");
    expect(observed.observation.reading).toStrictEqual(READY.reading);
    expect(observed.observation.polls).toBe(3);
    expect(observed.observation.frame).toStrictEqual(FRAME);
  });

  it("drops a region geometry with any non-numeric field whole, rather than half-reading it", () => {
    const broken = { ...FRAME, devicePixelRatio: "1.5" };
    const observed = unwrap(
      monitorBacktestFromOutput({ lease: LEASE, stdout: printed({ ...READY, frameAfter: broken }), url: URL }),
    );
    expect(observed.observation.frame).toStrictEqual(FRAME);
    expect(observed.observation.frameAfter).toBe(null);
  });

  it("refuses a page that settled off the console, which is where its sign-in wall lives", () => {
    const failed = unwrapErr(
      monitorBacktestFromOutput({
        lease: LEASE,
        stdout: printed({ ...READY, finalUrl: "https://accounts.google.invalid/signin" }),
        url: URL,
      }),
    );
    expect(failed.code).toBe("OFF_LEASE_ORIGIN");
  });

  it("refuses a result that does not say where the page settled, rather than assuming it stayed put", () => {
    const failed = unwrapErr(
      monitorBacktestFromOutput({ lease: LEASE, stdout: printed({ ...READY, finalUrl: null }), url: URL }),
    );
    expect(failed.code).toBe("SESSION_LOST");
  });

  it("turns a navigation failure the snippet reported into the typed transport error", () => {
    const failed = unwrapErr(
      monitorBacktestFromOutput({ lease: LEASE, stdout: printed({ failure: "net::ERR" }), url: URL }),
    );
    expect(failed.code).toBe("NAVIGATION_FAILED");
  });

  it("refuses a readiness this module does not declare rather than guessing at it", () => {
    const failed = unwrapErr(
      monitorBacktestFromOutput({ lease: LEASE, stdout: printed({ ...READY, readiness: "settled" }), url: URL }),
    );
    expect(failed.code).toBe("SESSION_LOST");
  });

  it("reports an unparseable print as a lost session, not as an empty capture", () => {
    expect(unwrapErr(monitorBacktestFromOutput({ lease: LEASE, stdout: "not json", url: URL })).code).toBe(
      "SESSION_LOST",
    );
  });

  it("carries a missing reading as null rather than as an unmarked one", () => {
    const observed = unwrap(
      monitorBacktestFromOutput({
        lease: LEASE,
        stdout: printed({ ...READY, readiness: "no-picker", reading: null, screenshotWritten: false }),
        url: URL,
      }),
    );
    expect(observed.observation.reading).toBe(null);
    expect(observed.screenshotWritten).toBe(false);
  });
});
