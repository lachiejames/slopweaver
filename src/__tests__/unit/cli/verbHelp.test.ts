/**
 * `--help` at the dispatch boundary. `wantsHelp` reads from argv[3] onward ON PURPOSE: a default-verb noun
 * (`slopweaver doctor --help`) carries the flag at argv[3], so that index is pinned as a help request rather
 * than skipped as "the verb". `renderVerbHelp` prints summary, usage, and the example only when there is one.
 */
import { describe, expect, it } from "vitest";

import type { CommandMeta } from "../../../cli/defineCommand.js";
import { renderVerbHelp, wantsHelp } from "../../../cli/verbHelp.js";

const BASE_META: CommandMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver doctor run --json",
  parseRejectIsIoFree: true,
  summary: "Check this install's health.",
  usage: "usage: slopweaver doctor run [--json]",
};

describe("wantsHelp", () => {
  it("answers true for --help after a routed verb", () => {
    expect(wantsHelp({ argv: ["node", "cli", "doctor", "run", "--help"] })).toBe(true);
  });

  it("answers true for -h later in the tail", () => {
    expect(wantsHelp({ argv: ["node", "cli", "github", "pr", "--number", "12", "-h"] })).toBe(true);
  });

  it("answers true for --help at argv[3], where a default-verb noun carries it", () => {
    expect(wantsHelp({ argv: ["node", "cli", "doctor", "--help"] })).toBe(true);
  });

  it("answers false when the tail carries no help flag", () => {
    expect(wantsHelp({ argv: ["node", "cli", "doctor", "run", "--json"] })).toBe(false);
  });

  it("answers false for a flag that only begins with --help", () => {
    expect(wantsHelp({ argv: ["node", "cli", "slack", "post", "--help-text", "x"] })).toBe(false);
  });

  it("ignores a help-looking value in argv[0] to argv[2]", () => {
    expect(wantsHelp({ argv: ["--help", "-h", "--help", "run"] })).toBe(false);
  });
});

describe("renderVerbHelp", () => {
  it("renders summary, usage, a blank line and the example when there is one", () => {
    expect(renderVerbHelp({ meta: BASE_META })).toBe(
      [
        "Check this install's health.",
        "usage: slopweaver doctor run [--json]",
        "",
        "example: slopweaver doctor run --json",
      ].join("\n"),
    );
  });

  it("renders summary and usage only, with no trailing blank line, when the example is null", () => {
    expect(renderVerbHelp({ meta: { ...BASE_META, example: null } })).toBe(
      "Check this install's health.\nusage: slopweaver doctor run [--json]",
    );
  });
});
