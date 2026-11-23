import { describe, expect, it } from "vitest";

import { LAUNCHER_NO_TSX_WRAPPER_VAR, LAUNCHER_QUIET_VAR, withQuietLauncher } from "../../../lib/launcherEnv.js";

describe("withQuietLauncher", () => {
  it("sets the marker `bin/slopweaver`'s advise helper reads", () => {
    expect(withQuietLauncher({ env: { PATH: "/usr/bin" } })).toEqual({
      PATH: "/usr/bin",
      SLOPWEAVER_LAUNCHER_QUIET: "1",
    });
  });

  it("names that marker in one place, so a rename cannot drift from the shell that reads it", () => {
    expect(LAUNCHER_QUIET_VAR).toBe("SLOPWEAVER_LAUNCHER_QUIET");
    expect(LAUNCHER_NO_TSX_WRAPPER_VAR).toBe("SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER");
  });

  it("leaves every launcher code-root variable ALONE — silencing an advisory is not redirecting a launcher", () => {
    const stripped = withQuietLauncher({
      env: { CLAUDE_PLUGIN_ROOT: "/cache/b", PLUGIN_ROOT: "/worktree/a", SLOPWEAVER_CLI_DIR: "/explicit/c" },
    });

    expect(stripped).toEqual({
      CLAUDE_PLUGIN_ROOT: "/cache/b",
      PLUGIN_ROOT: "/worktree/a",
      SLOPWEAVER_CLI_DIR: "/explicit/c",
      SLOPWEAVER_LAUNCHER_QUIET: "1",
    });
  });

  it("copies rather than mutating, so a caller's own environment is untouched", () => {
    const env = { PLUGIN_ROOT: "/worktree/a" };

    withQuietLauncher({ env });

    expect(env).toEqual({ PLUGIN_ROOT: "/worktree/a" });
  });
});
