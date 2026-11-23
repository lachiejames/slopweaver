/**
 * The Datadog screenshot floor's pure half: what counts as citing Datadog, and what one picture buys.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import {
  datadogScreenshotAssessment,
  datadogScreenshotRefusal,
  isDatadogConsoleUrl,
} from "../../../../outbound/artifact/datadogCitation.js";

const LOGS = "https://ap1.datadoghq.com/logs?query=service%3Aapi";

describe("isDatadogConsoleUrl", () => {
  it("accepts a console page on any site and any path", () => {
    expect(isDatadogConsoleUrl({ url: LOGS })).toBe(true);
    expect(isDatadogConsoleUrl({ url: "https://app.datadoghq.com/monitors/123" })).toBe(true);
    expect(isDatadogConsoleUrl({ url: "https://app.datadoghq.eu/dashboard/abc" })).toBe(true);
  });

  it("refuses docs, a look-alike, the dead regional app host and a non-http scheme", () => {
    expect(isDatadogConsoleUrl({ url: "https://docs.datadoghq.com/logs/" })).toBe(false);
    expect(isDatadogConsoleUrl({ url: "https://ap1.datadoghq.com.evil.example/logs" })).toBe(false);
    expect(isDatadogConsoleUrl({ url: "https://app.ap1.datadoghq.com/logs" })).toBe(false);
    expect(isDatadogConsoleUrl({ url: "ftp://ap1.datadoghq.com/logs" })).toBe(false);
    expect(isDatadogConsoleUrl({ url: "not a url" })).toBe(false);
  });
});

describe("datadogScreenshotAssessment", () => {
  it("reads a link run, a bare URL in prose, a citation and a primaryLink", () => {
    const linkRun = { runs: [{ label: "the logs", type: "link", url: LOGS }] };
    const prose = { text: `the pool exhausted (${LOGS}).` };
    const citation = { citations: [{ label: "logs", url: LOGS }] };
    const primary = { primaryLink: { label: "logs", url: LOGS } };
    for (const value of [linkRun, prose, citation, primary]) {
      expect(datadogScreenshotAssessment({ pictureCount: 0, value })).toEqual({
        kind: "missing-screenshot",
        urls: [LOGS],
      });
    }
  });

  it("is shown with one picture", () => {
    expect(datadogScreenshotAssessment({ pictureCount: 1, value: { text: LOGS } })).toEqual({
      kind: "shown",
      urls: [LOGS],
    });
  });

  it("is not cited when the only Datadog URL sits in a citation's unrendered sourceRef", () => {
    const citation = { id: "c1", label: "[1]", sourceRef: { id: "x", source: LOGS }, url: "https://example.com/e" };
    expect(datadogScreenshotAssessment({ pictureCount: 0, value: { citations: [citation] } })).toEqual({
      kind: "not-cited",
    });
  });

  it("is not cited when the only Datadog URL is a citation's id, which the reader never sees", () => {
    const value = {
      citations: [{ id: LOGS, label: "[1]", url: "https://example.com/e" }],
      detail: [{ runs: [{ citationId: LOGS, type: "citation" }], type: "paragraph" }],
    };
    expect(datadogScreenshotAssessment({ pictureCount: 0, value })).toEqual({ kind: "not-cited" });
  });

  it("is not cited when the only Datadog URL is a docs page, or sits under images or media", () => {
    expect(
      datadogScreenshotAssessment({ pictureCount: 0, value: { text: "see https://docs.datadoghq.com/logs/" } }),
    ).toEqual({ kind: "not-cited" });
    expect(datadogScreenshotAssessment({ pictureCount: 0, value: { images: [LOGS] } })).toEqual({
      kind: "not-cited",
    });
    expect(datadogScreenshotAssessment({ pictureCount: 0, value: { media: [`/tmp/${LOGS}.png`] } })).toEqual({
      kind: "not-cited",
    });
  });

  it("names each cited URL once", () => {
    const value = { a: LOGS, b: [LOGS, "https://app.datadoghq.com/monitors/1"] };
    expect(datadogScreenshotAssessment({ pictureCount: 0, value })).toEqual({
      kind: "missing-screenshot",
      urls: [LOGS, "https://app.datadoghq.com/monitors/1"],
    });
  });
});

describe("datadogScreenshotRefusal", () => {
  it("names the first URL, how many more, the ruling and the caller's remedy", () => {
    const line = datadogScreenshotRefusal({ remedy: "pass it as `--media`", urls: [LOGS, "https://x"] });
    expect(line).toContain(`cites Datadog (${LOGS} and 1 more)`);
    expect(line).toContain("whenever Datadog is the subject");
    expect(line).toContain("pass it as `--media`, or take the Datadog link out");
  });
});
