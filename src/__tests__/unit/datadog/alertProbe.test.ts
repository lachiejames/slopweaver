import { describe, expect, it } from "vitest";

import {
  ALERT_PROBE_ALARM_MODES,
  ALERT_PROBE_KINDS,
  type AlertProbe,
  type AlertProbeReading,
  isCardCount,
  orderReadings,
  parseAlertProbeSet,
  probeCountsTowardTrend,
  readingImpactIsMeasurable,
  readingIsAlarming,
  readingSeverity,
  readingToDigestItem,
} from "../../../datadog/alertProbe.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { digestFormSchema } from "../../../outbound/artifact/digest.js";
import { TABLE_MAX_ROWS } from "../../../outbound/assistant/contentLimits.js";

/** A minimal valid probe, overridable field by field. */
function probe(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "send-failures",
    kind: "logs-count",
    query: "service:example-api status:error",
    severityWhenFiring: "orange",
    title: "send failures",
    why: "the outer send catch, wrapping every transport",
    ...over,
  };
}

/** A reading over a parsed probe, so a severity test never hand-builds the probe shape. */
function reading({ over = {}, value }: { over?: Record<string, unknown>; value: number }): AlertProbeReading {
  const set = unwrap(parseAlertProbeSet({ value: { probes: [probe(over)] } }));
  return { citationUrl: "https://example.datadoghq.com/logs?query=x", probe: set.probes[0]!, value };
}

describe("parseAlertProbeSet — what may run", () => {
  it("accepts a minimal logs-count probe and defaults its alarm direction", () => {
    const set = unwrap(parseAlertProbeSet({ value: { probes: [probe()] } }));
    expect(set.probes.length).toBe(1);
    expect(set.probes[0]!.alarmWhen).toBe("count-above-zero");
    expect(set.probes[0]!.id).toBe("send-failures");
  });

  it("refuses an empty probe set, which would post a card with no rows", () => {
    expect(unwrapErr(parseAlertProbeSet({ value: { probes: [] } })).code).toBe("PROBE_SET_INVALID");
  });

  it("refuses a field nobody declared rather than ignoring it", () => {
    const failure = unwrapErr(parseAlertProbeSet({ value: { probes: [probe({ ownerFile: "src/x.ts" })] } }));
    expect(failure.code).toBe("PROBE_SET_INVALID");
    expect(failure.message).toContain("ownerFile");
  });

  it("refuses two probes sharing one id, which makes a finding unattributable", () => {
    const failure = unwrapErr(parseAlertProbeSet({ value: { probes: [probe(), probe({ title: "other" })] } }));
    expect(failure.code).toBe("PROBE_ID_DUPLICATED");
    expect(failure.message).toContain("send-failures");
  });

  it("refuses a set larger than one card can carry, naming the cap", () => {
    const probes = Array.from({ length: TABLE_MAX_ROWS + 1 }, (_unused, index) => probe({ id: `p${String(index)}` }));
    const failure = unwrapErr(parseAlertProbeSet({ value: { probes } }));
    expect(failure.code).toBe("PROBE_SET_TOO_LARGE");
    expect(failure.message).toContain(String(TABLE_MAX_ROWS));
  });

  it("refuses logs-facet-sum with no attribute to sum", () => {
    const failure = unwrapErr(parseAlertProbeSet({ value: { probes: [probe({ kind: "logs-facet-sum" })] } }));
    expect(failure.code).toBe("PROBE_SHAPE_MISMATCH");
    expect(failure.message).toContain("sumAttribute");
  });

  it("refuses a sum attribute written without its @ prefix", () => {
    const failure = unwrapErr(
      parseAlertProbeSet({ value: { probes: [probe({ kind: "logs-facet-sum", sumAttribute: "violations" })] } }),
    );
    expect(failure.code).toBe("PROBE_SHAPE_MISMATCH");
    expect(failure.message).toContain("'@' prefix");
  });

  it("refuses a sum attribute on a kind that never reads one, rather than ignoring it", () => {
    const failure = unwrapErr(parseAlertProbeSet({ value: { probes: [probe({ sumAttribute: "@violations" })] } }));
    expect(failure.code).toBe("PROBE_SHAPE_MISMATCH");
    expect(failure.message).toContain("silently ignored");
  });

  it("refuses metric-sum with no citation, since a metric query is not a console search", () => {
    const failure = unwrapErr(
      parseAlertProbeSet({ value: { probes: [probe({ kind: "metric-sum", query: "sum:a.b{*}.as_count()" })] } }),
    );
    expect(failure.code).toBe("PROBE_SHAPE_MISMATCH");
    expect(failure.message).toContain("citation");
  });

  it("accepts metric-sum carrying its declared traces citation", () => {
    const set = unwrap(
      parseAlertProbeSet({
        value: {
          probes: [
            probe({
              citation: { domain: "traces", query: "service:jobs-api resource_name:event-deliver" },
              kind: "metric-sum",
              query: "sum:a.b{*}.as_count()",
            }),
          ],
        },
      }),
    );
    expect(set.probes[0]!.citation?.domain).toBe("traces");
  });

  it("refuses a citation on a logs kind, whose own query IS its citation", () => {
    const failure = unwrapErr(
      parseAlertProbeSet({ value: { probes: [probe({ citation: { domain: "logs", query: "x" } })] } }),
    );
    expect(failure.code).toBe("PROBE_SHAPE_MISMATCH");
    expect(failure.message).toContain("silently ignored");
  });

  it("declares exactly the three kinds this build runs", () => {
    expect(ALERT_PROBE_KINDS).toEqual(["logs-count", "logs-facet-sum", "metric-sum"]);
  });

  it("declares exactly the two alarm directions, so a third cannot be selected by a row", () => {
    expect(ALERT_PROBE_ALARM_MODES).toEqual(["count-above-zero", "count-is-zero"]);
    expect(unwrapErr(parseAlertProbeSet({ value: { probes: [probe({ alarmWhen: "count-above-ten" })] } })).code).toBe(
      "PROBE_SET_INVALID",
    );
  });
});

