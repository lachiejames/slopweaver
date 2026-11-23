import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exitCodeForProbeCount,
  type ProbeReport,
  renderProbeJson,
  renderProbeText,
  runDatadogProbe,
} from "../../../../../cli/commands/datadog/probeRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

const REPORT: ProbeReport = {
  outcome: "matched",
  site: "us3.datadoghq.com",
  query: "service:example-api status:error",
  metric: null,
  count: 7,
  fromMs: 1_785_000_000_000,
  toMs: 1_785_000_900_000,
  link: "https://us3.datadoghq.com/logs?query=service%3Aexample-api&from_ts=1785000000000&to_ts=1785000900000&live=false",
  rateLimit: "logs_public_analytics_aggregate: 2 per 10s, 1 left, resets in 9s",
  envVerdict: null,
};

describe("exitCodeForProbeCount", () => {
  it("returns EXIT_OK for a non-zero count", () => {
    expect(exitCodeForProbeCount({ count: 1 })).toBe(EXIT_OK);
  });

  it("returns EXIT_EXPECTED_EMPTY for a genuine zero", () => {
    expect(exitCodeForProbeCount({ count: 0 })).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("renderProbeText", () => {
  it("renders a matched outcome with the count and link", () => {
    const text = renderProbeText({ report: REPORT });
    expect(text).toContain("Datadog answered: 7 logs matched");
    expect(text).toContain("query   service:example-api status:error");
    expect(text).toContain(`link    ${REPORT.link}`);
    expect(text).toContain(`limit   ${REPORT.rateLimit}`);
  });

  it("renders an empty outcome distinctly from a matched one", () => {
    const text = renderProbeText({ report: { ...REPORT, outcome: "empty", count: 0 } });
    expect(text).toContain("the count is 0 — the query reached Datadog and nothing matched");
  });

  it("omits the limit line when no rate-limit budget was observed", () => {
    const text = renderProbeText({ report: { ...REPORT, rateLimit: null } });
    expect(text).not.toContain("limit   ");
  });

  it("describes a sum rather than a count when --sum-metric was used", () => {
    const text = renderProbeText({ report: { ...REPORT, metric: "@violations", count: 42 } });
    expect(text).toContain("Datadog answered: 42 summed over '@violations'");
  });

  it("describes an empty sum distinctly from an empty count", () => {
    const text = renderProbeText({ report: { ...REPORT, metric: "@violations", outcome: "empty", count: 0 } });
    expect(text).toContain("the sum is 0 — the query reached Datadog and nothing matched");
  });

  it("renders the env verdict line when --verify-env was requested", () => {
    const text = renderProbeText({
      report: {
        ...REPORT,
        envVerdict: { verdict: "prod", prod: 90, nonProd: 10, untagged: 0, total: 100, reasons: [] },
      },
    });
    expect(text).toContain("env     prod (90 prod / 100 total)");
  });

  it("omits the env line when --verify-env was not requested", () => {
    expect(renderProbeText({ report: REPORT })).not.toContain("env     ");
  });
});

describe("renderProbeJson", () => {
  it("round-trips the report through JSON with outcome as a field", () => {
    expect(JSON.parse(renderProbeJson({ report: REPORT }))).toEqual(REPORT);
  });
});

describe("runDatadogProbe", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    const code = await runDatadogProbe(["node", "slopweaver", "datadog", "probe", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("refuses an unknown flag with EXIT_USAGE", async () => {
    const code = await runDatadogProbe(["node", "slopweaver", "datadog", "probe", "--bogus"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable window with EXIT_USAGE before touching credentials", async () => {
    const code = await runDatadogProbe(["node", "slopweaver", "datadog", "probe", "--from", "yesterday"]);
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
      const code = await runDatadogProbe(["node", "slopweaver", "datadog", "probe", "--json"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });

    it("exits EXIT_EXPECTED_EMPTY with --sum-metric too", async () => {
      const code = await runDatadogProbe(["node", "slopweaver", "datadog", "probe", "--sum-metric", "@violations"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });

    it("exits EXIT_EXPECTED_EMPTY with --verify-env too", async () => {
      const code = await runDatadogProbe(["node", "slopweaver", "datadog", "probe", "--prod-env", "--verify-env"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
