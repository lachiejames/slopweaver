/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import type { AlertProbe } from "../../../datadog/alertProbe.js";
import { alertProbeCitationUrl } from "../../../datadog/alertProbeCitation.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const WINDOW = { fromMs: 1789472188368, toMs: 1789558588368 };

/** One declared check, overridable field by field. */
function probe(over: Partial<AlertProbe>): AlertProbe {
  return {
    alarmWhen: "count-above-zero",
    id: "chronic-violations",
    kind: "logs-count",
    query: "service:integrity-audit status:error",
    severityWhenFiring: "red",
    title: "Chronic violations",
    why: "An invariant the audit checks has been broken.",
    ...over,
  };
}

describe("alertProbeCitationUrl", () => {
  it("names the attribute a logs-facet-sum probe summed, as the Log Explorer's own aggregation params", () => {
    const cited = unwrap(
      alertProbeCitationUrl({
        consoleHost: "ap1.datadoghq.com",
        probe: probe({ kind: "logs-facet-sum", sumAttribute: "@violations" }),
        window: WINDOW,
      }),
    );
    const url = new URL(cited.url);
    expect(cited.domain).toBe("logs");
    expect(url.pathname).toBe("/logs");
    expect(url.searchParams.get("query")).toBe("service:integrity-audit status:error");
    expect(url.searchParams.get("agg_m")).toBe("@violations");
    expect(url.searchParams.get("agg_t")).toBe("sum");
    expect(url.searchParams.get("from_ts")).toBe("1789472188368");
  });

  it("leaves a logs-count citation exactly as it was, with no aggregation params", () => {
    const cited = unwrap(alertProbeCitationUrl({ consoleHost: "ap1.datadoghq.com", probe: probe({}), window: WINDOW }));
    expect(cited.url).toBe(
      "https://ap1.datadoghq.com/logs?query=service%3Aintegrity-audit%20status%3Aerror" +
        "&from_ts=1789472188368&to_ts=1789558588368&live=false",
    );
  });

  it("cites a metric-sum probe's declared search in its own domain, with no log aggregation params", () => {
    const cited = unwrap(
      alertProbeCitationUrl({
        consoleHost: "ap1.datadoghq.com",
        probe: probe({
          citation: { domain: "traces", query: "service:jobs-api @delivery_status:failed" },
          kind: "metric-sum",
          query: "sum:jobs.failed{*}.as_count()",
        }),
        window: WINDOW,
      }),
    );
    const url = new URL(cited.url);
    expect(cited.domain).toBe("traces");
    expect(url.pathname).toBe("/apm/traces");
    expect(url.searchParams.get("query")).toBe("service:jobs-api @delivery_status:failed");
    expect(url.searchParams.get("agg_t")).toBe(null);
    expect(url.searchParams.get("agg_m")).toBe(null);
  });

  it("refuses a facet-sum probe that reached it with no attribute, naming the probe", () => {
    const refused = unwrapErr(
      alertProbeCitationUrl({
        consoleHost: "ap1.datadoghq.com",
        probe: probe({ kind: "logs-facet-sum" }),
        window: WINDOW,
      }),
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("chronic-violations");
    expect(refused[0]).toContain("no sumAttribute");
  });
});
