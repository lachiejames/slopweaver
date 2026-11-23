/**
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import {
  alertSummaryLines,
  buildAlertSummaryForm,
  parseSlackAlertSummaryArgs,
  SLACK_ALERT_SUMMARY_FLAG_NAMES,
  slackAlertSummaryReport,
  withSummaryRecommendations,
} from "../../../../../cli/commands/slack/alertSummaryCore.js";
import { SlackArgumentErrors, slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import {
  DEFAULT_ALERT_LABEL,
  DEFAULT_ALERT_WINDOW,
  SLACK_ALERT_SUMMARY_USAGE,
} from "../../../../../cli/commands/slack/verbUsage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AlertTally } from "../../../../../live/slack/alertTally.js";
import { alertSummaryFormSchema } from "../../../../../outbound/artifact/alertSummary.js";

/** A tally standing in for a read window. Alert names invented — this is a public repository. */
function tally(): AlertTally {
  return {
    fired: [
      { count: 240, name: "upstream latency", severity: "red" },
      { count: 97, name: "token refresh 401" },
      { count: 12, name: "queue depth high" },
    ],
    read: 61,
    rows: [
      { count: 240, label: "upstream latency" },
      { count: 97, label: "token refresh 401" },
      { count: 12, label: "queue depth high" },
    ],
    skipped: 4,
    total: 349,
  };
}

describe("parseSlackAlertSummaryArgs — every rejection is I/O-free", () => {
  it("defaults the window and the label, and reports as text", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1"] }));

    expect(options.channel).toBe("D1");
    expect(options.window.label).toBe(DEFAULT_ALERT_WINDOW);
    expect(options.label).toBe(DEFAULT_ALERT_LABEL);
    expect(options.output).toBe("text");
    expect(options.lead).toBeUndefined();
    expect(options.home).toBeUndefined();
  });

  it("reads --intro as day-one lines and refuses a value that is not a list of them", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--intro", '["a trial."]'] }));

    expect(options.intro).toEqual(["a trial."]);
    expect(
      slackArgumentErrorLines({
        error: unwrapErr(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--intro", "a trial."] })),
      }),
    ).toEqual([`--intro is not JSON: pass a JSON array of lines, e.g. '["this is a trial."]'`]);
  });

  it("accepts every flag it advertises", () => {
    const options = unwrap(
      parseSlackAlertSummaryArgs({
        rest: [
          "--channel",
          "D1",
          "--window",
          "24h",
          "--label",
          "Platform",
          "--json",
          "--lead",
          "Upstream is drowning the rest.",
          "--home",
          "/tmp",
        ],
      }),
    );

    expect(options).toEqual({
      channel: "D1",
      home: "/tmp",
      label: "Platform",
      lead: "Upstream is drowning the rest.",
      output: "json",
      window: { label: "24h", ms: 86_400_000 },
    });
  });

  it("REFUSES a missing --channel, and says a DM is where to try it first", () => {
    const parsed = parseSlackAlertSummaryArgs({ rest: [] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]!).toContain("--channel is required");
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]!).toContain("A DM id works");
  });

  it("REFUSES a bad window BEFORE anything else, which is what keeps the reject path I/O-free", () => {
    const parsed = parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--window", "7 days"] });

    expect(parsed.isErr()).toBe(true);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]!).toContain("invalid --window");
  });

  it("accumulates EVERY problem in one pass rather than stopping at the first", () => {
    const parsed = parseSlackAlertSummaryArgs({ rest: ["--window", "nope", "--form", "--json"] });

    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) }).length).toBe(3);
  });

  it("REFUSES --form with --json, because they are two different documents", () => {
    const parsed = parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--form", "--json"] });

    expect(parsed.isErr()).toBe(true);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) }).join(" ")).toContain(
      "pass --form or --json, not both",
    );
  });

  it("REFUSES a flag it does not know, rather than ignoring it", () => {
    const parsed = parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--severity", "high"] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("FLAGS_INVALID");
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]!).toContain("unknown flag: --severity");
  });

  it("REFUSES a value flag given no value", () => {
    expect(unwrapErr(parseSlackAlertSummaryArgs({ rest: ["--channel"] }))).toEqual(
      SlackArgumentErrors.flagsInvalid({ reasons: ["--channel requires a value"] }),
    );
  });

  it("publishes its flag names, and the usage advertises exactly those", () => {
    expect(SLACK_ALERT_SUMMARY_FLAG_NAMES).toEqual([
      "--channel",
      "--form",
      "--home",
      "--intro",
      "--json",
      "--label",
      "--lead",
      "--recommendations",
      "--window",
    ]);
    const advertised = [...new Set(SLACK_ALERT_SUMMARY_USAGE.match(/--[a-z][a-z0-9-]*/g))].toSorted();

    expect(advertised).toEqual(SLACK_ALERT_SUMMARY_FLAG_NAMES);
  });
});

