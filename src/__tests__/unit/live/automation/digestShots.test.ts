/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { alertProbeCitationUrl } from "../../../../datadog/alertProbeCitation.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { DigestShotViewErrors } from "../../../../live/automation/digestShotErrors.js";
import {
  digestShotTargets,
  digestShotTargetsFromDocument,
  LOGS_GROUP_BY,
  shotCaption,
  timeseriesViewOf,
  unboundCaptures,
} from "../../../../live/automation/digestShots.js";
import { recipeErrorLines } from "../../../../live/automation/errors.js";
import type { DigestForm } from "../../../../outbound/artifact/digestFields.js";

const TRACES_CITATION =
  "https://ap1.datadoghq.com/apm/traces?query=service%3Ajobs-api%20%40acme.event_kit.delivery_status%3Afailed" +
  "&from_ts=1789472188368&to_ts=1789558588368&live=false";

const LOGS_CITATION =
  "https://ap1.datadoghq.com/logs?query=service%3Ajobs-api%20status%3Aerror" +
  "&from_ts=1789472188368&to_ts=1789558588368&live=false";

/** A logs-facet-sum probe's citation: its row SUMS @violations, while the adapter's summary counts log lines. */
const FACET_SUM_CITATION = `${LOGS_CITATION}&agg_m=%40violations&agg_t=sum`;

/** A digest card, overridable item by item. */
function card({ items }: { items: DigestForm["items"] }): DigestForm {
  return { items, kind: "digest", label: "Event delivery", window: "24h" };
}

describe("timeseriesViewOf", () => {
  it("rewrites a traces citation to the timeseries view and groups nothing", () => {
    const url = new URL(unwrap(timeseriesViewOf({ citationUrl: TRACES_CITATION })));
    expect(url.pathname).toBe("/apm/traces");
    expect(url.searchParams.get("viz")).toBe("timeseries");
    expect(url.searchParams.get("agg_q")).toBe(null);
    expect(url.searchParams.get("from_ts")).toBe("1789472188368");
  });

  it("groups a logs citation, because the summary sentence only exists under a group-by", () => {
    const url = new URL(unwrap(timeseriesViewOf({ citationUrl: LOGS_CITATION })));
    expect(url.searchParams.get("viz")).toBe("timeseries");
    expect(url.searchParams.get("agg_q")).toBe(LOGS_GROUP_BY);
  });

  it("keeps a group-by the citation already carried", () => {
    const url = new URL(unwrap(timeseriesViewOf({ citationUrl: `${LOGS_CITATION}&agg_q=host` })));
    expect(url.searchParams.get("agg_q")).toBe("host");
  });

  it("names a console area no adapter covers, rather than photographing it", () => {
    const refused = unwrapErr(timeseriesViewOf({ citationUrl: "https://ap1.datadoghq.com/rum?query=x" }));
    expect(refused).toEqual(
      DigestShotViewErrors.viewUncovered({
        citationUrl: "https://ap1.datadoghq.com/rum?query=x",
        covered: ["/logs", "/apm/traces"],
        pathname: "/rum",
      }),
    );
    expect(refused.code).toBe("CITATION_VIEW_UNCOVERED");
    expect(refused.message).toBe(
      "citation 'https://ap1.datadoghq.com/rum?query=x' points at /rum, and the capture adapters cover " +
        "/logs, /apm/traces — the card keeps its link and takes no picture for this item",
    );
  });

  it("refuses a logs citation that sums an attribute, naming the attribute and why no picture can reconcile", () => {
    const refused = unwrapErr(timeseriesViewOf({ citationUrl: FACET_SUM_CITATION }));
    expect(refused).toEqual(
      DigestShotViewErrors.notACount({ aggregation: "sum", citationUrl: FACET_SUM_CITATION, measure: "@violations" }),
    );
    expect(refused.code).toBe("CITATION_NOT_A_COUNT");
    expect(refused.message).toBe(
      `citation '${FACET_SUM_CITATION}' takes the sum of @violations, and the capture adapter's summary ` +
        "counts log lines — no picture of it can reconcile with the row, so the card keeps its link and takes none",
    );
  });

  it("says the measure is unnamed when a non-count logs citation carries no agg_m", () => {
    const refused = unwrapErr(timeseriesViewOf({ citationUrl: `${LOGS_CITATION}&agg_t=avg` }));
    expect(refused.code).toBe("CITATION_NOT_A_COUNT");
    expect(refused.message).toBe(
      `citation '${LOGS_CITATION}&agg_t=avg' takes the avg of an unnamed measure, and the capture adapter's ` +
        "summary counts log lines — no picture of it can reconcile with the row, so the card keeps its link and takes none",
    );
  });

  it("still photographs a logs citation whose aggregation is an explicit count", () => {
    const url = new URL(unwrap(timeseriesViewOf({ citationUrl: `${LOGS_CITATION}&agg_m=count&agg_t=count` })));
    expect(url.searchParams.get("viz")).toBe("timeseries");
    expect(url.searchParams.get("agg_q")).toBe(LOGS_GROUP_BY);
  });

  it("refuses the citation the alert digest itself builds for a facet-sum probe", () => {
    const cited = unwrap(
      alertProbeCitationUrl({
        consoleHost: "ap1.datadoghq.com",
        probe: {
          alarmWhen: "count-above-zero",
          id: "chronic",
          kind: "logs-facet-sum",
          query: "service:integrity-audit",
          severityWhenFiring: "red",
          sumAttribute: "@violations",
          title: "Chronic violations",
          why: "An invariant the audit checks has been broken.",
        },
        window: { fromMs: 1789472188368, toMs: 1789558588368 },
      }),
    );
    const refused = unwrapErr(timeseriesViewOf({ citationUrl: cited.url }));
    expect(refused.code).toBe("CITATION_NOT_A_COUNT");
    expect(refused.message).toBe(
      `citation '${cited.url}' takes the sum of @violations, and the capture adapter's summary ` +
        "counts log lines — no picture of it can reconcile with the row, so the card keeps its link and takes none",
    );
  });

  it("refuses a citation that is not an address at all", () => {
    const refused = unwrapErr(timeseriesViewOf({ citationUrl: "not a url" }));
    expect(refused).toEqual(DigestShotViewErrors.notAnAddress({ citationUrl: "not a url" }));
    expect(refused.code).toBe("CITATION_NOT_AN_ADDRESS");
    expect(refused.message).toBe("citation 'not a url' is not an address, so there is no view to photograph");
  });
});