describe("severity is arithmetic over the count", () => {
  it("is green when a failure-signature probe counted nothing", () => {
    expect(readingSeverity({ reading: reading({ value: 0 }) })).toBe("green");
  });

  it("is the declared severity when a failure-signature probe counted anything", () => {
    expect(readingSeverity({ reading: reading({ value: 1 }) })).toBe("orange");
  });

  it("stays the declared severity at one, not only at a threshold", () => {
    expect(readingSeverity({ reading: reading({ over: { severityWhenFiring: "red" }, value: 1 }) })).toBe("red");
  });

  it("stays green at any count when the probe declared green as its firing severity", () => {
    expect(readingSeverity({ reading: reading({ over: { severityWhenFiring: "green" }, value: 9_999 }) })).toBe(
      "green",
    );
  });

  it("inverts for a heartbeat: a zero is the alarm and a count is the good day", () => {
    const quiet = reading({ over: { alarmWhen: "count-is-zero", severityWhenFiring: "red" }, value: 0 });
    const beating = reading({ over: { alarmWhen: "count-is-zero", severityWhenFiring: "red" }, value: 208 });
    expect(readingIsAlarming({ reading: quiet })).toBe(true);
    expect(readingSeverity({ reading: quiet })).toBe("red");
    expect(readingIsAlarming({ reading: beating })).toBe(false);
    expect(readingSeverity({ reading: beating })).toBe("green");
  });
});

describe("readingToDigestItem — what reaches the card", () => {
  it("carries the count, severity and citation, and the paragraph when it is alarming", () => {
    const item = readingToDigestItem({ impact: undefined, reading: reading({ value: 19 }) });
    expect(item.count).toBe(19);
    expect(item.severity).toBe("orange");
    expect(item.title).toBe("send failures");
    expect(item.substance).toBe("the outer send catch, wrapping every transport");
    expect(item.citationUrl).toBe("https://example.datadoghq.com/logs?query=x");
  });

  it("drops the paragraph on a quiet row, so a quiet day is not a wall of text", () => {
    expect(readingToDigestItem({ impact: undefined, reading: reading({ value: 0 }) }).substance).toBeUndefined();
  });

  it("names no owner, ever — an unresolvable ping stops the card rather than degrading it", () => {
    expect(readingToDigestItem({ impact: undefined, reading: reading({ value: 19 }) }).owner).toBeUndefined();
  });

  it("asserts no history it has not measured", () => {
    const item = readingToDigestItem({ impact: undefined, reading: reading({ value: 19 }) });
    expect(item.state).toBeUndefined();
    expect(item.trend).toBeUndefined();
  });

  it("produces items the real digest form accepts", () => {
    const form = digestFormSchema.safeParse({
      items: [readingToDigestItem({ impact: undefined, reading: reading({ value: 19 }) })],
      kind: "digest",
      label: "Knock",
      window: "24h",
    });
    expect(form.success).toBe(true);
  });
});

describe("readingToDigestItem — the impact it is handed", () => {
  it("carries a measured impact onto the item", () => {
    const impact = { matched: 19, scope: 4000, service: "example-api" };
    expect(readingToDigestItem({ impact, reading: reading({ value: 19 }) }).impact).toEqual(impact);
  });

  it("writes no impact key at all when nothing was measured, so the strict form sees nothing to refuse", () => {
    expect(Object.keys(readingToDigestItem({ impact: undefined, reading: reading({ value: 19 }) }))).not.toContain(
      "impact",
    );
  });
});

