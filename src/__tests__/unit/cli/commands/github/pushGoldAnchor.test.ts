/**
 * `printGoldAnchor` directly: the anchor a push prints for the session to record beside its proof, and every
 * branch of the patch-id measurement says something rather than printing a blank.
 */
import { describe, expect, it } from "vitest";
import type { GithubPushPlan } from "../../../../../admit/githubPush.js";
import { printGoldAnchor } from "../../../../../cli/commands/github/pushGoldAnchor.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const LOCAL_SHA = "1111111111111111111111111111111111111111";
const BASE_SHA = "3333333333333333333333333333333333333333";
const PATCH_ID = "5e1877358e8c58c6bdc46b92483800474b4b1b32";
const HEADER = "gold anchor for this head (record it beside the proof; no description carries it):";

const PLAN: GithubPushPlan = {
  branch: "feature",
  defaultBranch: "main",
  forceWithLease: false,
  gitArgs: ["push", "origin", `${LOCAL_SHA}^{commit}:refs/heads/feature`],
  localSha: LOCAL_SHA,
  purpose: "pull-request-head",
  remote: "origin",
  remoteBranchSha: undefined,
  repo: "owner/repo",
  repoRoot: "/repo",
};

/** Plain fake edges: the printed lines and every patch-id request, captured. */
function harness({ patchId }: { patchId?: Result<string | null, string> }): {
  deps: GithubPushDeps;
  lines: string[];
  asked: string[];
} {
  const lines: string[] = [];
  const asked: string[] = [];
  const deps: GithubPushDeps = {
    cwd: () => "/unused",
    doorLedger: memoryDoorLedger().port,
    out: ({ line }) => lines.push(line),
    readGit: () => "",
    writeGit: () => ok(undefined),
    ...(patchId === undefined
      ? {}
      : {
          readPatchId: ({ base, cwd, head }: { base: string; cwd: string; head: string }) => {
            asked.push(`${cwd} ${base}..${head}`);
            return patchId;
          },
        }),
  };
  return { asked, deps, lines };
}

describe("printGoldAnchor", () => {
  it("prints commit and patch id as one JSON value, measured from the base to the head just sent", () => {
    const test = harness({ patchId: ok(PATCH_ID) });
    printGoldAnchor({ baseSha: BASE_SHA, deps: test.deps, plan: PLAN });
    expect(test.lines).toStrictEqual([
      "",
      HEADER,
      `  {"goldAnchor":{"commit":"${LOCAL_SHA}","patchId":"${PATCH_ID}"}}`,
    ]);
    expect(test.asked).toStrictEqual([`/repo ${BASE_SHA}..${LOCAL_SHA}`]);
  });

  it("offers the commit alone and names why when the measurement fails", () => {
    const test = harness({ patchId: err("git patch-id exploded") });
    printGoldAnchor({ baseSha: BASE_SHA, deps: test.deps, plan: PLAN });
    expect(test.lines).toStrictEqual([
      "",
      HEADER,
      `  {"goldAnchor":{"commit":"${LOCAL_SHA}"}}`,
      "  no patchId: git patch-id exploded",
    ]);
  });

  it("tells an empty contribution apart from a broken measurement", () => {
    const test = harness({ patchId: ok(null) });
    printGoldAnchor({ baseSha: BASE_SHA, deps: test.deps, plan: PLAN });
    expect(test.lines.at(-1)).toBe("  no patchId: this branch contributes no diff to its base");
  });

  it("never measures without a base, and says so", () => {
    const test = harness({ patchId: ok(PATCH_ID) });
    printGoldAnchor({ baseSha: undefined, deps: test.deps, plan: PLAN });
    expect(test.asked).toStrictEqual([]);
    expect(test.lines.at(-1)).toBe(
      "  no patchId: base freshness could not be measured, so there is no base to diff against",
    );
  });

  it("names a driver that cannot measure a patch id", () => {
    const test = harness({});
    printGoldAnchor({ baseSha: BASE_SHA, deps: test.deps, plan: PLAN });
    expect(test.lines.at(-1)).toBe("  no patchId: this push driver cannot measure a patch id");
  });
});