describe("digestShotTargets", () => {
  it("photographs the firing items and never a green one", () => {
    const plan = digestShotTargets({
      form: card({
        items: [
          { citationUrl: TRACES_CITATION, count: 3213, severity: "orange", title: "Transient failures" },
          { citationUrl: LOGS_CITATION, count: 2, severity: "red", title: "Permanent failures" },
          { citationUrl: `${LOGS_CITATION}&agg_q=host`, count: 1023, severity: "green", title: "Benign skips" },
        ],
      }),
    });
    // Card order, which is worst severity first on a triage card, not the order the form listed them in.
    expect(plan.targets.map((target) => target.titles)).toEqual([["Permanent failures"], ["Transient failures"]]);
    expect(plan.targets.map((target) => target.severity)).toEqual(["red", "orange"]);
    expect(plan.unshootable).toEqual([]);
  });

  it("takes ONE picture of a view two firing probes share", () => {
    const plan = digestShotTargets({
      form: card({
        items: [
          { citationUrl: LOGS_CITATION, count: 298, severity: "orange", title: "Actionable skips" },
          { citationUrl: LOGS_CITATION, count: 1, severity: "orange", title: "Unrecognised skips" },
        ],
      }),
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]!.titles).toEqual(["Actionable skips", "Unrecognised skips"]);
    expect(shotCaption({ target: plan.targets[0]! })).toBe("Actionable skips · Unrecognised skips");
  });

  it("follows the priority ranking on an alerts card, where a broad orange outranks a narrow red", () => {
    const plan = digestShotTargets({
      form: {
        ...card({
          items: [
            {
              citationUrl: LOGS_CITATION,
              count: 2,
              impact: { matched: 2, scope: 1000, service: "jobs-api" },
              severity: "red",
              title: "Permanent failures",
            },
            {
              citationUrl: TRACES_CITATION,
              count: 300,
              impact: { matched: 300, scope: 1000, service: "jobs-api" },
              severity: "orange",
              title: "Transient failures",
            },
          ],
        }),
        alerts: {},
      },
    });
    // orange x broad (30%) is P1, red x narrow (0.2%) is P2: the ranked card photographs the P1 first.
    expect(plan.targets.map((target) => target.titles)).toEqual([["Transient failures"], ["Permanent failures"]]);
  });

  it("gives a shared view the WORST severity on it, whichever item reached it first", () => {
    const plan = digestShotTargets({
      form: {
        ...card({
          items: [
            {
              citationUrl: LOGS_CITATION,
              count: 2,
              impact: { matched: 2, scope: 1000, service: "jobs-api" },
              severity: "red",
              title: "Permanent failures",
            },
            {
              citationUrl: LOGS_CITATION,
              count: 300,
              impact: { matched: 300, scope: 1000, service: "jobs-api" },
              severity: "orange",
              title: "Transient failures",
            },
          ],
        }),
        alerts: {},
      },
    });
    expect(plan.targets.map((target) => target.titles)).toEqual([["Transient failures", "Permanent failures"]]);
    expect(plan.targets.map((target) => target.severity)).toEqual(["red"]);
  });

  it("names a firing item it cannot photograph instead of dropping it", () => {
    const plan = digestShotTargets({
      form: card({
        items: [
          { count: 4, severity: "red", title: "No citation at all" },
          { citationUrl: "https://ap1.datadoghq.com/rum?query=x", count: 9, severity: "orange", title: "A RUM view" },
        ],
      }),
    });
    expect(plan.targets).toEqual([]);
    expect(plan.unshootable).toHaveLength(2);
    expect(plan.unshootable[0]).toContain("No citation at all");
    expect(plan.unshootable[1]).toContain("A RUM view");
  });

  it("names a firing facet-sum item as unshootable while photographing the count beside it", () => {
    const plan = digestShotTargets({
      form: card({
        items: [
          { citationUrl: FACET_SUM_CITATION, count: 2134, severity: "red", title: "Chronic violations" },
          { citationUrl: LOGS_CITATION, count: 140, severity: "orange", title: "AU stranded" },
        ],
      }),
    });
    expect(plan.targets.map((target) => target.titles)).toEqual([["AU stranded"]]);
    expect(plan.unshootable).toHaveLength(1);
    expect(plan.unshootable[0]).toContain("Chronic violations · ");
    expect(plan.unshootable[0]).toContain("@violations");
  });

  it("never names a facet-sum item in the caption of a count picture over the same search", () => {
    const plan = digestShotTargets({
      form: card({
        items: [
          { citationUrl: FACET_SUM_CITATION, count: 2134, severity: "red", title: "Violation total" },
          { citationUrl: LOGS_CITATION, count: 28, severity: "red", title: "Matching log lines" },
        ],
      }),
    });
    expect(plan.targets.map((target) => shotCaption({ target }))).toEqual(["Matching log lines"]);
    expect(plan.unshootable[0]).toContain("Violation total · ");
  });

  it("takes no picture at all for an all-green card", () => {
    const plan = digestShotTargets({
      form: card({
        items: [
          { citationUrl: LOGS_CITATION, count: 0, severity: "green", title: "Quiet" },
          { citationUrl: FACET_SUM_CITATION, count: 0, severity: "green", title: "Quiet sum" },
        ],
      }),
    });
    expect(plan.targets).toEqual([]);
    expect(plan.unshootable).toEqual([]);
  });
});