describe("buildAlertSummaryForm — transcribes counted facts and adds no number", () => {
  it("builds a form the schema accepts, with no total field in it", () => {
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: "Upstream is drowning the rest.",
      omitted: undefined,
      rows: tally().rows,
      skipped: 4,
      window: "7d",
    });

    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
    expect(Object.hasOwn(form, "total")).toBe(false);
  });

  it("omits `lead` and `omitted` entirely rather than carrying an undefined, which the strict form refuses", () => {
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: tally().rows,
      skipped: 0,
      window: "7d",
    });

    expect(Object.hasOwn(form, "lead")).toBe(false);
    expect(Object.hasOwn(form, "omitted")).toBe(false);
    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
  });

  it("carries the folded tail through, so the derived total covers the whole window", () => {
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: { count: 23, monitors: 7 },
      rows: tally().rows,
      skipped: 0,
      window: "7d",
    });

    expect(form.omitted).toEqual({ count: 23, monitors: 7 });
    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
  });

  it("builds an acceptable form from an EMPTY window, because quiet is a result", () => {
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: [],
      skipped: 12,
      window: "7d",
    });

    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
  });
});

describe("alertSummaryLines — the human report ends with a command you can paste", () => {
  it("states what was read, right-aligns the counts, and prints the pipe to post it", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1"] }));
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: "Upstream is drowning the rest.",
      omitted: undefined,
      rows: tally().rows,
      skipped: 4,
      window: "7d",
    });
    const lines = alertSummaryLines({ form, options, pageCount: 2, tally: tally() });

    expect(lines[0]).toBe("alert summary — channel=D1 window=7d");
    expect(lines[1]).toBe(
      "read 61 message(s) across 2 page(s): 349 notification(s) across 3 alert(s), 4 not recognised",
    );
    expect(lines[3]).toBe("  240 × upstream latency");
    expect(lines[5]).toBe("   12 × queue depth high");
    expect(lines.at(-2)).toBe("  slopweaver slack alert-summary --channel D1 --window 7d --form \\");
    expect(lines.at(-1)).toBe("    | slopweaver slack post --as bot --channel D1 --form - --dry-run");
  });

  it("says the lead is absent rather than printing an empty line for it", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1"] }));
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: tally().rows,
      skipped: 4,
      window: "7d",
    });

    expect(alertSummaryLines({ form, options, pageCount: 1, tally: tally() })).toContain(
      "lead: (none — the card goes out with its counts only)",
    );
  });

  it("names a quiet window in words rather than printing nothing under the heading", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1"] }));
    const empty: AlertTally = { fired: [], read: 0, rows: [], skipped: 0, total: 0 };
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: [],
      skipped: 0,
      window: "7d",
    });

    expect(alertSummaryLines({ form, options, pageCount: 1, tally: empty })).toContain(
      "  (nothing fired in this window)",
    );
  });

  it("says nothing was RECOGNISED, never that nothing fired, when every message read went unrecognised", () => {
    // This fixture is the measured case itself — 9 messages read, 9 skipped, none recognised — and it is what
    // this assertion used to read `(nothing fired in this window)` against, two lines under a report line
    // that had just printed both counts.
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1"] }));
    const unparsed: AlertTally = { fired: [], read: 9, rows: [], skipped: 9, total: 0 };
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: [],
      skipped: 9,
      window: "7d",
    });

    expect(alertSummaryLines({ form, options, pageCount: 1, tally: unparsed })).toContain(
      "  (nothing recognised in this window: all 9 message(s) read went unrecognised)",
    );
  });

  it("reports the folded tail as still counted, so the report cannot read as complete coverage", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1"] }));
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: { count: 23, monitors: 7 },
      rows: tally().rows,
      skipped: 0,
      window: "7d",
    });

    expect(alertSummaryLines({ form, options, pageCount: 1, tally: tally() })).toContain(
      "omitted from the card's table: 7 quieter alert(s), 23 firing(s) — still counted in the total",
    );
  });
});

