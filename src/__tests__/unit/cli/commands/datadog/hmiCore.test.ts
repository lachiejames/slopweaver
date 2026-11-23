import { describe, expect, it } from "vitest";

import { DatadogArgsErrors } from "../../../../../cli/commands/datadog/errors.js";
import { hmiPlanLines, hmiStateLines, parseDatadogHmiOptions } from "../../../../../cli/commands/datadog/hmiCore.js";
import { hmiDoorRequestFor } from "../../../../../cli/commands/datadog/hmiRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseDatadogHmiOptions", () => {
  it("splits commas across every --metric, in order", () => {
    const options = unwrap(
      parseDatadogHmiOptions({ rest: ["--metric", "a.one, a.two", "--metric=a.three", "--enable", "--json"] }),
    );
    expect(options).toEqual({
      dryRun: false,
      enable: true,
      home: undefined,
      json: true,
      metrics: ["a.one", "a.two", "a.three"],
    });
  });

  it("reads status by default", () => {
    expect(unwrap(parseDatadogHmiOptions({ rest: ["--metric", "a.one"] })).enable).toBe(false);
  });

  it("refuses no --metric, and a --metric that names nothing", () => {
    expect(unwrapErr(parseDatadogHmiOptions({ rest: ["--enable"] }))).toEqual(DatadogArgsErrors.metricMissing());
    expect(unwrapErr(parseDatadogHmiOptions({ rest: ["--metric", ",,"] }))).toEqual(DatadogArgsErrors.metricMissing());
  });

  it("refuses --dry-run without --enable", () => {
    const error = unwrapErr(parseDatadogHmiOptions({ rest: ["--metric", "a.one", "--dry-run"] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toBe("--dry-run only means something with --enable");
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseDatadogHmiOptions({ rest: ["--metric", "a.one", "--disable"] })).code).toBe("FLAGS_INVALID");
  });
});

describe("hmiStateLines", () => {
  it("prints on with its creation instant, and off", () => {
    expect(
      hmiStateLines({
        states: [
          { createdIso: "2026-07-29T23:33:02.845Z", enabled: true, metric: "sdlc.v1.pr.merged_daily" },
          { createdIso: null, enabled: true, metric: "a.one" },
          { enabled: false, metric: "trajectory.task.turns" },
        ],
      }),
    ).toEqual([
      "on   sdlc.v1.pr.merged_daily  (since 2026-07-29T23:33:02.845Z)",
      "on   a.one",
      "off  trajectory.task.turns",
    ]);
  });
});

describe("hmiPlanLines", () => {
  it("names each metric it will switch on", () => {
    expect(hmiPlanLines({ plan: { alreadyOn: ["a.one"], toEnable: ["a.two"] }, verb: "would enable" })).toEqual([
      "would enable 1 metric(s); 1 already on",
      "  + a.two",
    ]);
  });
});

describe("hmiDoorRequestFor", () => {
  it("is an external write naming the metrics it switches on", () => {
    expect(hmiDoorRequestFor({ home: "/tmp/h", metrics: ["a.two"] })).toEqual({
      action: { kind: "verb", noun: "datadog", verb: "hmi" },
      artifact: { metrics: ["a.two"] },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/h", requiresApproval: false },
    });
  });
});