describe("digestShotTargetsFromDocument", () => {
  it("reads the card the read leg printed", () => {
    const document = JSON.stringify(
      card({ items: [{ citationUrl: TRACES_CITATION, count: 3213, severity: "orange", title: "Transient" }] }),
    );
    const plan = unwrap(digestShotTargetsFromDocument({ document }));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]!.url).toContain("viz=timeseries");
  });

  it("refuses a document that is not JSON", () => {
    expect(unwrapErr(digestShotTargetsFromDocument({ document: "{not json" })).code).toBe("DIGEST_CARD_NOT_JSON");
    expect(unwrapErr(digestShotTargetsFromDocument({ document: "{not json" })).message).toContain("not readable JSON");
  });

  it("refuses a document that is JSON but not a digest card", () => {
    const refused = unwrapErr(digestShotTargetsFromDocument({ document: '{"kind":"update"}' }));
    expect(refused.code).toBe("DIGEST_CARD_INVALID");
    expect(recipeErrorLines({ error: refused }).length).toBeGreaterThan(0);
  });
});

describe("unboundCaptures", () => {
  const targets = [
    { severity: "orange" as const, titles: ["Transient"], url: `${TRACES_CITATION}&viz=timeseries` },
    { severity: "red" as const, titles: ["Permanent"], url: `${LOGS_CITATION}&viz=timeseries&agg_q=service` },
  ];

  it("binds a capture of a view the card cites", () => {
    const attached = [{ capturedUrl: `${TRACES_CITATION}&viz=timeseries`, path: "/tmp/a.png" }];
    expect(unboundCaptures({ attached, targets })).toEqual([]);
  });

  it("refuses a graded capture of somebody else's view", () => {
    const attached = [
      { capturedUrl: "https://ap1.datadoghq.com/logs?query=service%3Aknock&viz=timeseries", path: "/tmp/knock.png" },
    ];
    const unbound = unboundCaptures({ attached, targets });
    expect(unbound).toHaveLength(1);
    expect(unbound[0]).toContain("/tmp/knock.png");
    expect(unbound[0]).toContain("not a view this card cites");
  });

  it("refuses bytes no capture record names", () => {
    const unbound = unboundCaptures({ attached: [{ capturedUrl: null, path: "/tmp/hand-made.png" }], targets });
    expect(unbound).toHaveLength(1);
    expect(unbound[0]).toContain("no capture record names these bytes");
  });
});

