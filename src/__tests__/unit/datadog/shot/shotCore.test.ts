/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { DatadogArgsErrors } from "../../../../cli/commands/datadog/errors.js";
import {
  parseDatadogShotOptions,
  requiredViewFragments,
  SHOT_DEFAULT_AGG,
  SHOT_DEFAULT_FROM,
} from "../../../../cli/commands/datadog/shotCore.js";
import { DATADOG_SHOT_USAGE } from "../../../../cli/commands/datadog/usage.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseDatadogShotOptions", () => {
  it("parses a monitor capture", () => {
    const parsed = parseDatadogShotOptions({ rest: ["monitor", "--id", "600101", "--out", "./shots"] });
    expect(parsed.isOk()).toBe(true);
    const flags = unwrap(parsed);
    expect(flags.subverb).toBe("monitor");
    expect(flags.monitorId).toBe("600101");
    expect(flags.outDir).toBe("./shots");
    expect(flags.json).toBe(false);
  });

  it("defaults the aggregation and the window start, and states both in the usage", () => {
    const flags = unwrap(parseDatadogShotOptions({ rest: ["explorer", "--metric", "copilot.judge.result"] }));
    expect(flags.agg).toBe(SHOT_DEFAULT_AGG);
    expect(flags.from).toBe(SHOT_DEFAULT_FROM);
    expect(flags.to).toBe("now");
    expect(DATADOG_SHOT_USAGE).toContain("--from 1h");
  });

  it("parses a seeded explorer capture with a scope and a group-by", () => {
    const flags = unwrap(
      parseDatadogShotOptions({
        rest: [
          "explorer",
          "--metric",
          "copilot.judge.result",
          "--scope",
          "env:staging",
          "--group",
          "instrumentation_scope",
          "--from",
          "7d",
        ],
      }),
    );
    expect(flags.metric).toBe("copilot.judge.result");
    expect(flags.scope).toBe("env:staging");
    expect(flags.group).toBe("instrumentation_scope");
    expect(flags.from).toBe("7d");
  });

  it("refuses a missing sub-verb", () => {
    const parsed = parseDatadogShotOptions({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("a sub-verb is required");
  });

  it("refuses an unknown sub-verb and lists the real ones", () => {
    const parsed = parseDatadogShotOptions({ rest: ["screenshot"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("monitor, explorer, file");
  });

  it("refuses `monitor` with no id", () => {
    const parsed = parseDatadogShotOptions({ rest: ["monitor"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("--id is required");
  });

  it("refuses a non-numeric monitor id, including a pasted URL", () => {
    const parsed = parseDatadogShotOptions({
      rest: ["monitor", "--id", "https://ap1.datadoghq.com/monitors/600101"],
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("numeric monitor id");
  });

  it("refuses `explorer` with neither an address nor a metric", () => {
    const parsed = parseDatadogShotOptions({ rest: ["explorer"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("--url <address> or --metric <name>");
  });

  it("refuses `explorer` given BOTH an address and a metric, which are alternatives", () => {
    const parsed = parseDatadogShotOptions({ rest: ["explorer", "--url", "https://x/logs", "--metric", "m"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("alternatives");
  });

  it("refuses --id on a sub-verb that does not photograph a monitor", () => {
    const parsed = parseDatadogShotOptions({ rest: ["explorer", "--url", "https://x/logs", "--id", "1"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("--id applies only to `shot monitor`");
  });

  it("refuses --url on the monitor sub-verb", () => {
    const parsed = parseDatadogShotOptions({ rest: ["monitor", "--id", "1", "--url", "https://x/logs"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("apply only to `shot explorer`");
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const parsed = parseDatadogShotOptions({ rest: ["monitor", "--id", "1", "--headed"] });
    expect(unwrapErr(parsed)).toEqual(DatadogArgsErrors.flagsInvalid({ reasons: ["unknown flag: --headed"] }));
    expect(unwrapErr(parsed).message).toBe("unknown flag: --headed");
  });

  it("carries --image through, so `shot file` knows which capture to grade", () => {
    const flags = unwrap(parseDatadogShotOptions({ rest: ["file", "--image", "/tmp/shot.png"] }));
    expect(flags.image).toBe("/tmp/shot.png");
  });

  it("splits --preview-url on commas, so the window proof is a list rather than one string", () => {
    const flags = unwrap(
      parseDatadogShotOptions({ rest: ["file", "--image", "/p.png", "--preview-url", "https://a/x , https://b/y"] }),
    );
    expect(flags.previewUrls).toEqual(["https://a/x", "https://b/y"]);
  });

  it("carries no preview URLs when none were passed, which the judge reads as picker-value", () => {
    expect(unwrap(parseDatadogShotOptions({ rest: ["file", "--image", "/p.png"] })).previewUrls).toEqual([]);
  });

  it("refuses the retired session sub-verbs by name, so a stale script fails loudly", () => {
    expect(unwrapErr(parseDatadogShotOptions({ rest: ["login"] })).message).toContain("not a shot sub-verb");
    expect(unwrapErr(parseDatadogShotOptions({ rest: ["status"] })).message).toContain("not a shot sub-verb");
  });
});

describe("requiredViewFragments", () => {
  it("always requires the metric name", () => {
    expect(requiredViewFragments({ group: null, metric: "copilot.judge.result", scope: null })).toEqual([
      "copilot.judge.result",
    ]);
  });

  it("requires the scope and the group-by when they were asked for", () => {
    expect(requiredViewFragments({ group: "instrumentation_scope", metric: "m", scope: "env:staging" })).toEqual([
      "m",
      "env:staging",
      "instrumentation_scope",
    ]);
  });

  it("ignores an empty scope rather than demanding an empty string appear", () => {
    expect(requiredViewFragments({ group: "", metric: "m", scope: "" })).toEqual(["m"]);
  });
});
