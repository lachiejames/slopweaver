/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  alertDigestLines,
  buildAlertDigestForm,
  DATADOG_ALERT_DIGEST_FLAG_NAMES,
  datadogAlertDigestReport,
  parseDatadogAlertDigestArgs,
} from "../../../../../cli/commands/datadog/alertDigestCore.js";
import { baselineWindow } from "../../../../../cli/commands/datadog/alertDigestMeasure.js";
import { datadogArgsErrorLines } from "../../../../../cli/commands/datadog/errors.js";
import { DATADOG_ALERT_DIGEST_USAGE, DEFAULT_ALERT_DIGEST_WINDOW } from "../../../../../cli/commands/datadog/usage.js";
import { type AlertProbeReading, parseAlertProbeSet } from "../../../../../datadog/alertProbe.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { digestFormSchema } from "../../../../../outbound/artifact/digest.js";
import { DIGEST_ALERT_LEAD_VISIBLE_MAX } from "../../../../../outbound/artifact/digestFields.js";

/** A reading over a real parsed probe, so no test hand-builds the probe shape. */
function reading({
  id,
  value,
  severityWhenFiring = "orange",
}: {
  id: string;
  value: number;
  severityWhenFiring?: string;
}): AlertProbeReading {
  const set = unwrap(
    parseAlertProbeSet({
      value: {
        probes: [
          {
            id,
            kind: "logs-count",
            query: `service:example-api @check:${id}`,
            severityWhenFiring,
            title: id,
            why: `why ${id} matters to a reader`,
          },
        ],
      },
    }),
  );
  return { citationUrl: `https://example.datadoghq.com/logs?query=${id}`, probe: set.probes[0]!, value };
}

describe("parseDatadogAlertDigestArgs", () => {
  it("resolves a complete invocation", () => {
    const options = unwrap(
      parseDatadogAlertDigestArgs({ rest: ["--probes", "./p.json", "--label", "Knock", "--window", "7d", "--form"] }),
    );
    expect(options.probes).toBe("./p.json");
    expect(options.label).toBe("Knock");
    expect(options.window).toBe("7d");
    expect(options.output).toBe("form");
  });

  it("defaults the window to a day, which is these postings' own cadence", () => {
    const options = unwrap(parseDatadogAlertDigestArgs({ rest: ["--probes", "-", "--label", "Knock"] }));
    expect(options.window).toBe(DEFAULT_ALERT_DIGEST_WINDOW);
    expect(options.output).toBe("text");
  });

  it("reports every usage problem at once rather than the first", () => {
    const error = unwrapErr(parseDatadogAlertDigestArgs({ rest: ["--form", "--json"] }));
    const problems = datadogArgsErrorLines({ error });
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(problems.length).toBe(3);
    expect(problems.some((line) => line.includes("--probes is required"))).toBe(true);
    expect(problems.some((line) => line.includes("--label is required"))).toBe(true);
    expect(problems.some((line) => line.includes("not both"))).toBe(true);
  });

  it("refuses a label the card's own subject cap would refuse, before any query runs", () => {
    const problems = datadogArgsErrorLines({
      error: unwrapErr(parseDatadogAlertDigestArgs({ rest: ["--probes", "-", "--label", "L".repeat(41)] })),
    });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("capped at 40");
  });

  it("accepts a label exactly at the cap", () => {
    const options = unwrap(parseDatadogAlertDigestArgs({ rest: ["--probes", "-", "--label", "L".repeat(40)] }));
    expect(options.label.length).toBe(40);
  });

  it("refuses a window token wider than the card's window label", () => {
    const problems = datadogArgsErrorLines({
      error: unwrapErr(
        parseDatadogAlertDigestArgs({ rest: ["--probes", "-", "--label", "Knock", "--window", "1789352086508"] }),
      ),
    });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("capped at 12");
  });

  it("names every flag it accepts in its own usage line", () => {
    for (const flag of DATADOG_ALERT_DIGEST_FLAG_NAMES) {
      expect(DATADOG_ALERT_DIGEST_USAGE).toContain(flag);
    }
  });
});

/** No impact measured and no baseline read: the shape every enrichment read failing leaves behind. */
const UNENRICHED = {
  impacts: new Map<string, { matched: number; scope: number; service: string }>(),
  trend: undefined,
};

