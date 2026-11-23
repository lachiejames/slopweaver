/*
 * The owner's ask: a bump of theirs that Renovate has since merged is closed within one four-hourly firing. The
 * superseded pull request is deliberately ABSENT from the fleet read's rows in the first case — on acme-admin
 * that read stops at 100 and saw two of the owner's five open bumps.
 */
import { describe, expect, it } from "vitest";

import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import { safeJsonParse } from "../../../../../../lib/safeJson.js";
import { bump, ownBump, renovateMerge } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  it("closes the owner's superseded bump off their own read even when the fleet read never listed it", async () => {
    const run = harness({ merged: [renovateMerge()], own: [ownBump({ number: 18243 })], prs: [] });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(0);
    expect(run.closed).toEqual(["--repo acme/widgets --number 18243"]);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual(["widgets-18243-bump-close"]);
    expect(run.out).toContain(
      "  #18243 close-superseded (title) — closed it with a comment: superseded by Renovate's #16761, merged 2026-10-06T02:04:26Z",
    );
    expect(run.out).toContain(
      "  acme/widgets: 1 open bump(s) of the owner's, 1 changing only dependency files, of 1 open pull request(s) read whole; 1 superseded",
    );
  });

  it("closes a superseded bump the fleet read DID list, and the ladder then never presses it", async () => {
    const run = harness({
      merged: [renovateMerge()],
      own: [ownBump({ number: 661 })],
      prs: [
        bump({
          authorLogin: "octocat",
          title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
        }),
      ],
    });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(run.closed).toEqual(["--repo acme/widgets --number 661"]);
    expect(run.pressed).toEqual([]);
    expect(run.autonomyRows.map((row) => row.actionId)).toEqual(["widgets-661-bump-close"]);
  });

  it("closes nothing on --dry-run and says it would", async () => {
    const run = harness({ merged: [renovateMerge()], own: [ownBump({ number: 18243 })], prs: [] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets", "--dry-run"] });

    expect(run.closed).toEqual([]);
    expect(run.autonomyRows).toEqual([]);
    expect(run.out.some((line) => line.includes("#18243 close-superseded (title) — would close:"))).toBe(true);
  });

  it("carries the close act's notes into the JSON document", async () => {
    const run = harness({ merged: [renovateMerge()], own: [ownBump({ number: 18243 })], prs: [] });

    await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets", "--dry-run", "--json"] });

    const document: unknown = safeJsonParse({ label: "the document under test", text: run.out[0]! });
    expect(document).toMatchObject({
      notes: [
        "acme/widgets: 1 open bump(s) of the owner's, 1 changing only dependency files, of 1 open pull request(s) read whole; 1 superseded",
      ],
    });
  });
});
