/**
 * The evidence-capture arm: the closed operation dispatch, the snippet's fixed shape, and the strict
 * parser over what the browser printed. Nothing here reaches a browser. Every Datadog host in this file reads a
 * synthetic site rather than the install's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { browserErrorLines } from "../../../browser/browserErrors.js";
import {
  CHART_SELECTOR,
  PROGRESS_SELECTOR,
  QUERY_SELECTOR,
  TIME_RANGE_SELECTOR,
} from "../../../browser/evidenceAdapters/datadogExplorer.js";
import { TARGET_SELECTOR } from "../../../browser/evidenceAdapters/datadogLogs.js";
import { captureFromOutput, createEvidenceCaptureTransport } from "../../../browser/evidenceCapture.js";
import { evidenceCaptureSnippet, observeSourceFor } from "../../../browser/evidenceCaptureSnippet.js";
import { parseEvidenceCaptureResult, parseTargetObservation } from "../../../browser/evidenceParse.js";
import { relayOperationSnippet } from "../../../browser/relayDispatch.js";
import type { RelayLease } from "../../../browser/relayLease.js";
import type { RelayOperation } from "../../../browser/relayOperation.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const TARGET = { adapterId: "datadog-logs-v1", targetId: "timeseries" } as const;
const LEASE: RelayLease = { origins: ["https://ap1.datadoghq.com"], platform: "browser shot", release: () => {} };

const RECT = { height: 442, width: 1504, x: 472, y: 441 };

/** What the live snippet printed for one observation, in the shape the parser reads. */
function observation(): Record<string, unknown> {
  return {
    chart: {
      canvasCount: 3,
      inkError: null,
      inkSamples: 9403,
      rect: RECT,
      sampledPixels: 183120,
      visibility: "visible",
    },
    document: { height: 3256, width: 2016 },
    networkQuietMs: 2737,
    observedAtMs: 7515,
    progressIndicators: 0,
    query: { rect: { height: 112, width: 1824, x: 176, y: 88 }, text: "env:staging", visibility: "visible" },
    scroll: { x: 0, y: 53 },
    smallestFontPx: 10,
    summary: {
      groups: 2,
      logs: 32,
      rect: { height: 18, width: 242, x: 510, y: 372 },
      text: "2 service values found ( based on 32 logs )",
      visibility: "visible",
    },
    targetMatches: 1,
    targetRect: { height: 597, width: 1537, x: 455, y: 310 },
    timeRange: { rect: { height: 28, width: 376, x: 1462, y: 89 }, text: "Aug 29 – Sep 13", visibility: "visible" },
    viewport: { height: 883, width: 2016 },
  };
}

function output(): Record<string, unknown> {
  return {
    after: observation(),
    before: observation(),
    elapsedMs: 7600,
    finalUrl: "https://ap1.datadoghq.com/logs?viz=timeseries",
    geometry: {
      devicePixelRatio: 1.5,
      documentHeight: 3256,
      documentWidth: 2016,
      viewportHeight: 883,
      viewportWidth: 2016,
    },
    polls: 12,
    readiness: "ready",
    screenshotError: null,
    screenshotWritten: false,
    title: "Log Explorer | Datadog",
  };
}

describe("relayOperationSnippet, the closed dispatch", () => {
  it("builds the evidence-capture snippet for the new arm, with the adapter's selectors and nothing from a caller", () => {
    const source = relayOperationSnippet({
      operation: {
        kind: "page-evidence-capture",
        readinessTimeoutMs: 30000,
        screenshotPath: "/tmp/x.png",
        target: TARGET,
        url: "https://ap1.datadoghq.com/logs?viz=timeseries",
      },
    });
    expect(source.startsWith("async (page) => {")).toBe(true);
    for (const selector of [TARGET_SELECTOR, CHART_SELECTOR, PROGRESS_SELECTOR, QUERY_SELECTOR, TIME_RANGE_SELECTOR]) {
      expect(source).toContain(JSON.stringify(selector));
    }
    expect(source).toContain("const readinessTimeoutMs = 30000;");
    expect(source).toContain("page.screenshot({ fullPage: false,");
    expect(source).not.toContain("fullPage: true");
    expect(source).toContain('const targetLabel = "datadog-logs-v1:timeseries";');
  });

  it("bakes the url and path in as JSON literals, so a quote or a newline stays data", () => {
    const source = evidenceCaptureSnippet({
      readinessTimeoutMs: 1000,
      screenshotPath: '/tmp/a"b\n.png',
      target: TARGET,
      url: 'https://ap1.datadoghq.com/logs?q="x"',
    });
    expect(source).toContain('const url = "https://ap1.datadoghq.com/logs?q=\\"x\\"";');
    expect(source).toContain('const screenshotPath = "/tmp/a\\"b\\n.png";');
  });

  it("throws on a forged operation kind rather than falling through to any other arm", () => {
    const forged = {
      kind: "page-evaluate",
      source: "page.click('#post')",
      url: "https://x",
    } as unknown as RelayOperation;
    expect(() => relayOperationSnippet({ operation: forged })).toThrow(
      "relay operation kind is not one this module declares",
    );
  });

  it("throws on an unknown adapter id rather than picking selectors from another page", () => {
    const forged = { adapterId: "datadog-metrics-v1", targetId: "timeseries" } as unknown as typeof TARGET;
    expect(() => observeSourceFor({ target: forged })).toThrow("no adapter for datadog-metrics-v1");
  });
});

