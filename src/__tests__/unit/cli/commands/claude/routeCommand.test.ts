import { describe, expect, it } from "vitest";

import { claudeRouteCommand, parseClaudeRouteArgs } from "../../../../../cli/commands/claude/routeRun.js";
import { claudeManifest } from "../../../../../cli/manifests/claude.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("claudeRouteCommand", () => {
  it("takes the CLI verb contract's single argv parameter", () => {
    expect(claudeRouteCommand.length).toBe(1);
  });

  it("is registered as LOCAL-STATE, because the gate it shares with a spawn can repair a credential", () => {
    // It used to be `external-read`, and the promise in this verb's own header said no code path it reaches
    // writes a credential. That changed deliberately: the gate now repairs a store the provider refused whose
    // access token has merely expired, by running the CLI's own OAuth refresh under it. Being the SAME call a
    // spawn makes is the property this verb exists for, so it gets the repair too — and a reader who wants the
    // gauges with no chance of a write has `claude gauge`, which shares the probe and not the wrapper.
    const entry = claudeManifest["route"]!;
    expect(entry.meta.effect).toBe("local-state");
    expect(entry.meta.diagnostic).toBe(true);
    expect(entry.meta.usage).toBe("usage: slopweaver claude route [--model <model>]");
  });
});

describe("parseClaudeRouteArgs", () => {
  it("routes the default model when none is named", () => {
    expect(unwrap(parseClaudeRouteArgs({ rest: [] }))).toStrictEqual({});
  });

  it("reads both spellings of --model", () => {
    expect(unwrap(parseClaudeRouteArgs({ rest: ["--model", "fable"] }))).toStrictEqual({ model: "fable" });
    expect(unwrap(parseClaudeRouteArgs({ rest: ["--model=opus"] }))).toStrictEqual({ model: "opus" });
  });

  it("refuses --model with no value", () => {
    expect(unwrapErr(parseClaudeRouteArgs({ rest: ["--model"] }))).toStrictEqual(["--model requires a value"]);
  });

  it("refuses a flag it does not know, rather than routing as though it were absent", () => {
    expect(unwrapErr(parseClaudeRouteArgs({ rest: ["--modle", "fable"] }))).toStrictEqual([
      "unknown flag: --modle",
      "unexpected argument: fable",
    ]);
  });
});
