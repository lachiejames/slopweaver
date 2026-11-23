import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import {
  captureZoomFor,
  EVIDENCE_TARGET_IDS,
  evidenceTargetLabel,
  inferEvidenceTarget,
  parseEvidenceTarget,
} from "../../../visualEvidence/evidenceTarget.js";

/** The incident's own address, on the synthetic `ap1` site rather than the install's own. */
const INCIDENT_URL =
  "https://ap1.datadoghq.com/logs?query=env%3Astaging%20%40err.code%3A%28P2024%20OR%20P2028%29&from_ts=1787962550000&to_ts=1789258550000&live=false&viz=timeseries&agg_m=count&agg_q=service";

describe("parseEvidenceTarget", () => {
  it("accepts the one closed id and spells it back", () => {
    const target = unwrap(parseEvidenceTarget({ text: "datadog-logs-v1:timeseries" }));
    expect(target).toEqual({ adapterId: "datadog-logs-v1", targetId: "timeseries" });
    expect(evidenceTargetLabel({ target })).toBe("datadog-logs-v1:timeseries");
    expect(EVIDENCE_TARGET_IDS).toContain("datadog-logs-v1:timeseries");
  });

  it("refuses a selector-shaped value, an unknown target and an unknown adapter, listing the set", () => {
    for (const text of ['[data-testid="sidebar"]', "datadog-logs-v1:sidebar", "datadog-metrics-v1:timeseries", ""]) {
      expect(visualEvidenceErrorLines({ error: unwrapErr(parseEvidenceTarget({ text })) })).toEqual([
        `--target '${text}' is not a target this build knows; the closed set is ${EVIDENCE_TARGET_IDS.join(", ")}`,
      ]);
    }
  });
});

describe("inferEvidenceTarget", () => {
  it("infers the Log Explorer timeseries from the incident's own address", () => {
    expect(inferEvidenceTarget({ url: INCIDENT_URL })).toEqual({
      adapterId: "datadog-logs-v1",
      targetId: "timeseries",
    });
  });

  it("covers every Datadog console host shape", () => {
    for (const host of [
      "app.datadoghq.com",
      "ap1.datadoghq.com",
      "us5.datadoghq.com",
      "app.datadoghq.eu",
      "eu1.datadoghq.eu",
    ]) {
      expect(inferEvidenceTarget({ url: `https://${host}/logs?viz=timeseries` })).toEqual({
        adapterId: "datadog-logs-v1",
        targetId: "timeseries",
      });
    }
  });

  it("does not infer the list view, another visualisation, another Datadog page, a lookalike host or a bad address", () => {
    expect(inferEvidenceTarget({ url: "https://ap1.datadoghq.com/logs?query=x" })).toBe(null);
    expect(inferEvidenceTarget({ url: "https://ap1.datadoghq.com/logs?viz=toplist" })).toBe(null);
    expect(inferEvidenceTarget({ url: "https://ap1.datadoghq.com/dashboard/abc?viz=timeseries" })).toBe(null);
    expect(inferEvidenceTarget({ url: "https://ap1.datadoghq.com.evil.example/logs?viz=timeseries" })).toBe(null);
    expect(inferEvidenceTarget({ url: "not a url" })).toBe(null);
  });
});

describe("the Trace Explorer target", () => {
  it("is inferred from an /apm/traces timeseries address", () => {
    const url =
      "https://ap1.datadoghq.com/apm/traces?query=service%3Ajobs-api&from_ts=1789472188368&to_ts=1789558588368" +
      "&live=false&viz=timeseries";
    expect(inferEvidenceTarget({ url })).toEqual({ adapterId: "datadog-apm-traces-v1", targetId: "timeseries" });
  });

  it("is not inferred from an /apm/traces LIST address, which no adapter covers", () => {
    const url = "https://ap1.datadoghq.com/apm/traces?query=service%3Ajobs-api&from_ts=1&to_ts=2&live=false";
    expect(inferEvidenceTarget({ url })).toBe(null);
  });

  it("parses from its --target spelling and is in the advertised set", () => {
    expect(unwrap(parseEvidenceTarget({ text: "datadog-apm-traces-v1:timeseries" }))).toEqual({
      adapterId: "datadog-apm-traces-v1",
      targetId: "timeseries",
    });
    expect(EVIDENCE_TARGET_IDS).toContain("datadog-apm-traces-v1:timeseries");
  });

  it("zooms both explorers out, because the window they share is 662 CSS pixels tall", () => {
    expect(captureZoomFor({ target: { adapterId: "datadog-apm-traces-v1", targetId: "timeseries" } })).toBe(0.7);
    expect(captureZoomFor({ target: { adapterId: "datadog-logs-v1", targetId: "timeseries" } })).toBe(0.7);
  });
});
