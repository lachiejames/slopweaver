/*
 * What `browser shot` prints for each outcome: a raw photograph, an evidence capture's measured facts and its
 * read-back instruction, a not-ready target's issues, a settled-elsewhere page, and each way a capture stops short.
 */
import { describe, expect, it } from "vitest";

import { renderShotReport, type ShotReport } from "../../../../../../cli/commands/browser/shotCore.js";

describe("renderShotReport", () => {
  const base: ShotReport = {
    because: null,
    bytes: null,
    evidence: null,
    finalUrl: null,
    outcome: "photographed",
    path: null,
    statusCode: null,
    title: null,
    url: "https://example.com/",
  };

  it("names the outcome on the success line and reports the bytes", () => {
    const lines = renderShotReport({
      report: { ...base, bytes: 40551, finalUrl: "https://example.com/", path: "/tmp/a.png", title: "Example Domain" },
    });
    expect(lines).toEqual([
      "browser shot: photographed — https://example.com/",
      "  title: Example Domain",
      "  wrote 40551 byte(s) to /tmp/a.png",
      "  raw profile: this picture carries no record, so no outbound form will attach it",
    ]);
  });

  it("renders an evidence capture's measured facts, one per line, ending in the read-back instruction", () => {
    const lines = renderShotReport({
      report: {
        ...base,
        bytes: 300136,
        evidence: {
          captureId: "cap-a0a5d6d463573811",
          cropRect: "2772x1294 at 246,48 of the raw (scale 1.50)",
          elapsedMs: 7515,
          finalDigest: "sha256:a0a5",
          finalSize: "2772x1510",
          issues: [],
          legibility: "7.6px smallest feature once fitted to slack-desktop-expanded-v1 — passes",
          rawPath: "/tmp/evidence.raw.png",
          rawSize: "4032x1766",
          summary: "0 service values found ( based on 0 logs )",
          target: "datadog-logs-v1:timeseries",
          targetState: "zero-results",
          timeRange: "Aug 29, 10:15 am – Sep 13, 10:15 am",
        },
        finalUrl: "https://example.com/",
        outcome: "captured",
        path: "/tmp/evidence.png",
      },
    });
    expect(lines).toEqual([
      "browser shot: captured — https://example.com/",
      "  wrote 300136 byte(s) to /tmp/evidence.png",
      "  target: datadog-logs-v1:timeseries",
      "  state: zero-results",
      "  summary: 0 service values found ( based on 0 logs )",
      "  time range: Aug 29, 10:15 am – Sep 13, 10:15 am",
      "  waited: 7515ms",
      "  raw: 4032x1766 at /tmp/evidence.raw.png",
      "  crop: 2772x1294 at 246,48 of the raw (scale 1.50)",
      "  final: 2772x1510",
      "  digest: sha256:a0a5",
      "  legibility: 7.6px smallest feature once fitted to slack-desktop-expanded-v1 — passes",
      "  capture record: cap-a0a5d6d463573811",
      "  readback-pending: open the final PNG, then `slopweaver browser image-record --form <json>` naming " +
        "captureId cap-a0a5d6d463573811 — no outbound form attaches it before that",
    ]);
  });

  it("renders a not-ready capture's issues with a bang and no read-back instruction", () => {
    const lines = renderShotReport({
      report: {
        ...base,
        because: "the target was not ready after 2909ms: the target's own element is not on the page",
        evidence: {
          captureId: null,
          cropRect: null,
          elapsedMs: 2909,
          finalDigest: null,
          finalSize: null,
          issues: ["the target's own element is not on the page"],
          legibility: null,
          rawPath: null,
          rawSize: null,
          summary: null,
          target: "datadog-logs-v1:timeseries",
          targetState: "unloaded",
          timeRange: null,
        },
        outcome: "target-not-ready",
      },
    });
    expect(lines).toEqual([
      "browser shot: target-not-ready — https://example.com/",
      "  the target was not ready after 2909ms: the target's own element is not on the page",
      "  target: datadog-logs-v1:timeseries",
      "  state: unloaded",
      "  waited: 2909ms",
      "  ! the target's own element is not on the page",
    ]);
  });

  it("reports where a page settled when that differs from the address asked for", () => {
    const lines = renderShotReport({
      report: {
        ...base,
        because: "https://sso.example.invalid/login is outside the origins this walk's relay lease binds it to",
        finalUrl: "https://sso.example.invalid/login",
        outcome: "off-lease-origin",
      },
    });
    expect(lines[0]).toBe("browser shot: off-lease-origin — https://example.com/");
    expect(lines[1]).toBe("  settled on https://sso.example.invalid/login");
  });

  it("names a capture that reached the page and came back with no picture", () => {
    const lines = renderShotReport({
      report: {
        ...base,
        because: "the page was reached and described, but the browser returned no picture for it",
        finalUrl: "https://example.com/",
        outcome: "reached-not-photographed",
      },
    });
    expect(lines).toEqual([
      "browser shot: reached-not-photographed — https://example.com/",
      "  the page was reached and described, but the browser returned no picture for it",
    ]);
  });

  it("prints a kept raw picture whose size was never measured with a question mark for the size", () => {
    const lines = renderShotReport({
      report: {
        ...base,
        evidence: {
          captureId: null,
          cropRect: null,
          elapsedMs: null,
          finalDigest: null,
          finalSize: null,
          issues: [],
          legibility: null,
          rawPath: "/tmp/evidence.raw.png",
          rawSize: null,
          summary: null,
          target: "datadog-logs-v1:timeseries",
          targetState: null,
          timeRange: null,
        },
        outcome: "crop-refused",
      },
    });
    expect(lines).toEqual([
      "browser shot: crop-refused — https://example.com/",
      "  target: datadog-logs-v1:timeseries",
      "  raw: ? at /tmp/evidence.raw.png",
    ]);
  });

  it("names a relay held by something else", () => {
    const lines = renderShotReport({
      report: { ...base, because: "another browser walk is driving the owner's Chrome", outcome: "relay-unavailable" },
    });
    expect(lines).toEqual([
      "browser shot: relay-unavailable — https://example.com/",
      "  another browser walk is driving the owner's Chrome",
    ]);
  });
});
