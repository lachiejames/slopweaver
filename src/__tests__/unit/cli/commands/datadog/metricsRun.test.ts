import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exitCodeForMetricsBucketCount,
  type MetricsReport,
  renderMetricsJson,
  renderMetricsText,
  runDatadogMetrics,
} from "../../../../../cli/commands/datadog/metricsRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

const REPORT: MetricsReport = {
  outcome: "matched",
  site: "us3.datadoghq.com",
  query: "sum:example.metric{*} by {delivery_status}.as_count()",
  by: ["delivery_status"],
  buckets: [
    { by: { delivery_status: "failed" }, count: 12 },
    { by: { delivery_status: "delivered" }, count: 340 },
  ],
  truncated: false,
  fromMs: 1_785_000_000_000,
  toMs: 1_785_000_900_000,
};

describe("exitCodeForMetricsBucketCount", () => {
  it("returns EXIT_OK for at least one bucket", () => {
    expect(exitCodeForMetricsBucketCount({ bucketCount: 1 })).toBe(EXIT_OK);
  });

  it("returns EXIT_EXPECTED_EMPTY for a genuine zero", () => {
    expect(exitCodeForMetricsBucketCount({ bucketCount: 0 })).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("renderMetricsText", () => {
  it("renders every bucket with its tags and count", () => {
    const text = renderMetricsText({ report: REPORT });
    expect(text).toContain("datadog metrics: 2 bucket(s)");
    expect(text).toContain("by      delivery_status");
    expect(text).toContain("  12  delivery_status=failed");
    expect(text).toContain("  340  delivery_status=delivered");
  });

  it("names an ungrouped query when --by was empty", () => {
    const text = renderMetricsText({ report: { ...REPORT, by: [] } });
    expect(text).toContain("by      (ungrouped)");
  });

  it("flags a truncated result", () => {
    const text = renderMetricsText({ report: { ...REPORT, truncated: true } });
    expect(text).toContain("(truncated — raise --limit)");
  });
});

describe("renderMetricsJson", () => {
  it("round-trips the report through JSON", () => {
    expect(JSON.parse(renderMetricsJson({ report: REPORT }))).toEqual(REPORT);
  });
});

describe("runDatadogMetrics", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    const code = await runDatadogMetrics(["node", "slopweaver", "datadog", "metrics", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("requires --query, exiting EXIT_USAGE before touching credentials", async () => {
    const code = await runDatadogMetrics(["node", "slopweaver", "datadog", "metrics"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable window with EXIT_USAGE", async () => {
    const code = await runDatadogMetrics([
      "node",
      "slopweaver",
      "datadog",
      "metrics",
      "--query",
      "q",
      "--from",
      "yesterday",
    ]);
    expect(code).toBe(EXIT_USAGE);
  });

  describe("with credentials genuinely absent", () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const name of CREDENTIAL_VARS) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
    });
    afterEach(() => {
      for (const name of CREDENTIAL_VARS) {
        const value = saved[name];
        if (value !== undefined) {
          process.env[name] = value;
        }
      }
    });

    it("exits EXIT_EXPECTED_EMPTY", async () => {
      const code = await runDatadogMetrics(["node", "slopweaver", "datadog", "metrics", "--query", "q", "--json"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
