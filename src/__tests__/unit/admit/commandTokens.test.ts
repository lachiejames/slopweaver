/*
 * The command-token helpers every raw-command guard resolves a tool and a git subcommand through, called
 * directly: an env prefix stripped, a path reduced to its basename, git's global flags skipped.
 */
import { describe, expect, it } from "vitest";

import { gitSubcommand, stripEnvPrefix, toolName } from "../../../admit/commandTokens.js";

describe("stripEnvPrefix", () => {
  it("strips an `env` prefix with its flags, the name `-u` unsets, and its assignments", () => {
    expect(stripEnvPrefix({ tokens: ["env", "-i", "-u", "HOME", "X=1", "git", "push"] })).toEqual(["git", "push"]);
  });

  it("strips bare leading assignments and leaves a plain command untouched", () => {
    expect([
      stripEnvPrefix({ tokens: ["FOO=bar", "BAZ=1", "gh", "pr", "close"] }),
      stripEnvPrefix({ tokens: ["git", "status"] }),
    ]).toEqual([
      ["gh", "pr", "close"],
      ["git", "status"],
    ]);
  });
});

describe("toolName", () => {
  it("reduces a path to its basename and leaves a bare name as it is", () => {
    expect([toolName({ first: "/usr/bin/gh" }), toolName({ first: "git" })]).toEqual(["gh", "git"]);
  });
});

describe("gitSubcommand", () => {
  it("skips a spaced value-global with its value, and an attached one alone, to find the subcommand", () => {
    expect(gitSubcommand({ tokens: ["git", "-C", "/repo", "--git-dir=.git", "push", "--force"] })).toEqual({
      flags: ["--force"],
      globals: ["-C", "/repo", "--git-dir=.git"],
      sub: "push",
    });
  });

  it("reports no subcommand when only global flags were given", () => {
    expect(gitSubcommand({ tokens: ["git", "--version"] })).toEqual({
      flags: [],
      globals: ["--version"],
      sub: undefined,
    });
  });
});