describe("buildAlertDigestForm — the priority matrix and the trend", () => {
  it("always opts into the alerts card, with no trend when no baseline was read", () => {
    const { form } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: undefined,
      readings: [reading({ id: "loud", value: 42 })],
      window: "24h",
    });
    expect(form.alerts).toEqual({});
  });

  it("carries the baseline it was handed as the two raw numbers", () => {
    const { form } = buildAlertDigestForm({
      impacts: UNENRICHED.impacts,
      label: "Knock",
      lead: undefined,
      readings: [reading({ id: "loud", value: 42 })],
      trend: { priorTotal: 30, priorWindows: 3 },
      window: "24h",
    });
    expect(form.alerts).toEqual({ trend: { priorTotal: 30, priorWindows: 3 } });
    expect(digestFormSchema.safeParse(form).success).toBe(true);
  });

  it("attaches each impact to the item of the probe it was measured for, and to no other", () => {
    const impact = { matched: 42, scope: 400, service: "example-api" };
    const { form } = buildAlertDigestForm({
      impacts: new Map([["loud", impact]]),
      label: "Knock",
      lead: undefined,
      readings: [reading({ id: "loud", value: 42 }), reading({ id: "also", value: 1 })],
      trend: undefined,
      window: "24h",
    });
    expect(form.items.map((item) => [item.title, item.impact])).toEqual([
      ["loud", impact],
      ["also", undefined],
    ]);
    expect(digestFormSchema.safeParse(form).success).toBe(true);
  });

  it("fits an authored lead to the alerts cap, which is narrower than the triage one", () => {
    const { form } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: "the nz registration path has been dark since the channels were never created in june.",
      readings: [reading({ id: "loud", value: 42 })],
      window: "24h",
    });
    expect(form.lead!.length).toBeLessThanOrEqual(DIGEST_ALERT_LEAD_VISIBLE_MAX);
    expect(digestFormSchema.safeParse(form).success).toBe(true);
  });
});

describe("baselineWindow", () => {
  it("spans the prior windows of the same length, ending exactly where this window starts", () => {
    const hour = 60 * 60 * 1000;
    expect(baselineWindow({ priorWindows: 3, window: { fromMs: 10 * hour, toMs: 11 * hour } })).toEqual({
      fromMs: 7 * hour,
      toMs: 10 * hour,
    });
  });
});

describe("buildAlertDigestForm", () => {
  it("emits a form the real digest schema accepts, ordered worst first", () => {
    const readings = [
      reading({ id: "quiet", value: 0 }),
      reading({ id: "loud", value: 42 }),
      reading({ id: "critical", severityWhenFiring: "red", value: 1 }),
    ];
    const { form } = buildAlertDigestForm({ ...UNENRICHED, label: "Knock", lead: undefined, readings, window: "24h" });
    expect(form.kind).toBe("digest");
    expect(form.items.map((item) => item.title)).toEqual(["critical", "loud", "quiet"]);
    expect(form.lead).toBeUndefined();
    expect(digestFormSchema.safeParse(form).success).toBe(true);
  });

  it("carries the authored lead when one was supplied", () => {
    const { form, warnings } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: "first post since two sep.",
      readings: [reading({ id: "loud", value: 42 })],
      window: "24h",
    });
    expect(form.lead).toBe("first post since two sep.");
    expect(warnings).toEqual([]);
    expect(digestFormSchema.safeParse(form).success).toBe(true);
  });

  it("drops a lead carrying a digit the rows cannot account for, and says why", () => {
    const { form, warnings } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: "only 3 failures today.",
      readings: [reading({ id: "loud", value: 19 })],
      window: "24h",
    });
    expect(form.lead).toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("--lead was dropped");
  });

  it("keeps a lead whose only digits are inside a row's own title", () => {
    const { form, warnings } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: "http 422 rejects are the whole story.",
      readings: [reading({ id: "http 422 rejects", value: 19 })],
      window: "24h",
    });
    expect(form.lead).toBe("http 422 rejects are the whole story.");
    expect(warnings).toEqual([]);
  });

  it("treats an all-whitespace lead as absent, which is what the card would show anyway", () => {
    const { form, warnings } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: "   \n  ",
      readings: [reading({ id: "loud", value: 19 })],
      window: "24h",
    });
    expect(form.lead).toBeUndefined();
    expect(warnings).toEqual(["--lead was dropped: it carries no words"]);
    expect(digestFormSchema.safeParse(form).success).toBe(true);
  });

  it("copies each count rather than deriving one, so no number can be authored", () => {
    const { form } = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Knock",
      lead: undefined,
      readings: [reading({ id: "a", value: 19 }), reading({ id: "b", value: 0 })],
      window: "24h",
    });
    expect(form.items.map((item) => item.count)).toEqual([19, 0]);
  });
});

