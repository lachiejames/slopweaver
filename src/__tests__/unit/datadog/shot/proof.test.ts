/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  isDatadogSignInWall,
  isSevenDayPreviewUrl,
  judgeWindowProof,
  previewSpanSeconds,
  SEVEN_DAYS_SECONDS,
} from "../../../../datadog/shot/proof.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const HOST = "ap1.datadoghq.com";
const PREVIEW = `https://${HOST}/api/ui/monitor/evaluation_preview`;

describe("previewSpanSeconds", () => {
  it("reads the span the console actually evaluated", () => {
    expect(previewSpanSeconds({ url: `${PREVIEW}?from=1788246000&to=1788850800` })).toBe(604800);
  });

  it("ignores a call that is not an evaluation preview", () => {
    expect(previewSpanSeconds({ url: `https://${HOST}/api/v1/monitor/600101` })).toBe(null);
  });

  it("ignores a preview whose bounds are not numbers", () => {
    expect(previewSpanSeconds({ url: `${PREVIEW}?from=now-7d&to=now` })).toBe(null);
  });

  it("ignores a preview with no bounds at all", () => {
    expect(previewSpanSeconds({ url: PREVIEW })).toBe(null);
  });

  it("ignores something that is not a URL", () => {
    expect(previewSpanSeconds({ url: "evaluation_preview" })).toBe(null);
  });
});

describe("isSevenDayPreviewUrl", () => {
  it("accepts an exact seven-day span", () => {
    expect(isSevenDayPreviewUrl({ url: `${PREVIEW}?from=0&to=604800` })).toBe(true);
  });

  it("accepts a span inside the rounding tolerance", () => {
    expect(isSevenDayPreviewUrl({ url: `${PREVIEW}?from=0&to=604759` })).toBe(true);
  });

  it("rejects a one-hour span, which is what the form defaults to", () => {
    expect(isSevenDayPreviewUrl({ url: `${PREVIEW}?from=0&to=3600` })).toBe(false);
  });

  it("rejects a span just outside the tolerance", () => {
    expect(isSevenDayPreviewUrl({ url: `${PREVIEW}?from=0&to=604739` })).toBe(false);
  });
});

describe("judgeWindowProof", () => {
  it("reports the strong proof when the console evaluated a seven-day window", () => {
    const judged = judgeWindowProof({ spans: [3600, SEVEN_DAYS_SECONDS] });
    expect(judged.isOk()).toBe(true);
    expect(unwrap(judged)).toBe("evaluation-preview");
  });

  it("falls back to the picker's own value when no preview was seen, rather than failing every capture", () => {
    const judged = judgeWindowProof({ spans: [] });
    expect(judged.isOk()).toBe(true);
    expect(unwrap(judged)).toBe("picker-value");
  });

  it("REFUSES when the console evaluated a window and it was not seven days", () => {
    const judged = judgeWindowProof({ spans: [3600, 7200] });
    expect(judged.isErr()).toBe(true);
    expect(unwrapErr(judged).code).toBe("PREVIEW_WINDOW_WRONG");
  });

  it("names the closest observed span, so the refusal says what the console did instead", () => {
    const judged = judgeWindowProof({ spans: [3600, 600000] });
    expect(unwrapErr(judged).message).toContain("600000s");
  });
});

describe("isDatadogSignInWall", () => {
  it("treats an identity provider on another host as the wall", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: "https://accounts.google.com/o/oauth2/v2/auth" })).toBe(true);
  });

  it("treats Datadog's own login path as the wall", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: `https://${HOST}/account/login?next=%2Fmonitors` })).toBe(
      true,
    );
  });

  it("treats the SAML hand-off as the wall", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: `https://${HOST}/account/saml/login` })).toBe(true);
  });

  it("does not treat a monitor edit page as the wall", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: `https://${HOST}/monitors/600101/edit` })).toBe(false);
  });

  it("does not treat a settings page as the wall — it is refused earlier, for a different reason", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: `https://${HOST}/account/settings` })).toBe(false);
  });

  it("treats a blank tab as off-console, since anything not on the console host is not the view", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: "about:blank" })).toBe(true);
  });

  it("reports an unparseable address as not-a-wall, leaving the view checks to speak", () => {
    expect(isDatadogSignInWall({ consoleHost: HOST, url: "monitors/600101/edit" })).toBe(false);
  });
});
