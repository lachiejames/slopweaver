/**
 * `shot monitor`'s judgement over one relay capture: the sign-in wall, the unsupported notice, the window
 * proof, a panel that never settled, the picker, and the counts — each the one refusal that applies.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import type { BacktestPanelFrame, MonitorBacktestObservation } from "../../../../browser/datadogMonitorBacktest.js";
import { cropMonitorPanel, judgeMonitorCapture } from "../../../../datadog/shot/monitorShot.js";
import { PAST_ONE_WEEK } from "../../../../datadog/shot/panelScript.js";

const HOST = "ap1.datadoghq.invalid";
const URL = `https://${HOST}/monitors/1000003/edit`;
const SEVEN_DAYS = `https://${HOST}/api/ui/monitor/evaluation_preview?from=1000&to=605800`;
const ONE_DAY = `https://${HOST}/api/ui/monitor/evaluation_preview?from=1000&to=87400`;
const PANEL_TEXT =
  "Monitor behavior with this threshold The monitor would have transitioned 24 times over Past 1 Week " +
  "12 Alert 0 Warn 12 Recover 0 No Data";
const PNG = new Uint8Array([1, 2, 3]);
/** The panel in a 100x50 CSS viewport — the owner's 75% zoom: painted at 1.5, captured at 2. */
const FRAME: BacktestPanelFrame = {
  devicePixelRatio: 1.5,
  rect: { height: 20, width: 30, x: 40, y: 20 },
  viewportHeight: 50,
  viewportWidth: 100,
};

const READY: MonitorBacktestObservation = {
  elapsedMs: 9_000,
  finalUrl: URL,
  frame: FRAME,
  frameAfter: FRAME,
  png: PNG,
  polls: 3,
  previewUrls: [SEVEN_DAYS],
  readiness: "ready",
  reading: { alertBoxed: true, marked: true, panelText: PANEL_TEXT, pickerValue: PAST_ONE_WEEK, unmet: [] },
  screenshotError: null,
  title: "Monitor",
  windowError: null,
};

/** Judge one variant of the ready capture. */
function judge(overrides: Partial<MonitorBacktestObservation>): ReturnType<typeof judgeMonitorCapture> {
  return judgeMonitorCapture({ consoleHost: HOST, monitorId: "1000003", observation: { ...READY, ...overrides } });
}

describe("judgeMonitorCapture", () => {
  it("passes a settled seven-day capture with its counts and the network proof", () => {
    const judged = unwrap(judge({}));
    expect(judged.proof).toBe("evaluation-preview");
    expect(judged.reading).toStrictEqual({ alert: 12, noData: 0, recover: 12, transitions: 24, warn: 0 });
    expect(judged.png).toBe(PNG);
    expect(judged.frame).toStrictEqual(FRAME);
  });

  it("refuses a capture whose panel position was not read on both sides of the shutter", () => {
    const failed = unwrapErr(judge({ frameAfter: null }));
    expect(failed.code).toBe("PANEL_CROP_REFUSED");
  });

  it("refuses a capture whose panel moved while the shutter was open", () => {
    const moved = { ...FRAME, rect: { ...FRAME.rect, y: FRAME.rect.y + 5 } };
    const failed = unwrapErr(judge({ frameAfter: moved }));
    expect(failed.code).toBe("PANEL_CROP_REFUSED");
    expect(failed.message).toContain("moved");
  });

  it("refuses the console's own sign-in page as a capture that did not happen", () => {
    const failed = unwrapErr(judge({ finalUrl: `https://${HOST}/account/login?next=x` }));
    expect(failed.code).toBe("CAPTURE_FAILED");
    expect(failed.message).toContain("not signed in");
  });

  it("names a query Datadog cannot backtest rather than reporting a timeout", () => {
    const failed = unwrapErr(judge({ png: null, readiness: "unsupported", reading: null }));
    expect(failed.code).toBe("BACKTEST_UNSUPPORTED");
    expect(failed.message).toContain("1000003");
  });

  it("refuses a capture the console evaluated over another window, before anything else", () => {
    expect(unwrapErr(judge({ previewUrls: [ONE_DAY] })).code).toBe("PREVIEW_WINDOW_WRONG");
    expect(unwrapErr(judge({ previewUrls: [ONE_DAY], readiness: "timeout" })).code).toBe("PREVIEW_WINDOW_WRONG");
  });

  it("falls back to the picker's own value when the console issued no preview it could read", () => {
    expect(unwrap(judge({ previewUrls: [] })).proof).toBe("picker-value");
  });

  it("refuses a wait that ended short of ready, naming what the last pass still lacked", () => {
    const failed = unwrapErr(
      judge({
        png: null,
        readiness: "timeout",
        reading: {
          alertBoxed: false,
          marked: false,
          panelText: null,
          pickerValue: PAST_ONE_WEEK,
          unmet: ["the SVG chart"],
        },
      }),
    );
    expect(failed.code).toBe("PANEL_NEVER_SETTLED");
    expect(failed.message).toContain("the SVG chart");
  });

  it("refuses a ready panel whose screenshot never landed", () => {
    const failed = unwrapErr(judge({ png: null, screenshotError: "Timeout 8000ms" }));
    expect(failed.code).toBe("PANEL_NEVER_SETTLED");
    expect(failed.message).toContain("Timeout 8000ms");
  });

  it("refuses a picture taken over another window even when the page called it ready", () => {
    const reading = { alertBoxed: true, marked: true, panelText: PANEL_TEXT, pickerValue: "Past 1 Month", unmet: [] };
    expect(unwrapErr(judge({ previewUrls: [], reading })).code).toBe("PANEL_NEVER_SETTLED");
  });

  it("refuses a panel whose text carries no counts, as the reading's own typed error", () => {
    const reading = { alertBoxed: true, marked: true, panelText: "Loading…", pickerValue: PAST_ONE_WEEK, unmet: [] };
    expect(unwrapErr(judge({ reading })).code).toBe("PANEL_UNREADABLE");
  });
});

/** A white 200x100 viewport capture — twice the 100x50 frame, as the owner's Chrome returns it. */
async function viewportPng(): Promise<Uint8Array> {
  const image = new Jimp({ color: 0xffffffff, height: 100, width: 200 });
  return new Uint8Array(await image.getBuffer("image/png"));
}

describe("cropMonitorPanel", () => {
  it("cuts at the page's paint scale, not the image's size ratio, so the zoom cannot offset it", async () => {
    const cropped = unwrap(await cropMonitorPanel({ frame: FRAME, png: await viewportPng() }));
    const image = await Jimp.fromBuffer(Buffer.from(cropped));
    // (40-12)*1.5=42 .. (70+12)*1.5=123 wide; (20-12)*1.5=12 .. (40+12)*1.5=78 tall. At 2 it would be 108x80.
    expect({ height: image.height, width: image.width }).toStrictEqual({ height: 66, width: 81 });
  });

  it("refuses a panel that does not lie wholly inside the viewport rather than cutting it short", async () => {
    const offscreen = { ...FRAME, rect: { ...FRAME.rect, y: 40 } };
    const failed = unwrapErr(await cropMonitorPanel({ frame: offscreen, png: await viewportPng() }));
    expect(failed.code).toBe("PANEL_CROP_REFUSED");
  });

  it("refuses bytes that are not a picture", async () => {
    expect(unwrapErr(await cropMonitorPanel({ frame: FRAME, png: PNG })).code).toBe("PANEL_CROP_REFUSED");
  });
});
