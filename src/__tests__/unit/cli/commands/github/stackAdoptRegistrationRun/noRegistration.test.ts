/**
 * `github stack adopt --register-only` when there is no parent to register onto: a base that is the repository
 * default, a base no open pull request heads, and a parent lookup that failed rather than answered.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runGithubStackAdopt } from "../../../../../../cli/commands/github/stackAdoptRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { childPr, PREFIX, unreachableApi } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackAdopt --register-only", () => {
  it("registers nothing, and says so, for a base that is the repository default", async () => {
    const home = tempHome();
    // The LOOKUP still runs, and its empty answer is what decides this: a base named `main` is not
    // evidence that nothing heads `main`.
    const heads: string[] = [];
    const observed = harness({
      api: unreachableApi({
        findOpenPrByHead: ({ head }) => {
          heads.push(head);
          return okAsync(undefined);
        },
        getPr: () => okAsync(childPr({ baseRef: "main" })),
      }),
    });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(heads).toEqual(["main"]);
    expect(observed.calls).toEqual([]);
    expect(observed.lines).toEqual([
      "no registration: PR #100 is based on the repository default (main); no native membership or local " +
        "enrolment was written.",
    ]);
  });

  it("registers nothing when no open pull request has the base as its head", async () => {
    const home = tempHome();
    const observed = harness({
      api: unreachableApi({ findOpenPrByHead: () => okAsync(undefined), getPr: () => okAsync(childPr()) }),
    });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(observed.lines).toEqual([
      "no registration: no open parent PR has head parent-branch; no native membership or local enrolment was " +
        "written.",
    ]);
  });

  it("refuses a parent lookup that failed, rather than reading it as no chain", async () => {
    const observed = harness({
      api: unreachableApi({
        findOpenPrByHead: () => errAsync({ kind: "http" as const, message: "403", operation: "pulls.list" }),
        getPr: () => okAsync(childPr()),
      }),
    });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", tempHome()],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.lines).toEqual([
      "refused: could not read the open pull request for base branch parent-branch: 403",
    ]);
  });
});
