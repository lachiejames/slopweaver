import { describe, expect, it } from "vitest";

import { releasedWatchCommand } from "../../../../../cli/commands/claude/watchAdmission.js";

describe("releasedWatchCommand — a released --wait start runs itself again, without the flag", () => {
  const EXEC_ARGV = ["--require", "/repo/node_modules/tsx/dist/preflight.cjs", "--import", "file:///repo/loader.mjs"];

  // A released waiter that kept `--wait` in its argv read as QUEUED once the record named
  // someone else, so the gauge said NOT running while it ticked.
  it("drops --wait and keeps every other flag, the entrypoint and the tsx loader", () => {
    expect(
      releasedWatchCommand({
        argv: ["/node", "/repo/bin/../src/cli/index.ts", "claude", "watch", "--interval", "5", "--wait", "--json"],
        execArgv: EXEC_ARGV,
        execPath: "/node",
      }),
    ).toStrictEqual({
      args: [...EXEC_ARGV, "/repo/bin/../src/cli/index.ts", "claude", "watch", "--interval", "5", "--json"],
      file: "/node",
    });
  });

  it("keeps --once, so --wait --once still performs exactly one tick after release", () => {
    expect(
      releasedWatchCommand({
        argv: ["/node", "/repo/src/cli/index.ts", "claude", "watch", "--wait", "--once"],
        execArgv: [],
        execPath: "/node",
      }).args,
    ).toStrictEqual(["/repo/src/cli/index.ts", "claude", "watch", "--once"]);
  });
});
