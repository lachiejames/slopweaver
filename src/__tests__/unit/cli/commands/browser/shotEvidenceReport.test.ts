/*
 * The pure builders behind the evidence profile's report: the empty evidence block, the raw path kept beside
 * `--out`, and which named outcome each processing refusal reports.
 */
import { describe, expect, it } from "vitest";

import {
  emptyEvidence,
  outcomeForProcessing,
  rawPathFor,
} from "../../../../../cli/commands/browser/shotEvidenceReport.js";
import { EvidenceProcessingErrors } from "../../../../../visualEvidence/capturePipeline.js";

describe("emptyEvidence", () => {
  it("carries the target and leaves every observed field empty", () => {
    expect(emptyEvidence({ target: "datadog-logs-v1:timeseries" })).toEqual({
      captureId: null,
      cropRect: null,
      elapsedMs: null,
      finalDigest: null,
      finalSize: null,
      issues: [],
      legibility: null,
      rawPath: null,
      rawSize: null,
      summary: null,
      target: "datadog-logs-v1:timeseries",
      targetState: null,
      timeRange: null,
    });
  });
});

describe("rawPathFor", () => {
  it("keeps the raw capture beside the final PNG", () => {
    expect(rawPathFor({ out: "/work/evidence.png" })).toBe("/work/evidence.raw.png");
  });

  it("leaves a path with no .png suffix unchanged", () => {
    expect(rawPathFor({ out: "/work/evidence.jpeg" })).toBe("/work/evidence.jpeg");
  });
});

describe("outcomeForProcessing", () => {
  it("names a target that never became ready", () => {
    const error = EvidenceProcessingErrors.targetNotReady({ elapsedMs: 4200, issues: [] });
    expect(outcomeForProcessing({ error })).toBe("target-not-ready");
  });

  it("names a page that was reached but not photographed", () => {
    const error = EvidenceProcessingErrors.notPhotographed({ reason: null });
    expect(outcomeForProcessing({ error })).toBe("reached-not-photographed");
  });

  it("names a page that moved during the capture", () => {
    const error = EvidenceProcessingErrors.pageMoved({ issues: ["the scroll offset changed"] });
    expect(outcomeForProcessing({ error })).toBe("page-moved");
  });

  it("reports every other refusal as crop-refused", () => {
    const error = EvidenceProcessingErrors.panelBlank({ inkRowFraction: 0.01 });
    expect(outcomeForProcessing({ error })).toBe("crop-refused");
  });
});