describe("the human report and the machine document", () => {
  it("prints one line per probe and ends with a runnable post pipe", () => {
    const options = unwrap(parseDatadogAlertDigestArgs({ rest: ["--probes", "./p.json", "--label", "Knock"] }));
    const lines = alertDigestLines({
      channelHint: undefined,
      options,
      readings: [reading({ id: "a", value: 19 }), reading({ id: "b", value: 0 })],
    });
    expect(lines[0]).toBe("alert digest — Knock over 24h");
    expect(lines[1]).toBe("2 probe(s) ran, 1 firing");
    expect(lines.at(-1)).toContain("slopweaver slack post --as bot --channel <channel-id> --form - --dry-run");
  });

  it("names the destination channel in the pipe when the caller knows it", () => {
    const options = unwrap(parseDatadogAlertDigestArgs({ rest: ["--probes", "./p.json", "--label", "Knock"] }));
    const lines = alertDigestLines({ channelHint: "C0ALERTS", options, readings: [reading({ id: "a", value: 1 })] });
    expect(lines.at(-1)).toContain("--channel C0ALERTS");
  });

  it("carries every reading, its query and its citation into the machine document", () => {
    const options = unwrap(parseDatadogAlertDigestArgs({ rest: ["--probes", "./p.json", "--label", "Knock"] }));
    const readings = [reading({ id: "a", value: 19 }), reading({ id: "b", value: 0 })];
    const { form } = buildAlertDigestForm({ ...UNENRICHED, label: "Knock", lead: undefined, readings, window: "24h" });
    const report = datadogAlertDigestReport({
      form,
      fromMs: 1_789_352_086_508,
      options,
      readings,
      recommendations: { dropped: [], kept: [] },
      residue: ["a phrase match drifts"],
      toMs: 1_789_438_486_508,
    });
    expect(report.probesRun).toBe(2);
    expect(report.probesFiring).toBe(1);
    expect(report.readings.map((row) => row.id)).toEqual(["a", "b"]);
    expect(report.readings[0]!.query).toBe("service:example-api @check:a");
    expect(report.readings[0]!.citationUrl).toBe("https://example.datadoghq.com/logs?query=a");
    expect(report.residue).toEqual(["a phrase match drifts"]);
    expect(report.fromMs).toBe(1_789_352_086_508);
  });
});