describe("slackAlertSummaryReport — the machine document", () => {
  it("carries the form plus every fact about how it was sourced", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--window", "24h", "--json"] }));
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: "Upstream is drowning the rest.",
      omitted: undefined,
      rows: tally().rows,
      skipped: 4,
      window: "24h",
    });
    const report = slackAlertSummaryReport({
      form,
      oldestTs: "1799996400",
      options,
      pageCount: 2,
      recommendations: { dropped: [], kept: [] },
      tally: tally(),
      warnings: [],
    });

    expect(report).toEqual({
      channel: "D1",
      distinctAlerts: 3,
      firedNames: ["upstream latency", "token refresh 401", "queue depth high"],
      form,
      leadWritten: true,
      messagesRead: 61,
      notifications: 349,
      oldestTs: "1799996400",
      pageCount: 2,
      recommendations: { dropped: [], kept: [] },
      skipped: 4,
      warnings: [],
      window: "24h",
    });
  });

  it("states leadWritten FALSE and carries the reason, so an absent sentence is never a mystery", () => {
    const options = unwrap(parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", "--json"] }));
    const form = buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: tally().rows,
      skipped: 4,
      window: "7d",
    });
    const report = slackAlertSummaryReport({
      form,
      oldestTs: "1",
      options,
      pageCount: 1,
      recommendations: { dropped: [], kept: [] },
      tally: tally(),
      warnings: ["no editorial sentence was written"],
    });

    expect(report.leadWritten).toBe(false);
    expect(report.warnings).toEqual(["no editorial sentence was written"]);
  });
});

describe("the recommendations lane on an alert summary", () => {
  /** An act clearing an alert whose STABLE name the tally counted, table row or not. */
  const CLEARS_QUIET = {
    act: "tune-monitor",
    change: "widen the AU heartbeat window from 2h to 6h — every gap fell overnight",
    clears: "queue depth high",
    evidenceUrl: "https://ap1.datadoghq.com/monitors/700002",
  } as const;

  /** A form built from the fixture tally, which is what the verb hands the lane. */
  function form() {
    return buildAlertSummaryForm({
      label: "Alerts",
      lead: undefined,
      omitted: undefined,
      rows: tally().rows,
      skipped: 4,
      window: "7d",
    });
  }

  it("matches on the alert's stable name and colours the line with its own severity", () => {
    const recommended = withSummaryRecommendations({
      authored: [{ ...CLEARS_QUIET, clears: "upstream latency" }],
      form: form(),
      tally: tally(),
    });

    expect(recommended.form.recommendations).toEqual([
      { act: "tune-monitor", change: CLEARS_QUIET.change, evidenceUrl: CLEARS_QUIET.evidenceUrl, finding: "red" },
    ]);
    expect(alertSummaryFormSchema.safeParse(recommended.form).success).toBe(true);
  });

  it("colours an alert that fired with no state ORANGE rather than guessing red", () => {
    const unstated = withSummaryRecommendations({ authored: [CLEARS_QUIET], form: form(), tally: tally() });

    expect(unstated.form.recommendations?.[0]?.finding).toBe("orange");
  });

  it("drops an act whose alert did not fire this window, naming the key it looked for", () => {
    const recommended = withSummaryRecommendations({
      authored: [{ ...CLEARS_QUIET, clears: "a monitor that stayed quiet" }],
      form: form(),
      tally: tally(),
    });

    expect(recommended.form.recommendations).toBeUndefined();
    expect(recommended.recommendations.dropped).toEqual([
      { change: CLEARS_QUIET.change, clears: "a monitor that stayed quiet", reason: "not-fired-this-window" },
    ]);
  });

  it("leaves the form exactly as built when no row turned the lane on", () => {
    const untouched = withSummaryRecommendations({ authored: [], form: form(), tally: tally() });

    expect(untouched.form).toEqual(form());
    expect(untouched.recommendations).toEqual({ dropped: [], kept: [] });
  });
});
