import { describe, expect, it } from "vitest";

import {
  CLI_DIR_VAR,
  CONSOLE_CHILD_VAR,
  consoleChildEnv,
  LAUNCHER_NO_TSX_WRAPPER_VAR,
  LAUNCHER_QUIET_VAR,
  withQuietLauncher,
} from "../../lib/launcherQuiet";

describe("the console's launcher-quiet environment", () => {
  it("adds the marker and keeps every other key", () => {
    expect(withQuietLauncher({ env: { HOME: "/home/a", PATH: "/usr/bin", PLUGIN_ROOT: "/checkout" } })).toEqual({
      HOME: "/home/a",
      PATH: "/usr/bin",
      PLUGIN_ROOT: "/checkout",
      SLOPWEAVER_LAUNCHER_QUIET: "1",
    });
  });

  it("overrides an inherited empty value, which both readers take as not quiet", () => {
    expect(withQuietLauncher({ env: { SLOPWEAVER_LAUNCHER_QUIET: "" } })).toEqual({ SLOPWEAVER_LAUNCHER_QUIET: "1" });
  });

  it("overrides an inherited 0 with the one value both readers are written against", () => {
    expect(withQuietLauncher({ env: { SLOPWEAVER_LAUNCHER_QUIET: "0" } })).toEqual({ SLOPWEAVER_LAUNCHER_QUIET: "1" });
  });

  it("copies rather than mutating, so the server's own environment is untouched", () => {
    const env = { PATH: "/usr/bin" };
    withQuietLauncher({ env });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("pins the literal name bin/slopweaver and src/cli/staleSeat.ts read", () => {
    expect(LAUNCHER_QUIET_VAR).toBe("SLOPWEAVER_LAUNCHER_QUIET");
  });
});

describe("the console child's environment", () => {
  // The server at :3000 case: served from main, but every verb ran a supervisor worktree's build, because the
  // launcher runs `${SLOPWEAVER_CLI_DIR:-$PLUGIN_ROOT}` and the server had inherited that worktree's PLUGIN_ROOT.
  it("pins the launcher to the serving checkout over an inherited root, and keeps the plugin roots as they were", () => {
    expect(
      consoleChildEnv({
        env: {
          CLAUDE_PLUGIN_ROOT: "/worktrees/fresh-supervisor-handoff-9292",
          PATH: "/usr/bin",
          PLUGIN_ROOT: "/worktrees/fresh-supervisor-handoff-9292/bin/..",
        },
        root: "/dev/slopweaver",
      }),
    ).toEqual({
      CLAUDE_PLUGIN_ROOT: "/worktrees/fresh-supervisor-handoff-9292",
      PATH: "/usr/bin",
      PLUGIN_ROOT: "/worktrees/fresh-supervisor-handoff-9292/bin/..",
      SLOPWEAVER_CLI_DIR: "/dev/slopweaver",
      SLOPWEAVER_CONSOLE_CHILD: "1",
      SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER: "1",
      SLOPWEAVER_LAUNCHER_QUIET: "1",
    });
  });

  it("overrides an inherited SLOPWEAVER_CLI_DIR, which names some other tree just the same", () => {
    expect(consoleChildEnv({ env: { SLOPWEAVER_CLI_DIR: "/worktrees/other" }, root: "/dev/slopweaver" })).toEqual({
      SLOPWEAVER_CLI_DIR: "/dev/slopweaver",
      SLOPWEAVER_CONSOLE_CHILD: "1",
      SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER: "1",
      SLOPWEAVER_LAUNCHER_QUIET: "1",
    });
  });

  // Under a tsx wrapper, the SIGKILL at a verb's bound reached the wrapper and the verb ran on, orphaned.
  it("starts the source in the launched pid itself, over an inherited value, so a kill at the bound reaches the verb", () => {
    const child = consoleChildEnv({ env: { SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER: "0" }, root: "/dev/slopweaver" });
    expect(child[LAUNCHER_NO_TSX_WRAPPER_VAR]).toBe("1");
  });

  // Restated from src/lib/launcherEnv.ts's LAUNCHER_NO_TSX_WRAPPER_VAR, which site/ cannot import.
  it("pins the literal name bin/slopweaver reads for the same-pid start", () => {
    expect(LAUNCHER_NO_TSX_WRAPPER_VAR).toBe("SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER");
  });

  it("copies rather than mutating, so the server's own environment is untouched", () => {
    const env = { PLUGIN_ROOT: "/worktrees/other" };
    consoleChildEnv({ env, root: "/dev/slopweaver" });
    expect(env).toEqual({ PLUGIN_ROOT: "/worktrees/other" });
  });

  it("pins the literal name bin/slopweaver reads for its code root", () => {
    expect(CLI_DIR_VAR).toBe("SLOPWEAVER_CLI_DIR");
  });

  it("sets the console-child marker over an inherited empty one, and never the stale-build hatch", () => {
    const child = consoleChildEnv({ env: { SLOPWEAVER_CONSOLE_CHILD: "" }, root: "/dev/slopweaver" });

    expect(child[CONSOLE_CHILD_VAR]).toBe("1");
    expect(Object.keys(child).toSorted()).toEqual([
      "SLOPWEAVER_CLI_DIR",
      "SLOPWEAVER_CONSOLE_CHILD",
      "SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER",
      "SLOPWEAVER_LAUNCHER_QUIET",
    ]);
  });

  // Restated from src/builtCli/consoleRebuildWait.ts's CONSOLE_CHILD_ENV, which site/ cannot import.
  it("pins the literal name the built CLI's guard reads for a console child", () => {
    expect(CONSOLE_CHILD_VAR).toBe("SLOPWEAVER_CONSOLE_CHILD");
  });
});