describe("readingImpactIsMeasurable — which firing reading has an event population", () => {
  it("measures a firing logs-count and a firing logs-facet-sum", () => {
    expect(readingImpactIsMeasurable({ reading: reading({ value: 3 }) })).toBe(true);
    expect(
      readingImpactIsMeasurable({
        reading: reading({ over: { kind: "logs-facet-sum", sumAttribute: "@violations" }, value: 3 }),
      }),
    ).toBe(true);
  });

  it("does not measure a quiet reading, which has nothing to take a share of", () => {
    expect(readingImpactIsMeasurable({ reading: reading({ value: 0 }) })).toBe(false);
  });

  it("does not measure a metric-sum, whose query is not an event search", () => {
    const metric = {
      citation: { domain: "traces", query: "service:jobs-api resource_name:event-deliver" },
      kind: "metric-sum",
      query: "sum:a.b{*}.as_count()",
    };
    expect(readingImpactIsMeasurable({ reading: reading({ over: metric, value: 3 }) })).toBe(false);
  });

  it("does not measure a firing heartbeat, which alarms on the silence a share cannot divide", () => {
    expect(readingImpactIsMeasurable({ reading: reading({ over: { alarmWhen: "count-is-zero" }, value: 0 }) })).toBe(
      false,
    );
  });
});

describe("probeCountsTowardTrend — which probes the baseline sums", () => {
  it("counts a probe that alarms on a count and fires non-green", () => {
    expect(probeCountsTowardTrend({ probe: reading({ value: 0 }).probe })).toBe(true);
  });

  it("leaves out a heartbeat, whose count is the healthy direction", () => {
    expect(probeCountsTowardTrend({ probe: reading({ over: { alarmWhen: "count-is-zero" }, value: 0 }).probe })).toBe(
      false,
    );
  });

  it("leaves out a probe declared green when firing, which the current total leaves out too", () => {
    expect(probeCountsTowardTrend({ probe: reading({ over: { severityWhenFiring: "green" }, value: 0 }).probe })).toBe(
      false,
    );
  });
});

describe("orderReadings — worst first, then loudest, then stable", () => {
  it("puts red above orange above green regardless of count", () => {
    const readings = [
      reading({ over: { id: "quiet", severityWhenFiring: "orange" }, value: 0 }),
      reading({ over: { id: "loud-orange", severityWhenFiring: "orange" }, value: 3_000 }),
      reading({ over: { id: "one-red", severityWhenFiring: "red" }, value: 4 }),
    ];
    expect(orderReadings({ readings }).map((row) => row.probe.id)).toEqual(["one-red", "loud-orange", "quiet"]);
  });

  it("breaks a tie on id, so two runs over identical numbers produce identical cards", () => {
    const readings = [reading({ over: { id: "zulu" }, value: 5 }), reading({ over: { id: "alpha" }, value: 5 })];
    expect(orderReadings({ readings }).map((row) => row.probe.id)).toEqual(["alpha", "zulu"]);
    expect(orderReadings({ readings: [...readings].toReversed() }).map((row) => row.probe.id)).toEqual([
      "alpha",
      "zulu",
    ]);
  });

  it("ranks a silent heartbeat above a loud ordinary row, because it is the alarming one", () => {
    const readings = [
      reading({ over: { id: "chatter", severityWhenFiring: "orange" }, value: 3_000 }),
      reading({ over: { alarmWhen: "count-is-zero", id: "heartbeat", severityWhenFiring: "red" }, value: 0 }),
    ];
    expect(orderReadings({ readings }).map((row) => row.probe.id)).toEqual(["heartbeat", "chatter"]);
  });
});

describe("the probe schema's caps agree with the card's own", () => {
  it("refuses a title the digest form would refuse", () => {
    const failure = unwrapErr(parseAlertProbeSet({ value: { probes: [probe({ title: "t".repeat(81) })] } }));
    expect(failure.code).toBe("PROBE_SET_INVALID");
  });

  it("accepts a title exactly at the digest item's cap", () => {
    const title = "t".repeat(80);
    const set = unwrap(parseAlertProbeSet({ value: { probes: [probe({ title })] } }));
    const parsedProbe: AlertProbe = set.probes[0]!;
    expect(parsedProbe.title.length).toBe(80);
  });

  it("refuses a why longer than the digest item's substance cap", () => {
    expect(unwrapErr(parseAlertProbeSet({ value: { probes: [probe({ why: "w".repeat(601) })] } })).code).toBe(
      "PROBE_SET_INVALID",
    );
  });
});

describe("isCardCount — what a digest row can carry as its count", () => {
  it("takes a whole number from zero up to the largest safe integer", () => {
    expect([0, 1, Number.MAX_SAFE_INTEGER].map((value) => isCardCount({ value }))).toEqual([true, true, true]);
  });

  it("refuses a fraction, a negative, and a whole number past the safe bound", () => {
    expect([0.5, -1, 2 ** 53].map((value) => isCardCount({ value }))).toEqual([false, false, false]);
  });
});
