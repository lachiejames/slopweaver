import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { productionGithubPushDeps, runGithubPush } from "../../../../../../cli/commands/github/pushRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unreachableDoorLedger } from "../../../../../doorLedgerFixture.js";
import { homeDeclaringNoPrivateTerms } from "../../../../../privateTermsFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../../profileHoldFixture.js";
import {
  FRESH_DEFAULT_TIP_SHA,
  fixtureDirs,
  harness,
  LOCAL_SHA,
  PREFIX,
  REMOTE_SHA,
  useFixtureDirCleanup,
} from "./harness.js";

useFixtureDirCleanup();

describe("runGithubPush", () => {
  const FRESHNESS_FETCH_AND_CLEANUP: readonly (readonly string[])[] = [
    ["fetch", "origin", "refs/heads/main:refs/slopweaver/fetch/test"],
    ["update-ref", "-d", "refs/slopweaver/fetch/test"],
  ];

  it("dry-runs the exact lease without entering the door or invoking push", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({
      argv: [...PREFIX, "--force-with-lease", "--dry-run", "--home", home],
      deps: test.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(test.writes).toEqual(FRESHNESS_FETCH_AND_CLEANUP);
    expect(test.lines).toEqual([
      `would push ${LOCAL_SHA} to owner/repo:feature via origin`,
      `mode: exact force-with-lease against ${REMOTE_SHA}`,
      `base freshness: current — main@${FRESH_DEFAULT_TIP_SHA} is an ancestor of ${LOCAL_SHA}`,
      "dry run: the remote was read, and its default branch was fetched into a temporary private ref " +
        "(deleted immediately after) to measure base freshness; no lasting ref, door record or push remains.",
    ]);
  });

  it("previews the replacement walkthrough without posting it", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-review-home-" });
    fixtureDirs.push(home);
    const review = JSON.stringify({
      comments: [
        { body: "This keeps the current diff easy to enter.", kind: "explanation", line: 9, path: "src/a.ts" },
      ],
    });
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", home, "--self-review", review, "--dry-run"],
      deps: test.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(test.writes).toEqual(FRESHNESS_FETCH_AND_CLEANUP);
    expect(test.lines).toContain("would replace the inline self-review with 1 comment(s)");
  });

  it("refuses a walkthrough over a corrupt profile.json with exit 1 before any Git read or write", async () => {
    // The harness's `makeApi` throws, and its Git reader throws on any command it does not know, so a verb
    // that went past the refusal would fail loudly rather than pass this test.
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-review-home-" });
    fixtureDirs.push(home);
    writeFileSync(join(home, "profile.json"), "{");
    const review = JSON.stringify({
      comments: [
        { body: "This keeps the current diff easy to enter.", kind: "explanation", line: 9, path: "src/a.ts" },
      ],
    });
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home, "--self-review", review], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    expect(test.lines).toHaveLength(1);
    expect(test.lines[0]).toContain(
      `refused: the profile at ${join(home, "profile.json")} is there but cannot be trusted`,
    );
    expect(test.lines[0]).toContain("nothing was pushed and no review was posted.");
  });

  it("still pushes with no --self-review over a corrupt profile.json, since nothing reads the voice rules", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    writeFileSync(join(home, "profile.json"), "{");
    const code = await runGithubPush({ argv: [...PREFIX, "--force-with-lease", "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_OK);
    expect(test.lines).toContain(`pushed and verified ${LOCAL_SHA} at owner/repo:feature`);
  });

  it("routes a real exact-lease push and verifies the remote SHA", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({
      argv: [...PREFIX, "--force-with-lease", "--home", home],
      deps: test.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(test.writes).toEqual([
      ...FRESHNESS_FETCH_AND_CLEANUP,
      [
        "push",
        "--set-upstream",
        `--force-with-lease=refs/heads/feature:${REMOTE_SHA}`,
        "origin",
        `${LOCAL_SHA}^{commit}:refs/heads/feature`,
      ],
    ]);
    expect(test.lines).toContain(`pushed and verified ${LOCAL_SHA} at owner/repo:feature`);
  });

  it("refuses to push when the door cannot record its decision, performing no push", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({
      argv: [...PREFIX, "--home", home],
      deps: { ...test.deps, doorLedger: unreachableDoorLedger() },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes.filter((write) => write[0] === "push")).toEqual([]);
    expect(test.lines.some((line) => line.includes("not performed:"))).toBe(true);
  });

  it("prints the door's whole refusal, finding and way through, when the door holds the push", async () => {
    const test = harness();
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const held = await withProfileHold({
      home,
      run: () => runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps }),
    });
    expect(held.result).toBe(EXIT_ERROR);
    expect(held.decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(test.writes.filter((write) => write[0] === "push")).toEqual([]);
    expect(test.lines.slice(-5)).toEqual(
      expectedHoldRefusal({ command: "slopweaver github push", decision: held.decision }),
    );
  });

  it("refuses the default branch before the door and before push", async () => {
    const test = harness({ branch: "main", defaultBranch: "main" });
    const code = await runGithubPush({ argv: [...PREFIX], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    expect(test.lines).toEqual([
      "refused: the checked-out branch is the remote default (main); this verb pushes pull-request branches only",
    ]);
  });

  it("reports a rejected push as failed", async () => {
    const test = harness({ writeOk: false });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines.at(-1)).toBe("failed: push rejected");
  });

  it("refuses to claim success when read-back does not match", async () => {
    const test = harness({ afterSha: REMOTE_SHA });
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-push-home-" });
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines.at(-1)).toBe(`unconfirmed: remote reported ${REMOTE_SHA}, expected ${LOCAL_SHA}`);
  });

  it("exposes production edges as a complete callable dependency set", () => {
    const deps = productionGithubPushDeps();
    expect(Object.keys(deps).toSorted()).toEqual([
      "cwd",
      "doorLedger",
      "installationIdentifiers",
      "out",
      "prePushGate",
      "readGit",
      "readPatchId",
      "readQueueGate",
      "selfReview",
      "stackCarry",
      "writeGit",
    ]);
  });
});