describe("the recommendations lane on a digest", () => {
  /** What six loud, wordy probes leave room for, and what that costs the tail. Measured, not chosen. */
  const KEPT_WHEN_LOUD = 2;
  const DROPPED_WHEN_LOUD = ["over-cap", "shed-to-fit", "shed-to-fit", "shed-to-fit"];

  /** A firing reading whose probe carries a long `why`, which is what fills a real card's detail. */
  function wordyReading({
    id,
    value,
    severityWhenFiring,
  }: {
    id: string;
    value: number;
    severityWhenFiring: string;
  }): AlertProbeReading {
    const declared = reading({ id, severityWhenFiring, value });
    return { ...declared, probe: { ...declared.probe, why: `${id}: ${"reason ".repeat(38)}`.slice(0, 280) } };
  }

  /** One authored recommendation clearing the probe named `hot`. */
  const CLEARS_HOT = {
    act: "raise-pr",
    change: "exclude TaskTransitionError, which is one stuck draft plan rather than a defect",
    clears: "hot",
    evidenceUrl: "https://ap1.datadoghq.com/monitors/100001",
  } as const;

  /** One opportunity, which nothing has to fire for. */
  const OPPORTUNITY = {
    act: "change-config",
    change: "publish the muted NZ payment heartbeat",
    evidenceUrl: "https://ap1.datadoghq.com/monitors/700002",
  } as const;

  it("puts an act on the card when its probe FIRED, coloured by that probe's own severity", () => {
    const built = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings: [reading({ id: "hot", severityWhenFiring: "red", value: 12 })],
      recommendations: [CLEARS_HOT],
      window: "24h",
    });

    expect(built.form.recommendations).toEqual([
      { act: "raise-pr", change: CLEARS_HOT.change, evidenceUrl: CLEARS_HOT.evidenceUrl, finding: "red" },
    ]);
    expect(built.recommendations.dropped).toEqual([]);
    expect(digestFormSchema.safeParse(built.form).success).toBe(true);
  });

  it("leaves an act OFF when its probe counted zero, and says why rather than silently", () => {
    const built = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings: [reading({ id: "hot", value: 0 })],
      recommendations: [CLEARS_HOT],
      window: "24h",
    });

    expect(built.form.recommendations).toBeUndefined();
    expect(built.recommendations.dropped).toEqual([
      { change: CLEARS_HOT.change, clears: "hot", reason: "not-fired-this-window" },
    ]);
  });

  it("carries an opportunity on a quiet day, when nothing fired at all", () => {
    const built = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings: [reading({ id: "hot", value: 0 })],
      recommendations: [OPPORTUNITY],
      window: "24h",
    });

    expect(built.form.recommendations).toEqual([OPPORTUNITY]);
  });

  it("SHEDS from the tail when the card's own prose leaves no room, and warns for each line", () => {
    // Eight loud probes each carrying a long `why` is the integrity-audit row's real shape: the card's own
    // below-fold paragraphs fill the detail cap before a recommendation is even considered.
    const readings = ["one", "two", "three", "four", "five", "six"].map((id) =>
      wordyReading({ id, severityWhenFiring: "red", value: 9 }),
    );
    const authored = readings.map((declared, position) => ({
      act: "tune-monitor" as const,
      change: `tune the ${declared.probe.id} threshold, position ${String(position)}`,
      clears: declared.probe.id,
      evidenceUrl: `https://ap1.datadoghq.com/monitors/${String(position)}`,
    }));
    const built = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings,
      recommendations: authored,
      window: "24h",
    });

    expect(built.recommendations.kept.length).toBe(KEPT_WHEN_LOUD);
    expect(built.recommendations.dropped.map((dropped) => dropped.reason)).toEqual(DROPPED_WHEN_LOUD);
    // The trend sentence gives way BEFORE any recommendation does, so its line is there beside every shed one.
    expect(built.warnings.length).toBe(DROPPED_WHEN_LOUD.filter((reason) => reason === "shed-to-fit").length + 1);
    expect(built.warnings.at(-1)).toBe(
      "the trend-baseline sentence was left off the card's detail so the rest fits the below-fold budget",
    );
    expect(digestFormSchema.safeParse(built.form).success).toBe(true);
  });

  it("never claims a fit when the items alone overrun the card, even after every recommendation is shed", () => {
    const readings = ["p1", "p2", "p3", "p4"].map((id) => {
      const declared = reading({ id, severityWhenFiring: "red", value: 1 });
      return { ...declared, probe: { ...declared.probe, why: `${id} `.repeat(200).slice(0, 600) } };
    });
    const built = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings,
      recommendations: [{ ...CLEARS_HOT, clears: "p1" }],
      window: "24h",
    });

    expect(built.recommendations.kept).toEqual([]);
    expect(built.warnings.filter((line) => line.startsWith("recommendation shed"))).toEqual([
      `recommendation shed, and the card is still over its caps without it, so the door refuses it unless this session holds a truncated-send grant: ${CLEARS_HOT.change}`,
    ]);
    expect(digestFormSchema.safeParse(built.form).success).toBe(false);
  });

  it("still emits the card when a `clears` names no declared probe, reporting the typo", () => {
    // A typo used to exit before the form was written, so one mistyped key cost the whole card at the
    // unattended hour. It is a reported drop now, told apart from a quiet probe.
    const built = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings: [reading({ id: "hot", severityWhenFiring: "red", value: 12 })],
      recommendations: [{ ...CLEARS_HOT, clears: "hto" }],
      window: "24h",
    });

    expect(built.form.items.length).toBe(1);
    expect(built.form.recommendations).toBeUndefined();
    expect(built.recommendations.dropped).toEqual([
      { change: CLEARS_HOT.change, clears: "hto", reason: "clears-unknown" },
    ]);
    expect(built.warnings).toEqual([
      "a recommendation clears 'hto', which this row declares no probe for, so it can never be shown — " +
        `fix the key or drop the recommendation: ${CLEARS_HOT.change}`,
    ]);
  });

  it("emits exactly the form it always did when no row turned the lane on", () => {
    const plain = buildAlertDigestForm({
      ...UNENRICHED,
      label: "Payments",
      lead: undefined,
      readings: [reading({ id: "hot", value: 3 })],
      window: "24h",
    });

    expect(plain.form.recommendations).toBeUndefined();
    expect(plain.recommendations).toEqual({ dropped: [], kept: [] });
  });

  it("publishes --recommendations in both the flag list and the usage", () => {
    expect(DATADOG_ALERT_DIGEST_FLAG_NAMES).toContain("--recommendations");
    expect(DATADOG_ALERT_DIGEST_USAGE).toContain("--recommendations");
  });
});
