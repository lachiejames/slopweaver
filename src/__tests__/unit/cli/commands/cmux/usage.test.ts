/**
 * {@link runCmuxUsage}'s argv edges and its two pure halves: which flags it takes, which harness it refuses, and what it
 * makes of each answer the app's socket can give. The fold and the print are `sessionHarness/appUsage.test.ts` and
 * `cli/cmuxUsageOutput.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { answeredReportOf, runCmuxUsage, usageAskOf } from "../../../../../cli/commands/cmux/usage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";

const AT = "2026-11-11T02:00:00.000Z";

describe("usageAskOf", () => {
  it("asks for the app's usage with the home and JSON flags it was given", () => {
    expect(usageAskOf({ rest: ["--harness", "app", "--home", "/tmp/acme-home", "--json"] })).toEqual({
      home: "/tmp/acme-home",
      json: true,
      kind: "ask",
    });
    expect(usageAskOf({ rest: ["--harness", "app"] })).toEqual({ home: undefined, json: false, kind: "ask" });
  });

  it("refuses the cmux harness, named or by default, because cmux hosts no worker to count a turn", () => {
    const refusal = {
      kind: "refused",
      lines: ["cmux usage: only --harness app counts a session's turns; cmux hosts no worker to read"],
    };
    expect(usageAskOf({ rest: [] })).toEqual(refusal);
    expect(usageAskOf({ rest: ["--harness", "cmux"] })).toEqual(refusal);
  });

  it("refuses a harness that does not exist by naming the ones that do", () => {
    expect(usageAskOf({ rest: ["--harness", "tmux"] })).toEqual({
      kind: "refused",
      lines: ['cmux usage: --harness must be one of cmux, app, not "tmux"'],
    });
  });

  it("refuses a flag the verb does not take, then prints its usage", () => {
    const ask = usageAskOf({ rest: ["--harness", "app", "--model", "opus"] });
    expect(ask.kind).toBe("refused");
    expect(ask).toMatchObject({ lines: ["unknown flag: --model", expect.stringContaining("cmux usage")] });
  });
});

describe("answeredReportOf", () => {
  it("carries the app's report through", () => {
    const report = { atIso: AT, sessions: [] };
    expect(answeredReportOf({ answered: ok({ kind: "usage", report }) })).toEqual({ kind: "report", report });
  });

  it("names an app that predates usage apart from any other refusal", () => {
    expect(
      answeredReportOf({ answered: err({ code: "BAD_REQUEST", kind: "refused", message: "unknown request kind" }) }),
    ).toEqual({ kind: "failed", line: "cmux usage: this app predates usage; update the Slopweaver desktop app" });
    expect(
      answeredReportOf({ answered: err({ code: "OPERATION_FAILED", kind: "refused", message: "the fold threw" }) }),
    ).toEqual({ kind: "failed", line: "cmux usage: the fold threw" });
  });

  it("passes an unreachable app's message through", () => {
    expect(
      answeredReportOf({
        answered: err({ causeCode: "ENOENT", kind: "unreachable", message: "the app is not serving sessions" }),
      }),
    ).toEqual({ kind: "failed", line: "cmux usage: the app is not serving sessions" });
  });

  it("refuses an answer of any other kind", () => {
    expect(answeredReportOf({ answered: ok({ kind: "aborted" }) })).toEqual({
      kind: "failed",
      line: "cmux usage: the desktop app answered aborted, not usage",
    });
  });
});

describe("runCmuxUsage", () => {
  it("prints its usage and succeeds on --help", async () => {
    expect(await runCmuxUsage(["node", "slopweaver", "cmux", "usage", "--help"])).toBe(EXIT_OK);
  });

  it("refuses the cmux harness before it reaches the app", async () => {
    expect(await runCmuxUsage(["node", "slopweaver", "cmux", "usage", "--harness", "cmux"])).toBe(EXIT_USAGE);
  });
});
