/*
 * A repository GitHub cannot resolve refuses the whole pass rather than reading as zero open pull requests,
 * and a repository a row came back from is never asked about, since that row IS GitHub resolving it.
 */
import { describe, expect, it } from "vitest";

import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { bump, ownBump } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  it("refuses the whole pass, naming every repository GitHub could not resolve, before any supersede read or act", async () => {
    const run = harness({
      own: [ownBump({ number: 700 })],
      prs: [],
      unresolved: new Map<string, GithubLiveError>([
        ["acme/ghost", GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" })],
        ["acme/flaky", GithubLiveErrors.readFailed({ message: "GitHub answered 502" })],
      ]),
    });

    const code = await runGithubBumpDrive({
      deps: run.deps,
      rest: ["--repo", "acme/ghost,acme/flaky,acme/widgets", "--json"],
    });

    expect(code).toBe(1);
    expect(run.resolutions).toEqual(["acme/ghost", "acme/flaky", "acme/widgets"]);
    expect(run.diagnostics).toEqual([
      "github bump-drive: GitHub could not resolve repository acme/ghost — it may not exist or this credential " +
        "cannot read it, so its zero open pull requests are not a reading; check the slug",
      "github bump-drive: repository acme/flaky could not be verified, so its zero open pull requests are not a " +
        "reading — GitHub answered 502",
    ]);
    expect(run.out).toEqual([]);
    expect(run.supersedeReads).toEqual([]);
    expect(run.closed).toEqual([]);
    expect(run.readied).toEqual([]);
    expect(run.pressed).toEqual([]);
    expect(run.rewritten).toEqual([]);
    expect(run.registered).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
  });

  it("asks no resolution of a repository a row came back from, since that row IS GitHub resolving it", async () => {
    const run = harness({ prs: [bump({ isDraft: true })] });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "ACME/Widgets,acme/empty"] });

    expect(code).toBe(0);
    expect(run.resolutions).toEqual(["acme/empty"]);
    // The pass went on: one read of the owner's open list per repository, the supersede pass's own shape.
    expect(run.supersedeReads).toEqual(["own", "own"]);
  });
});
