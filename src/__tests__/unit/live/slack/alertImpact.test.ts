/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { behindTargets } from "../../../../live/slack/alertBehind.js";
import {
  ALERT_IMPACT_MAX,
  dominantService,
  impactOf,
  impactTargets,
  monitorSearchOf,
  noDominantServiceReason,
  noImpactReason,
} from "../../../../live/slack/alertImpact.js";
import { ALERT_SUMMARY_ROW_LABEL_MAX } from "../../../../outbound/artifact/alertSummary.js";

describe("dominantService — the denominator's subject", () => {
  it("is the largest group the aggregate named, carrying only THAT service's matches as the numerator", () => {
    expect(
      dominantService({
        groups: [
          { by: { service: "jobs-api" }, count: 40 },
          { by: { service: "core-api" }, count: 400 },
        ],
        total: 440,
      }),
    ).toEqual({ matched: 400, service: "core-api" });
  });

  it("drops a group whose count exceeds the aggregate's own total, because the two were measured apart", () => {
    expect(
      dominantService({
        groups: [
          { by: { service: "impossible" }, count: 900 },
          { by: { service: "jobs-api" }, count: 40 },
        ],
        total: 100,
      }),
    ).toEqual({ matched: 40, service: "jobs-api" });
  });

  it("is nothing when no group named a service", () => {
    expect(dominantService({ groups: [{ by: { status: "error" }, count: 40 }], total: 40 })).toBeUndefined();
  });

  it("is nothing when the aggregate matched nothing at all", () => {
    expect(dominantService({ groups: [], total: 0 })).toBeUndefined();
  });

  it("is nothing when every named group counted zero", () => {
    expect(dominantService({ groups: [{ by: { service: "jobs-api" }, count: 0 }], total: 10 })).toBeUndefined();
  });

  it("is nothing when the only group carrying events has an EMPTY service value, which the form cannot carry", () => {
    expect(dominantService({ groups: [{ by: { service: "" }, count: 1 }], total: 1 })).toBeUndefined();
  });

  it("passes over an empty-named group to the largest group that does name a service", () => {
    expect(
      dominantService({
        groups: [
          { by: { service: "" }, count: 90 },
          { by: { service: "jobs-api" }, count: 10 },
        ],
        total: 100,
      }),
    ).toEqual({ matched: 10, service: "jobs-api" });
  });
});

describe("noImpactReason — why a share was declined, never contradicting the numerator", () => {
  it("names the bound when a read came back past it", () => {
    expect(noImpactReason({ matched: 1, scope: 1_000_000_000_001, service: "svc" })).toBe(
      "a read on service svc came back past the impact field's bound of 1000000000000 events (matched 1, total " +
        "1000000000001), so no share is taken",
    );
  });

  it("says the reads DISAGREE when the service carried matches but its total read zero", () => {
    expect(noImpactReason({ matched: 5, scope: 0, service: "checkout" })).toBe(
      "its own query matched 5 on service checkout while that service's total read 0, so the two reads disagree " +
        "and no share is taken",
    );
  });

  it("says the service logged nothing when both reads agree it did", () => {
    expect(noImpactReason({ matched: 0, scope: 0, service: "checkout" })).toBe(
      "service checkout logged nothing over this window, so there is no denominator to take a share of",
    );
  });

  it("names a negative numerator as what it is", () => {
    expect(noImpactReason({ matched: -1, scope: 1000, service: "checkout" })).toBe(
      "its own query's count on service checkout read negative, so there is no numerator to take a share of",
    );
  });
});

