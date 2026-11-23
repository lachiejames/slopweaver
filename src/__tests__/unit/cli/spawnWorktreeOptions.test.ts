import { describe, expect, it } from "vitest";
import { spawnWorktreeOptions } from "../../../cli/commands/cmux/spawnWorktreeOptions.js";
import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { ParsedFlags } from "../../../cli/parseFlags.js";

/** The parsed shape `cmux spawn` hands this leaf, with only the flags a case is about. */
function parsed({ values }: { values: Readonly<Record<string, string | boolean>> }): ParsedFlags {
  return { positionals: [], values };
}

describe("spawnWorktreeOptions", () => {
  it("defaults to the verb's own rule: install on, own tree, no tsc build, built CLI emitted", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: {} }) })).toEqual({
      build: false,
      deps: "own",
      devBuild: true,
      install: true,
    });
  });

  it("turns the built CLI off for --no-dev-build, and touches nothing else", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { "no-dev-build": true } }) })).toEqual({
      build: false,
      deps: "own",
      devBuild: false,
      install: true,
    });
  });

  it("keeps --build and --no-dev-build independent, because they name two different artifacts", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { build: true, "no-dev-build": true } }) })).toEqual({
      build: true,
      deps: "own",
      devBuild: false,
      install: true,
    });
  });

  it("carries --no-install through, leaving the emit's own skip to provisioning", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { "no-install": true } }) })).toEqual({
      build: false,
      deps: "own",
      devBuild: true,
      install: false,
    });
  });

  it("takes an explicit --deps shared", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { deps: "shared" } }) })).toEqual({
      build: false,
      deps: "shared",
      devBuild: true,
      install: true,
    });
  });

  it("refuses a --deps value naming no mode, rather than falling back to the default", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { deps: "borrowed" } }) })).toBe(EXIT_USAGE);
  });

  it("accepts the redundant --dev-build, so both provisioning front doors spell the option the same way", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { "dev-build": true } }) })).toEqual({
      build: false,
      deps: "own",
      devBuild: true,
      install: true,
    });
  });

  it("refuses --dev-build and --no-dev-build together rather than picking a winner", () => {
    expect(spawnWorktreeOptions({ parsed: parsed({ values: { "dev-build": true, "no-dev-build": true } }) })).toBe(
      EXIT_USAGE,
    );
  });
});
