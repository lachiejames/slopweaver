/**
 * `runYarnWhyText` over a plain recording executor: the exact `yarn why <dependency>` call, its worktree,
 * UTF-8 and the 30-second hung-install bound — and a thrown failure propagates rather than reading as
 * "dependency absent". No subprocess is launched.
 */
import { describe, expect, it } from "vitest";

import { runYarnWhyText } from "../../../../proof/yarnWhy/runYarnWhy.js";

/** One call the executor received. */
interface ExecCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: { cwd: string; encoding: "utf8"; timeout: number };
}

describe("runYarnWhyText", () => {
  it("runs yarn why <dependency> in the worktree, as UTF-8 under a 30s bound, and answers its output", () => {
    const calls: ExecCall[] = [];

    const output = runYarnWhyText({
      dependency: "zod",
      runFile: (call) => {
        calls.push(call);
        return "└─ slopweaver@workspace:. depends on zod@npm:4.1.0\n";
      },
      worktree: "/work/tree",
    });

    expect(output).toBe("└─ slopweaver@workspace:. depends on zod@npm:4.1.0\n");
    expect(calls).toEqual([
      { args: ["why", "zod"], file: "yarn", options: { cwd: "/work/tree", encoding: "utf8", timeout: 30_000 } },
    ]);
  });

  it("lets an executor failure propagate as the same error", () => {
    const broken = new Error("spawn yarn ENOENT");

    expect(() =>
      runYarnWhyText({
        dependency: "zod",
        runFile: () => {
          throw broken;
        },
        worktree: "/work/tree",
      }),
    ).toThrow(broken);
  });
});
