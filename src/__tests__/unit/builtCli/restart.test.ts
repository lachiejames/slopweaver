/**
 * The restart's new image: the same Node, its flags, the same entrypoint and verb, and the environment less only the
 * console marker — so a second change racing the restart refuses there rather than starting another wait.
 */
import { describe, expect, it } from "vitest";

import { restartArgv, restartEnv } from "../../../builtCli/restart.js";

describe("restartArgv", () => {
  it("runs the same entrypoint and verb under the same Node and its flags", () => {
    expect(
      restartArgv({
        argv: ["/usr/local/bin/node", "/repo/dist-cli/cli/index.js", "org", "show", "--json"],
        execArgv: ["--max-old-space-size=12288"],
        execPath: "/usr/local/bin/node",
      }),
    ).toEqual([
      "/usr/local/bin/node",
      "--max-old-space-size=12288",
      "/repo/dist-cli/cli/index.js",
      "org",
      "show",
      "--json",
    ]);
  });
});

describe("restartEnv", () => {
  it("closes the console marker by emptying it, and keeps everything else, the stale-build hatch included", () => {
    expect(
      restartEnv({
        env: { PATH: "/usr/bin", SLOPWEAVER_ALLOW_STALE_BUILD: "1", SLOPWEAVER_CONSOLE_CHILD: "1" },
      }),
    ).toEqual({ PATH: "/usr/bin", SLOPWEAVER_ALLOW_STALE_BUILD: "1", SLOPWEAVER_CONSOLE_CHILD: "" });
  });

  it("closes a marker that was never set, so nothing downstream can fill one in", () => {
    expect(restartEnv({ env: { PATH: "/usr/bin" } })).toEqual({ PATH: "/usr/bin", SLOPWEAVER_CONSOLE_CHILD: "" });
  });

  it("copies rather than mutating the environment it was handed", () => {
    const env = { SLOPWEAVER_CONSOLE_CHILD: "1" };
    restartEnv({ env });
    expect(env).toEqual({ SLOPWEAVER_CONSOLE_CHILD: "1" });
  });
});
