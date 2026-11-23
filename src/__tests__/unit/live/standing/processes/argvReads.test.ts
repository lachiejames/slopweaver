/*
 * What one argv says about where it came from — the checkout a CLI process runs out of, and the plugin dir a
 * claude process was launched with, alone or across a list of candidate pids. It was split out when the
 * process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { cliCheckoutOfArgv, pluginDirAmong, pluginDirOfArgv } from "../../../../../live/standing/processes.js";
import { CLAUDE_ARGV, LISTENER_ARGV, SNAPSHOT } from "./harness.js";

describe("cliCheckoutOfArgv", () => {
  it("reads the checkout out of a bin/.. launcher path", () => {
    expect(cliCheckoutOfArgv({ argv: LISTENER_ARGV })).toBe("/wt/28aug");
  });

  it("reads a direct src/cli/index.ts invocation too", () => {
    expect(cliCheckoutOfArgv({ argv: "npx tsx /repo/slopweaver/src/cli/index.ts listen" })).toBe("/repo/slopweaver");
  });

  it("returns undefined for an argv that runs something else entirely", () => {
    expect(cliCheckoutOfArgv({ argv: CLAUDE_ARGV })).toBeUndefined();
  });

  // A checkout with a built tree execs node against it, and `ps` prints exactly this: the source-only pattern attributed that listener to no checkout at all.
  it("reads the checkout out of the BUILT entrypoint bin/slopweaver execs", () => {
    expect(cliCheckoutOfArgv({ argv: "/node /wt/23sep-a/bin/../dist-cli/cli/index.js listen --follow" })).toBe(
      "/wt/23sep-a",
    );
  });

  it("reads a direct dist-cli/cli/index.js invocation too", () => {
    expect(cliCheckoutOfArgv({ argv: "node /repo/slopweaver/dist-cli/cli/index.js listen" })).toBe("/repo/slopweaver");
  });

  it("does not read a built file that is not the CLI entrypoint", () => {
    expect(cliCheckoutOfArgv({ argv: "node /repo/slopweaver/dist-cli/lib/index.js listen" })).toBeUndefined();
  });
});

describe("pluginDirOfArgv", () => {
  it("reads the plugin dir a claude process was launched with", () => {
    expect(pluginDirOfArgv({ argv: CLAUDE_ARGV })).toBe("/wt/26aug-b");
  });

  it("reads the equals spelling", () => {
    expect(pluginDirOfArgv({ argv: "/claude --plugin-dir=/wt/x --model opus" })).toBe("/wt/x");
  });

  it("returns undefined when the argv names no plugin dir", () => {
    expect(pluginDirOfArgv({ argv: LISTENER_ARGV })).toBeUndefined();
  });
});

describe("pluginDirAmong", () => {
  it("finds the plugin dir of the first candidate whose argv names one", () => {
    expect(pluginDirAmong({ pids: [61202, 42246], processes: SNAPSHOT })).toBe("/wt/26aug-b");
  });

  it("returns undefined when no candidate names one — the detached-listener case", () => {
    expect(pluginDirAmong({ pids: [61202, 61048], processes: SNAPSHOT })).toBeUndefined();
  });

  it("returns undefined for no candidates at all", () => {
    expect(pluginDirAmong({ pids: [], processes: SNAPSHOT })).toBeUndefined();
  });

  it("skips a pid that is not in the snapshot rather than stopping", () => {
    expect(pluginDirAmong({ pids: [999_999, 42246], processes: SNAPSHOT })).toBe("/wt/26aug-b");
  });
});
