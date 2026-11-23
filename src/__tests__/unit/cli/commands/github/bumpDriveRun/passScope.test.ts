/*
 * What a pass leaves untouched: everything on --dry-run, a pull request that is not a bump, and every read when
 * a flag is bad.
 */
import { describe, expect, it } from "vitest";

import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import { bump } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  it("writes nothing at all on --dry-run, and says what it would have done", async () => {
    const run = harness({ prs: [bump({ isDraft: true })] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets", "--dry-run"] });

    expect(run.readied).toEqual([]);
    expect(run.pressed).toEqual([]);
    expect(run.registered).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(run.out.some((line) => line.includes("would undraft-and-enqueue"))).toBe(true);
  });

  it("leaves a pull request that is not a bump alone entirely", async () => {
    const run = harness({
      prs: [bump({ authorLogin: "octocat", headRefName: "feature/one", title: "a change" })],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.pressed).toEqual([]);
    expect(run.out).toContain("no dependency bumps among the 1 open pull request(s)");
  });

  it("refuses a bad flag before making any read, and exits usage", async () => {
    const run = harness({ prs: [bump()] });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "widgets"] });

    expect(code).toBe(2);
    expect(run.pressed).toEqual([]);
    expect(run.readied).toEqual([]);
  });
});