describe("noDominantServiceReason — why there is no subject, said truly", () => {
  it("reports the read's own notes, never an absence, when the grouped read failed", () => {
    expect(noDominantServiceReason({ groups: [], notes: ["the logs counts — not read: HTTP 500"], total: 5 })).toBe(
      "no dominant service could be taken from what was read: the logs counts — not read: HTTP 500",
    );
  });

  it("says the reads DISAGREE when a service was named but overtook the total, never that none was named", () => {
    expect(
      noDominantServiceReason({ groups: [{ by: { service: "payments" }, count: 101 }], notes: [], total: 100 }),
    ).toBe(
      "every service the grouped read returned with any of its own query's events counted more than the query's total of 100 over this " +
        "window, so the two reads disagree and no share is taken",
    );
  });

  it("claims the disagreement only of services that carried an event, beside a named service that counted zero", () => {
    expect(
      noDominantServiceReason({
        notes: [],
        groups: [
          { by: { service: "payments" }, count: 101 },
          { by: { service: "jobs-api" }, count: 0 },
        ],
        total: 100,
      }),
    ).toBe(
      "every service the grouped read returned with any of its own query's events counted more than the query's total of 100 over this " +
        "window, so the two reads disagree and no share is taken",
    );
  });

  it("says no service carried an event when none was named", () => {
    expect(noDominantServiceReason({ groups: [{ by: { status: "error" }, count: 40 }], notes: [], total: 40 })).toBe(
      "no service the grouped read returned carried any of its own query's events over this window, so there is nothing to take a share of",
    );
  });

  it("says the events landed only under an empty service name, never that no service carried one", () => {
    expect(noDominantServiceReason({ groups: [{ by: { service: "" }, count: 1 }], notes: [], total: 1 })).toBe(
      "the grouped read counted its own query's events only under an empty service name, so there is no service to take a share of",
    );
  });

  it("says no service carried an event when every named group counted zero", () => {
    expect(noDominantServiceReason({ groups: [{ by: { service: "jobs-api" }, count: 0 }], notes: [], total: 10 })).toBe(
      "no service the grouped read returned carried any of its own query's events over this window, so there is nothing to take a share of",
    );
  });
});

describe("impactOf — an unmeasurable reading never reaches the form", () => {
  it("carries both counted numbers and the service they describe", () => {
    expect(impactOf({ matched: 34, scope: 1000, service: "core-api" })).toEqual({
      matched: 34,
      scope: 1000,
      service: "core-api",
    });
  });

  it("REFUSES a denominator of zero, rather than handing the card a number that means nothing", () => {
    expect(impactOf({ matched: 34, scope: 0, service: "core-api" })).toBeUndefined();
  });

  it("REFUSES a negative numerator", () => {
    expect(impactOf({ matched: -1, scope: 1000, service: "core-api" })).toBeUndefined();
  });

  it("REFUSES a total past the impact field's bound, so a measured impact never builds a form the door refuses", () => {
    expect(impactOf({ matched: 1, scope: 1_000_000_000_001, service: "svc" })).toBeUndefined();
    expect(impactOf({ matched: 1, scope: 1_000_000_000_000, service: "svc" })).toEqual({
      matched: 1,
      scope: 1_000_000_000_000,
      service: "svc",
    });
  });

  it("clips an over-long service name with a VISIBLE ellipsis rather than silently", () => {
    const service = "s".repeat(ALERT_SUMMARY_ROW_LABEL_MAX + 20);
    const impact = impactOf({ matched: 1, scope: 2, service })!;

    expect(impact.service.length).toBe(ALERT_SUMMARY_ROW_LABEL_MAX);
    expect(impact.service.endsWith("…")).toBe(true);
  });
});

describe("monitorSearchOf — which monitor kinds carry an event search at all", () => {
  it("unwraps a log alert's own log search", () => {
    expect(
      monitorSearchOf({
        query: 'logs("service:jobs-api status:error").index("*").rollup("count").last("5m") > 0',
        type: "log alert",
      }),
    ).toEqual({ product: "logs", search: "service:jobs-api status:error" });
  });

  it("unwraps a trace-analytics alert's own span search, which is what took coverage past log alerts", () => {
    expect(
      monitorSearchOf({
        query: 'trace-analytics("env:production service:checkout-api status:error").rollup("count").last("15m") > 5',
        type: "trace-analytics alert",
      }),
    ).toEqual({ product: "apm", search: "env:production service:checkout-api status:error" });
  });

  it("REFUSES a metric threshold, which has no event population to be a share of", () => {
    expect(
      monitorSearchOf({ query: "sum(last_15m):sum:payments.sentinel.fired{env:production} > 0", type: "query alert" }),
    ).toBeNull();
  });

  it("REFUSES a COMPOSITE monitor rather than rerunning one arm of it", () => {
    expect(
      monitorSearchOf({
        query: 'logs("service:a").last("5m") > 0 AND logs("service:b").last("5m") > 0',
        type: "log alert",
      }),
    ).toBeNull();
  });

  it("REFUSES a monitor whose wrapper does not match its own declared type", () => {
    expect(monitorSearchOf({ query: 'logs("service:a").last("5m") > 0', type: "trace-analytics alert" })).toBeNull();
  });

  it("REFUSES an empty search, which would count the whole organisation", () => {
    expect(monitorSearchOf({ query: 'logs("   ").last("5m") > 0', type: "log alert" })).toBeNull();
  });
});

