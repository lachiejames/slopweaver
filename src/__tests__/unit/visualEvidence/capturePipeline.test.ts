/**
 * The whole processing sequence over a synthetic capture: a 200x100 CSS frame painted at 2 into a
 * 400x200 PNG, with a drawn "chart" and three context boxes, run through real Jimp — crop, frame, caption,
 * re-decode — and every refusing arm reached with one fixture changed. Every Datadog host in this file reads a
 * synthetic site rather than the install's own.
 */
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  captionSafe,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OFFSET_PX,
  HIGHLIGHT_STROKE_PX,
} from "../../../visualEvidence/annotate.js";
import { processEvidenceCapture } from "../../../visualEvidence/capturePipeline.js";
import { captionLinesFor } from "../../../visualEvidence/evidenceCaption.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import type { EvidenceCaptureResult, TargetObservation } from "../../../visualEvidence/observation.js";

const TARGET = { adapterId: "datadog-logs-v1", targetId: "timeseries" } as const;
const WHITE = 0xffffffff;
const BLUE = 0x3b82f6ff;

/** The observation, in a 200x100 CSS viewport: chart at 40,40 120x50; summary above it; query and time on top. */
const OBSERVATION: TargetObservation = {
  chart: {
    canvasCount: 1,
    inkError: null,
    inkSamples: 500,
    rect: { height: 50, width: 120, x: 40, y: 40 },
    sampledPixels: 6000,
    visibility: "visible",
  },
  document: { height: 300, width: 200 },
  networkQuietMs: 3000,
  observedAtMs: 4000,
  progressIndicators: 0,
  query: {
    rect: { height: 10, width: 150, x: 20, y: 14 },
    text: "env:staging @err.code:(P2024 OR P2028)",
    visibility: "visible",
  },
  scroll: { x: 0, y: 30 },
  smallestFontPx: 10,
  summary: {
    groups: 2,
    logs: 32,
    rect: { height: 8, width: 60, x: 40, y: 28 },
    text: "2 service values found ( based on 32 logs )",
    visibility: "visible",
  },
  targetMatches: 1,
  targetRect: { height: 70, width: 140, x: 30, y: 25 },
  timeRange: { rect: { height: 8, width: 50, x: 140, y: 4 }, text: "Aug 29 – Sep 13", visibility: "visible" },
  viewport: { height: 100, width: 200 },
};

const RESULT: EvidenceCaptureResult = {
  after: OBSERVATION,
  before: OBSERVATION,
  elapsedMs: 4200,
  finalUrl: "https://ap1.datadoghq.com/logs?viz=timeseries",
  geometry: { devicePixelRatio: 2, documentHeight: 300, documentWidth: 200, viewportHeight: 100, viewportWidth: 200 },
  // The query and the summary sit inside the crop; the 5x5 node at the corner falls in the 8 CSS px the crop leaves off.
  pageText: {
    nodes: [
      { rect: { height: 10, width: 150, x: 20, y: 14 }, text: "env:staging @err.code:(P2024 OR P2028)" },
      { rect: { height: 8, width: 60, x: 40, y: 28 }, text: "2 service values found ( based on 32 logs )" },
      { rect: { height: 5, width: 5, x: 0, y: 0 }, text: "outside" },
    ],
    opaque: [],
    truncated: false,
  },
  polls: 8,
  readiness: "ready",
  screenshotError: null,
  screenshotWritten: true,
  title: "Log Explorer | Datadog",
};

/** A 400x200 white PNG with bars drawn inside the chart's image rectangle (80,80 240x100) unless told not to. */
async function framePng({ drawChart }: { drawChart: boolean }): Promise<Uint8Array> {
  const image = new Jimp({ color: WHITE, height: 200, width: 400 });
  if (drawChart) {
    for (let x = 90; x < 310; x += 20) {
      for (let y = 100; y < 170; y += 1) {
        for (let dx = 0; dx < 8; dx += 1) {
          image.setPixelColor(BLUE, x + dx, y);
        }
      }
    }
  }
  return new Uint8Array(await image.getBuffer("image/png"));
}

