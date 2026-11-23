/**
 * `slack when` — the verb that exists so nobody converts a Slack `ts` in their head.
 *
 * Every expected instant is a literal, never a recomputation: a test that derives its expectation the same
 * way the code does cannot fail when the derivation is wrong, which is precisely the defect this verb is
 * about.
 */
import { describe, expect, it } from "vitest";
import { SlackArgumentErrors } from "../../../../../cli/commands/slack/argumentErrors.js";

import { parseSlackWhenArgs, renderSlackWhen, slackWhenReport } from "../../../../../cli/commands/slack/whenCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseSlackWhenArgs", () => {
  it("takes every input as a positional, in the order given", () => {
    expect(unwrap(parseSlackWhenArgs({ rest: ["1788220579.306599", "1785114398.557099"] })).inputs).toEqual([
      "1788220579.306599",
      "1785114398.557099",
    ]);
  });

  it("defaults to the human lane", () => {
    expect(unwrap(parseSlackWhenArgs({ rest: ["1788220579.306599"] })).json).toBe(false);
  });

  it("reads --json", () => {
    expect(unwrap(parseSlackWhenArgs({ rest: ["--json", "1788220579.306599"] })).json).toBe(true);
  });

  it("refuses an invocation naming nothing to convert", () => {
    const parsed = parseSlackWhenArgs({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(SlackArgumentErrors.whenInputMissing());
    expect(unwrapErr(parsed).message).toBe("slack when: name at least one Slack ts or permalink");
  });
});

describe("slackWhenReport", () => {
  it("derives the instant the incident got 80 minutes wrong", () => {
    expect(unwrap(slackWhenReport({ inputs: ["1788220579.306599"] })).conversions).toEqual([
      { input: "1788220579.306599", iso: "2026-08-31T23:56:19.000Z", ts: "1788220579.306599" },
    ]);
  });

  it("reads the ts out of a permalink and says which input it came from", () => {
    expect(
      unwrap(slackWhenReport({ inputs: ["https://acme.slack.com/archives/C123/p1788220579306599"] })).conversions,
    ).toEqual([
      {
        input: "https://acme.slack.com/archives/C123/p1788220579306599",
        iso: "2026-08-31T23:56:19.000Z",
        permalink: "https://acme.slack.com/archives/C123/p1788220579306599",
        ts: "1788220579.306599",
      },
    ]);
  });

  it("converts several inputs in the order given", () => {
    const report = unwrap(slackWhenReport({ inputs: ["1788220579.306599", "1785114398.557099"] }));
    expect(report.conversions.map((one) => one.iso)).toEqual(["2026-08-31T23:56:19.000Z", "2026-07-27T01:06:38.000Z"]);
  });

  it("refuses the WHOLE invocation when one input is not a timestamp", () => {
    const report = slackWhenReport({ inputs: ["1788220579.306599", "sometime tuesday"] });
    expect(report.isErr()).toBe(true);
    expect(unwrapErr(report)).toEqual(["sometime tuesday: not a Slack ts and carries no permalink timestamp"]);
  });

  it("carries a stable document identity for a machine consumer", () => {
    const report = unwrap(slackWhenReport({ inputs: ["1788220579.306599"] }));
    expect(report.kind).toBe("slopweaver.slack.when");
    expect(report.schemaVersion).toBe(1);
  });
});

describe("renderSlackWhen", () => {
  it("prints tab-separated ts and instant, one line per input", () => {
    expect(renderSlackWhen({ report: unwrap(slackWhenReport({ inputs: ["1788220579.306599", "1785114398"] })) })).toBe(
      "1788220579.306599\t2026-08-31T23:56:19.000Z\n1785114398\t2026-07-27T01:06:38.000Z",
    );
  });
});