describe("impactTargets — a different acceptance set from the `behind it` section, and a bigger budget", () => {
  const monitors = Array.from({ length: 14 }, (_unused, index) => ({
    id: index + 1,
    query: `logs("service:svc-${String(index)} status:error").index("*").rollup("count").last("5m") > 0`,
    type: "log alert",
  }));
  const rows = Array.from({ length: 14 }, (_unused, index) => ({
    count: 100 - index,
    embeddedLink: `https://ap1.datadoghq.com/monitors/${String(index + 1)}`,
    label: `alert-${String(index)}`,
  }));

  it("resolves only two targets for the `behind it` SECTION, which prints two lines", () => {
    expect(behindTargets({ monitors, rows }).map((target) => target.monitor)).toEqual(["alert-0", "alert-1"]);
  });

  it("resolves up to its own budget, noisiest first", () => {
    const targets = impactTargets({ monitors, rows });

    expect(targets.length).toBe(ALERT_IMPACT_MAX);
    expect(targets[0]!.monitor).toBe("alert-0");
    expect(targets.at(-1)!.monitor).toBe(`alert-${String(ALERT_IMPACT_MAX - 1)}`);
  });

  it("resolves nothing at a limit of zero, rather than one", () => {
    expect(impactTargets({ limit: 0, monitors, rows })).toEqual([]);
  });

  it("accepts a SPAN monitor the `behind it` section refuses, which is the whole reason it is its own resolver", () => {
    const span = [
      {
        id: 1,
        query: 'trace-analytics("service:checkout-api status:error").last("5m") > 0',
        type: "trace-analytics alert",
      },
    ];
    const row = [{ count: 3, embeddedLink: "https://ap1.datadoghq.com/monitors/1", label: "checkout errors" }];

    expect(behindTargets({ monitors: span, rows: row })).toEqual([]);
    expect(impactTargets({ monitors: span, rows: row })).toEqual([
      {
        labels: ["checkout errors"],
        monitor: "checkout errors",
        monitorId: 1,
        product: "apm",
        search: "service:checkout-api status:error",
      },
    ]);
  });

  it("reads one monitor ONCE but names every row it produced, so a grouped monitor's rows all get the reading", () => {
    const one = [{ id: 1, query: 'logs("service:a status:error").last("5m") > 0', type: "log alert" }];
    const three = ["x", "y", "z"].map((group, index) => ({
      count: 10 - index,
      embeddedLink: "https://ap1.datadoghq.com/monitors/1",
      label: `guardrail on check:${group}`,
    }));
    const targets = impactTargets({ monitors: one, rows: three });

    expect(targets.length).toBe(1);
    expect(targets[0]!.monitor).toBe("guardrail on check:x");
    expect(targets[0]!.labels).toEqual(["guardrail on check:x", "guardrail on check:y", "guardrail on check:z"]);
  });

  it("still names a grouped monitor's later rows once the target LIMIT is spent, so none is reported unresolved", () => {
    // The limit counts monitors, which is what costs a read. A row of a monitor already resolved joins that
    // target's labels whether or not the limit has been reached — otherwise it would read `impact ?` beside a
    // warning claiming it named no measurable monitor, which is false.
    const monitorsForLimit = [1, 2].map((id) => ({
      id,
      query: `logs("service:svc-${String(id)} status:error").last("5m") > 0`,
      type: "log alert",
    }));
    const rowsForLimit = [
      { count: 9, embeddedLink: "https://ap1.datadoghq.com/monitors/1", label: "one · a" },
      { count: 8, embeddedLink: "https://ap1.datadoghq.com/monitors/2", label: "two · a" },
      { count: 7, embeddedLink: "https://ap1.datadoghq.com/monitors/1", label: "one · b" },
    ];
    const targets = impactTargets({ limit: 1, monitors: monitorsForLimit, rows: rowsForLimit });

    expect(targets.map((target) => target.labels)).toEqual([["one · a", "one · b"]]);
  });

  it("resolves nothing for a row whose notification embedded no link at all", () => {
    expect(impactTargets({ monitors, rows: [{ count: 3, label: "no link" }] })).toEqual([]);
  });
});