describe("processEvidenceCapture", () => {
  it("crops to the padded union, frames the chart outside its pixels, captions below, and measures the final bytes", async () => {
    const png = await framePng({ drawChart: true });
    const processed = unwrap(
      await processEvidenceCapture({
        capturedAtIso: "2026-09-13T01:34:36.672Z",
        lead: null,
        result: RESULT,
        screenshotPng: png,
        target: TARGET,
      }),
    );
    // Union of the four regions: x 20..190, y 4..90; padded by 12 CSS and clamped: x 8..200, y 0..100 -> at 2: 16..400, 0..200
    expect(processed.crop.rect).toEqual({ height: 200, width: 384, x: 16, y: 0 });
    expect(processed.crop.scale).toBe(2);
    expect(processed.crop.artifact.widthPx).toBe(384);
    expect(processed.crop.artifact.heightPx).toBe(200);
    expect(processed.crop.panelInkRowFraction).toBeCloseTo(0.7, 2);
    expect(processed.raw.artifact.digest).toBe(imageDigestOf({ bytes: png }));
    expect(processed.final.artifact.widthPx).toBe(384);
    expect(processed.final.artifact.heightPx).toBeGreaterThan(200);
    expect(processed.final.artifact.digest).toBe(imageDigestOf({ bytes: processed.final.bytes }));
    expect(processed.final.ops.map((op) => op.kind)).toEqual(["highlight", "caption"]);
    expect(processed.captionLines).toEqual([
      "2 service values found ( based on 32 logs ) · Aug 29 – Sep 13",
      "query: env:staging @err.code:(P2024 OR P2028)",
      "captured 2026-09-13T01:34:36.672Z from ap1.datadoghq.com by slopweaver browser shot",
    ]);
    // The frame sits OUTSIDE the chart rectangle (relative to the crop: 80-16=64, 80 -> 64..304, 80..180).
    const final = await Jimp.fromBuffer(Buffer.from(processed.final.bytes));
    const gap = HIGHLIGHT_OFFSET_PX;
    const stroke = HIGHLIGHT_STROKE_PX;
    expect(final.getPixelColor(64 - gap - 1, 130)).toBe(HIGHLIGHT_COLOR);
    expect(final.getPixelColor(64 - gap - stroke, 130)).toBe(HIGHLIGHT_COLOR);
    expect(final.getPixelColor(64 - gap - stroke - 1, 130)).toBe(WHITE);
    expect(final.getPixelColor(64, 130)).toBe(WHITE);
    expect(final.getPixelColor(90 - 16 + 2, 130)).toBe(BLUE);
    // Legibility: 10px CSS at 2 = 20px feature, judged on the FINAL bytes — the caption band wraps the long
    // title in a 384-wide image and makes it taller than the box, so the fit is the height's.
    expect(processed.legibility.featurePx).toBe(20);
    expect(processed.legibility.projectedPx).toBeCloseTo((20 * 900) / processed.final.artifact.heightPx, 6);
    expect(processed.legibility.issues).toEqual([]);
    expect(processed.legibility.profile).toBe("slack-desktop-expanded-v1");
  });

  it("records the frame text: the page nodes the crop shows, in crop pixels, then one item per caption line", async () => {
    const processed = unwrap(
      await processEvidenceCapture({
        capturedAtIso: "2026-09-13T01:34:36.672Z",
        lead: null,
        result: RESULT,
        screenshotPng: await framePng({ drawChart: true }),
        target: TARGET,
      }),
    );
    expect(processed.frameText.kind).toBe("exact");
    expect(processed.frameText.origin).toBe("page-visible-text");
    // Query at CSS 20,14 150x10, at 2 and less the crop's 16,0 origin: 24,28 300x20. Summary likewise: 64,56 120x16.
    expect(processed.frameText.items.slice(0, 2)).toEqual([
      { rect: { height: 20, width: 300, x: 24, y: 28 }, text: "env:staging @err.code:(P2024 OR P2028)" },
      { rect: { height: 16, width: 120, x: 64, y: 56 }, text: "2 service values found ( based on 32 logs )" },
    ]);
    // The caption as DRAWN: the en dash the bitmap font cannot draw is recorded as the hyphen the pixels carry.
    expect(processed.frameText.items.slice(2).map((item) => item.text)).toEqual([
      "2 service values found ( based on 32 logs ) · Aug 29 - Sep 13",
      "query: env:staging @err.code:(P2024 OR P2028)",
      "captured 2026-09-13T01:34:36.672Z from ap1.datadoghq.com by slopweaver browser shot",
    ]);
    expect(processed.frameText.items[2]!.rect.y).toBe(200);
    expect(processed.frameText.items[3]!.rect.y).toBeGreaterThan(200);
  });

  it("marks the frame text incomplete when the page reported no walk, or an iframe sits in the crop", async () => {
    const png = await framePng({ drawChart: true });
    const unwalked = unwrap(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: { ...RESULT, pageText: null },
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(unwalked.frameText).toEqual({
      items: unwalked.frameText.items,
      kind: "incomplete",
      origin: "page-visible-text",
      reasons: ["the capture reported no walk of the page's visible text"],
    });
    expect(unwalked.frameText.items.map((item) => item.text)).toEqual(
      unwalked.captionLines.map((text) => captionSafe({ text })),
    );
    const framed = unwrap(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: {
          ...RESULT,
          pageText: { nodes: [], opaque: [{ height: 20, width: 20, x: 50, y: 50 }], truncated: true },
        },
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(framed.frameText).toEqual({
      items: framed.frameText.items,
      kind: "incomplete",
      origin: "page-visible-text",
      reasons: [
        "the page held more text nodes than the capture walks, so the rest were not read",
        "an iframe or shadow root sits inside the crop, and its text is not readable from the page",
      ],
    });
  });

  it("puts a caller's lead line first", async () => {
    const png = await framePng({ drawChart: true });
    const processed = unwrap(
      await processEvidenceCapture({
        capturedAtIso: "2026-09-13T01:34:36.672Z",
        lead: "pool errors by service",
        result: RESULT,
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(processed.captionLines[0]).toBe("pool errors by service");
    expect(processed.captionLines.length).toBe(4);
  });

  it("refuses a capture the snippet timed out on, carrying Node's own issues", async () => {
    const png = await framePng({ drawChart: true });
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: { ...RESULT, after: null, before: { ...OBSERVATION, progressIndicators: 1 }, readiness: "timeout" },
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(error.code).toBe("TARGET_NOT_READY");
    expect(error.message).toBe("the target was not ready after 4200ms: 1 loading indicator(s) inside the target");
  });

  it("re-judges a snippet that said ready over an observation Node refuses — the incident's shape", async () => {
    const png = await framePng({ drawChart: true });
    const incident = { ...OBSERVATION, chart: { ...OBSERVATION.chart, inkSamples: 0 } };
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: { ...RESULT, after: incident, before: incident },
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(error.code).toBe("TARGET_NOT_READY");
    expect(error.message).toContain("an empty panel its own summary contradicts");
  });

  it("refuses a ready capture with no bytes, naming the browser's reason", async () => {
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: { ...RESULT, screenshotError: "Timeout 8000ms exceeded", screenshotWritten: false },
        screenshotPng: null,
        target: TARGET,
      }),
    );
    expect(error).toEqual({ code: "NOT_PHOTOGRAPHED", message: "Timeout 8000ms exceeded" });
  });

  it("refuses a page that moved between the two observations", async () => {
    const png = await framePng({ drawChart: true });
    const moved = { ...OBSERVATION, chart: { ...OBSERVATION.chart, rect: { height: 50, width: 120, x: 40, y: 60 } } };
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: { ...RESULT, after: moved },
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(error.code).toBe("PAGE_MOVED");
    expect(error.message).toBe(
      "the page changed during the capture: the chart moved, resized or disappeared during the capture",
    );
  });

  it("refuses a chart whose pixels are blank even though the page reported ink — the second witness", async () => {
    const png = await framePng({ drawChart: false });
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: RESULT,
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(error.code).toBe("PANEL_BLANK");
    expect(error.message).toBe("only 0.0% of the chart's own rows carry ink in the raw pixels; 5% is the floor");
  });

  it("refuses bytes that are not an image", async () => {
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: RESULT,
        screenshotPng: new Uint8Array([1, 2, 3]),
        target: TARGET,
      }),
    );
    expect(error.code).toBe("IMAGE_UNDECODABLE");
  });

  it("refuses an image smaller than the frame at the page's paint scale", async () => {
    const png = await framePng({ drawChart: true });
    const error = unwrapErr(
      await processEvidenceCapture({
        capturedAtIso: "x",
        lead: null,
        result: { ...RESULT, geometry: { ...RESULT.geometry, devicePixelRatio: 3 } },
        screenshotPng: png,
        target: TARGET,
      }),
    );
    expect(error.code).toBe("CROP_REFUSED");
    expect(error.message).toBe(
      "no crop could be taken: a 200x100 frame painted at 3 needs at least 600x300 image pixels; the capture is 400x200",
    );
  });
});

describe("captionLinesFor and captionSafe", () => {
  it("cuts an over-long line with an ellipsis rather than refusing the capture", () => {
    const long = { ...OBSERVATION, query: { ...OBSERVATION.query!, text: "x".repeat(300) } };
    const lines = captionLinesFor({
      capturedAtIso: "t",
      finalUrl: "https://a.example/",
      lead: null,
      observation: long,
    });
    expect(lines[1]!.length).toBe(240);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  it("names a missing summary and query rather than printing nothing", () => {
    const bare = { ...OBSERVATION, query: null, summary: null, timeRange: null };
    expect(captionLinesFor({ capturedAtIso: "t", finalUrl: "not a url", lead: null, observation: bare })).toEqual([
      "no results summary",
      "query: query not read",
      "captured t from not a url by slopweaver browser shot",
    ]);
  });

  it("replaces what the bitmap font cannot draw — the en dash and the word joiner the live page printed as ?", () => {
    expect(captionSafe({ text: "Aug 29 – Sep 13 · env:staging⁠ @err" })).toBe("Aug 29 - Sep 13 · env:staging @err");
    expect(captionSafe({ text: "“quoted” — ‘single’ ✓" })).toBe("\"quoted\" - 'single' ?");
  });
});