describe("unboundCaptures binds the view and bounds the window", () => {
  const cardFrom = 1789486582235;
  const cardTo = 1789572982235;
  const viewOf = ({ fromMs, toMs }: { fromMs: number; toMs: number }): string =>
    `${TRACES_CITATION.split("&")[0]!}&from_ts=${String(fromMs)}&to_ts=${String(toMs)}&live=false&viz=timeseries`;
  const targets = [
    { severity: "orange" as const, titles: ["Transient"], url: viewOf({ fromMs: cardFrom, toMs: cardTo }) },
  ];

  it("binds a capture taken minutes before the card was re-read", () => {
    const attached = [
      { capturedUrl: viewOf({ fromMs: cardFrom - 106_000, toMs: cardTo - 106_000 }), path: "/tmp/a.png" },
    ];
    expect(unboundCaptures({ attached, targets })).toEqual([]);
  });

  it("refuses the same view over yesterday's window", () => {
    const day = 24 * 60 * 60 * 1000;
    const attached = [{ capturedUrl: viewOf({ fromMs: cardFrom - day, toMs: cardTo - day }), path: "/tmp/old.png" }];
    const unbound = unboundCaptures({ attached, targets });
    expect(unbound).toHaveLength(1);
    expect(unbound[0]).toContain("1440 minutes from this card's");
  });

  it("refuses a picture of the right query with no frozen window at all", () => {
    const attached = [{ capturedUrl: `${TRACES_CITATION.split("&")[0]!}&viz=timeseries`, path: "/tmp/live.png" }];
    expect(unboundCaptures({ attached, targets })).toHaveLength(1);
  });

  it("still refuses a different query however fresh its window", () => {
    const attached = [
      {
        capturedUrl: `https://ap1.datadoghq.com/logs?query=service%3Aknock&from_ts=${String(cardFrom)}&to_ts=${String(cardTo)}&live=false&viz=timeseries`,
        path: "/tmp/knock.png",
      },
    ];
    expect(unboundCaptures({ attached, targets })[0]).toContain("not a view this card cites");
  });
});