describe("parseTargetObservation", () => {
  it("reads the live shape exactly", () => {
    const parsed = unwrap(parseTargetObservation({ at: "before", value: observation() }));
    expect(parsed.summary).toEqual({
      groups: 2,
      logs: 32,
      rect: { height: 18, width: 242, x: 510, y: 372 },
      text: "2 service values found ( based on 32 logs )",
      visibility: "visible",
    });
    expect(parsed.chart.inkSamples).toBe(9403);
    expect(parsed.chart.visibility).toBe("visible");
    expect(parsed.viewport).toEqual({ height: 883, width: 2016 });
    expect(parsed.scroll).toEqual({ x: 0, y: 53 });
    expect(parsed.smallestFontPx).toBe(10);
  });

  it("accepts the unloaded shape: no summary, no chart, no visibility", () => {
    const early = {
      ...observation(),
      chart: { canvasCount: 0, inkError: null, inkSamples: 0, rect: null, sampledPixels: 0, visibility: null },
      summary: null,
    };
    const parsed = unwrap(parseTargetObservation({ at: "before", value: early }));
    expect(parsed.summary).toBe(null);
    expect(parsed.chart.rect).toBe(null);
  });

  it("refuses a missing number, a rectangle with no area, a bad visibility word and a negative count, each by path", () => {
    const bad = {
      ...observation(),
      chart: {
        canvasCount: 3,
        inkError: null,
        inkSamples: 9403,
        rect: { height: 0, width: 10, x: 0, y: 0 },
        sampledPixels: 183120,
        visibility: "hidden",
      },
      networkQuietMs: "soon",
      summary: {
        groups: -1,
        logs: 32,
        rect: { height: 18, width: 242, x: 510, y: 372 },
        text: "x",
        visibility: "visible",
      },
    };
    const problems = browserErrorLines({ error: unwrapErr(parseTargetObservation({ at: "before", value: bad })) });
    expect(problems).toEqual([
      "before.networkQuietMs is not a finite number",
      "before.summary counts must be non-negative integers",
      "before.chart.rect has no area (10x0)",
      "before.chart.visibility is 'hidden', not a visibility",
    ]);
  });

  it("refuses a chart with a rectangle and no visibility, and a summary with no rectangle", () => {
    const chartOnly = { ...observation(), chart: { ...(observation()["chart"] as object), visibility: null } };
    expect(browserErrorLines({ error: unwrapErr(parseTargetObservation({ at: "b", value: chartOnly })) })).toEqual([
      "b.chart.visibility is null while the chart is present",
    ]);
    const summaryOnly = {
      ...observation(),
      summary: { groups: 2, logs: 32, rect: null, text: "x", visibility: "visible" },
    };
    expect(browserErrorLines({ error: unwrapErr(parseTargetObservation({ at: "b", value: summaryOnly })) })).toEqual([
      "b.summary.rect is null on a present summary",
    ]);
  });

  it("refuses a non-object outright", () => {
    expect(browserErrorLines({ error: unwrapErr(parseTargetObservation({ at: "before", value: "ready" })) })).toEqual([
      "before is not an object",
    ]);
  });
});

