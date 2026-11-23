/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  isMonitorId,
  metricExplorerSeedUrl,
  monitorEditUrl,
  monitorPageUrl,
  unmetQueryFragments,
  validateExplorerUrl,
} from "../../../../datadog/shot/targetUrl.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const HOST = "ap1.datadoghq.com";

describe("monitorEditUrl", () => {
  it("builds the EDIT page, which is the only page carrying the backtest panel", () => {
    expect(monitorEditUrl({ consoleHost: HOST, monitorId: "600101" })).toBe(
      "https://ap1.datadoghq.com/monitors/600101/edit",
    );
  });
});

describe("monitorPageUrl", () => {
  it("builds the monitor's own page, the one a citation chip opens", () => {
    expect(monitorPageUrl({ consoleHost: HOST, monitorId: "50001" })).toBe("https://ap1.datadoghq.com/monitors/50001");
  });
});

describe("isMonitorId", () => {
  it("accepts a bare run of digits", () => {
    expect(isMonitorId({ raw: "600101" })).toBe(true);
  });

  it("rejects anything else, including a URL a caller pasted whole", () => {
    expect(isMonitorId({ raw: "https://ap1.datadoghq.com/monitors/600101" })).toBe(false);
    expect(isMonitorId({ raw: "600101 " })).toBe(false);
    expect(isMonitorId({ raw: "" })).toBe(false);
  });
});

describe("validateExplorerUrl", () => {
  it("opens a view path on the configured console host", () => {
    const validated = validateExplorerUrl({ consoleHost: HOST, url: `https://${HOST}/metric/explorer?exp_metric=a` });
    expect(validated.isOk()).toBe(true);
    expect(unwrap(validated)).toBe(`https://${HOST}/metric/explorer?exp_metric=a`);
  });

  it("keeps an opaque state fragment intact, which is where the Metrics Explorer holds its query", () => {
    const url = `https://${HOST}/metric/explorer?session_id=abc&start=1&end=2&paused=true#N4IgZG9yeQ`;
    expect(unwrap(validateExplorerUrl({ consoleHost: HOST, url }))).toBe(url);
  });

  it("refuses a host that is not the configured site, which is the wrong-estate shot", () => {
    const refused = validateExplorerUrl({ consoleHost: HOST, url: "https://us3.datadoghq.com/logs" });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("URL_REFUSED");
    expect(unwrapErr(refused).message).toContain("us3.datadoghq.com");
  });

  it("refuses a console path that is not a view — settings, billing, a member's profile", () => {
    const refused = validateExplorerUrl({ consoleHost: HOST, url: `https://${HOST}/account/settings` });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("/account/settings");
  });

  it("refuses a non-https scheme", () => {
    const refused = validateExplorerUrl({ consoleHost: HOST, url: `http://${HOST}/logs` });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("http:");
  });

  it("refuses something that is not a URL at all", () => {
    const refused = validateExplorerUrl({ consoleHost: HOST, url: "not a url" });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("not a URL");
  });
});

describe("metricExplorerSeedUrl", () => {
  it("pins the window absolutely and pauses the view", () => {
    const url = metricExplorerSeedUrl({
      agg: "sum",
      consoleHost: HOST,
      metric: "copilot.judge.result",
      window: { fromMs: 1788246000000, toMs: 1788260000000 },
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe(HOST);
    expect(parsed.pathname).toBe("/metric/explorer");
    expect(parsed.searchParams.get("exp_metric")).toBe("copilot.judge.result");
    expect(parsed.searchParams.get("exp_agg")).toBe("sum");
    expect(parsed.searchParams.get("start")).toBe("1788246000000");
    expect(parsed.searchParams.get("end")).toBe("1788260000000");
    expect(parsed.searchParams.get("paused")).toBe("true");
  });

  it("builds an address its own validator accepts, so the two can never disagree", () => {
    const url = metricExplorerSeedUrl({
      agg: "sum",
      consoleHost: HOST,
      metric: "copilot.judge.result",
      window: { fromMs: 1, toMs: 2 },
    });
    expect(validateExplorerUrl({ consoleHost: HOST, url }).isOk()).toBe(true);
  });
});

describe("unmetQueryFragments", () => {
  it("reports nothing missing when the console rendered what was asked for", () => {
    const missing = unmetQueryFragments({
      rendered: "sum:copilot.judge.result{env:staging} by {instrumentation_scope}.as_count()",
      required: ["copilot.judge.result", "env:staging", "instrumentation_scope"],
    });
    expect(missing).toEqual([]);
  });

  it("names a dropped group-by, which is the seeded mode's whole reason to read back", () => {
    const missing = unmetQueryFragments({
      rendered: "sum:copilot.judge.result{env:staging}.as_count()",
      required: ["copilot.judge.result", "env:staging", "instrumentation_scope"],
    });
    expect(missing).toEqual(["instrumentation_scope"]);
  });

  it("names a dropped scope, which silently widens the population the image claims", () => {
    const missing = unmetQueryFragments({
      rendered: "sum:copilot.judge.result{*} by {layer}.as_count()",
      required: ["copilot.judge.result", "env:staging", "layer"],
    });
    expect(missing).toEqual(["env:staging"]);
  });

  it("matches case-insensitively, since the console re-cases what it renders", () => {
    expect(
      unmetQueryFragments({ rendered: "SUM:Copilot.Judge.Result{ENV:STAGING}", required: ["env:staging"] }),
    ).toEqual([]);
  });

  it("requires nothing of a caller-supplied address, whose state this verb did not construct", () => {
    expect(unmetQueryFragments({ rendered: "", required: [] })).toEqual([]);
  });
});