describe("parseEvidenceCaptureResult", () => {
  it("reads a ready result", () => {
    const parsed = unwrap(parseEvidenceCaptureResult({ finalUrl: "https://ap1.datadoghq.com/logs", output: output() }));
    expect(parsed.readiness).toBe("ready");
    expect(parsed.geometry).toEqual({
      devicePixelRatio: 1.5,
      documentHeight: 3256,
      documentWidth: 2016,
      viewportHeight: 883,
      viewportWidth: 2016,
    });
    expect(parsed.polls).toBe(12);
    expect(parsed.after).not.toBe(null);
  });

  it("reads a timeout with no after-observation", () => {
    const parsed = unwrap(
      parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), after: null, readiness: "timeout" } }),
    );
    expect(parsed.readiness).toBe("timeout");
    expect(parsed.after).toBe(null);
  });

  it("reads the page-text walk, and reads an absent walk as none taken", () => {
    const walk = {
      nodes: [{ rect: { height: 18, width: 242, x: 510, y: 372 }, text: "2 service values found" }],
      opaque: [{ height: 100, width: 300, x: 0, y: 500 }],
      truncated: false,
    };
    const parsed = unwrap(parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), pageText: walk } }));
    expect(parsed.pageText).toEqual(walk);
    expect(unwrap(parseEvidenceCaptureResult({ finalUrl: "u", output: output() })).pageText).toBe(null);
  });

  it("refuses a walk it cannot vouch for rather than reading it as no text, each problem by path", () => {
    const walk = {
      nodes: [{ rect: { height: 18, width: 242, x: 510, y: 372 }, text: "" }],
      opaque: [null],
      truncated: "maybe",
    };
    const problems = browserErrorLines({
      error: unwrapErr(parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), pageText: walk } })),
    });
    expect(problems).toEqual([
      "pageText.truncated is not a boolean",
      "pageText.nodes[0].text is not a non-empty string",
      "pageText.opaque[0] is null where a box is required",
    ]);
    expect(
      browserErrorLines({
        error: unwrapErr(parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), pageText: "text" } })),
      }),
    ).toEqual(["pageText is not an object"]);
  });

  it("refuses an unknown readiness word, a ready result with no after, and a missing geometry", () => {
    expect(
      browserErrorLines({
        error: unwrapErr(parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), readiness: "probably" } })),
      }),
    ).toEqual(["readiness is 'probably', neither ready nor timeout"]);
    expect(
      browserErrorLines({
        error: unwrapErr(parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), after: null } })),
      }),
    ).toEqual(["a ready capture must carry an after-observation"]);
    expect(
      browserErrorLines({
        error: unwrapErr(parseEvidenceCaptureResult({ finalUrl: "u", output: { ...output(), geometry: null } })),
      }),
    ).toEqual(["geometry is not an object"]);
  });
});

describe("captureFromOutput", () => {
  it("refuses a page that settled off the lease, without a capture", () => {
    const stdout = JSON.stringify({ result: JSON.stringify({ ...output(), finalUrl: "https://login.example/" }) });
    const error = unwrapErr(
      captureFromOutput({
        lease: LEASE,
        screenshotPath: "/tmp/none.png",
        stdout,
        url: "https://ap1.datadoghq.com/logs",
      }),
    );
    expect(error.code).toBe("OFF_LEASE_ORIGIN");
  });

  it("carries a navigation failure the snippet reported", () => {
    const stdout = JSON.stringify({ result: JSON.stringify({ failure: "net::ERR_NAME_NOT_RESOLVED" }) });
    const error = unwrapErr(
      captureFromOutput({
        lease: LEASE,
        screenshotPath: "/tmp/none.png",
        stdout,
        url: "https://ap1.datadoghq.com/logs",
      }),
    );
    expect(error.code).toBe("NAVIGATION_FAILED");
    expect(error.message).toBe("could not navigate to https://ap1.datadoghq.com/logs: net::ERR_NAME_NOT_RESOLVED");
  });

  it("reports an untrustworthy result as the channel failing, naming the field", () => {
    const stdout = JSON.stringify({ result: JSON.stringify({ ...output(), polls: "many" }) });
    const error = unwrapErr(
      captureFromOutput({
        lease: LEASE,
        screenshotPath: "/tmp/none.png",
        stdout,
        url: "https://ap1.datadoghq.com/logs",
      }),
    );
    expect(error.code).toBe("SESSION_LOST");
    expect(error.message).toContain("result.polls is not a finite number");
  });

  it("returns the parsed result with no bytes when nothing was written", () => {
    const stdout = JSON.stringify({ result: JSON.stringify(output()) });
    const capture = unwrap(
      captureFromOutput({
        lease: LEASE,
        screenshotPath: "/tmp/none.png",
        stdout,
        url: "https://ap1.datadoghq.com/logs",
      }),
    );
    expect(capture.screenshotPng).toBe(null);
    expect(capture.result.title).toBe("Log Explorer | Datadog");
  });
});

describe("createEvidenceCaptureTransport, bound to a lease", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "evidence-transport-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses an address off its own origins before any client runs, and stays refused", async () => {
    const transport = createEvidenceCaptureTransport({
      deps: {
        chromePinPath: join(home, "no-such-pin"),
        extensionToken: "not-a-real-token",
        home,
        // A zero bound: one attempt, never a sleep.
        leaseWait: { clock: { nowMs: () => 0, sleep: () => Promise.resolve() }, emit: () => {}, timeoutSeconds: 0 },
        nowIso: () => "2026-09-13T01:00:00.000Z",
        origins: ["https://ap1.datadoghq.com"],
        platform: "browser shot",
        scratchDir: home,
      },
    });
    const first = unwrapErr(
      await transport.capture({ readinessTimeoutMs: 1000, target: TARGET, url: "https://linear.app/x" }),
    );
    expect(first.code).toBe("OFF_LEASE_ORIGIN");
    const second = unwrapErr(
      await transport.capture({ readinessTimeoutMs: 1000, target: TARGET, url: "https://ap1.datadoghq.com/logs" }),
    );
    expect(second.code).toBe("OFF_LEASE_ORIGIN");
    expect(unwrap(await transport.release())).toBe(null);
  });
});
