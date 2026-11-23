import { describe, expect, it } from "vitest";
import { pushAndVerify } from "../../../../../../admit/githubPush.js";
import { type GithubPushDeps, runGithubPush } from "../../../../../../cli/commands/github/pushRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../../../../pushRootFixture.js";
import { HOOK, harness, LOCAL_SHA, PLAN, PREFIX } from "./harness.js";

describe("the proof-path door", () => {
  /** What a real admin push carried: a proof folder beside the package's real source. */
  const PROOF_TREE: readonly string[] = [
    "packages/tool-cli/proof/opt-in-not-opt-out.gif",
    "packages/tool-cli/proof/opt-in-not-opt-out.tape",
    "packages/tool-cli/src/index.ts",
  ];

  it("refuses a dry run that would push a proof folder, naming each file, before the door or transport", async () => {
    const test = harness({ tree: PROOF_TREE });
    const code = await runGithubPush({ argv: [...PREFIX, "--dry-run"], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    const printed = test.lines.join("\n").split("\n");
    expect(printed.slice(0, 3)).toEqual([
      "refused: commit 111111111111 carries 2 proof file(s); nothing was sent:",
      "  packages/tool-cli/proof/opt-in-not-opt-out.gif",
      "  packages/tool-cli/proof/opt-in-not-opt-out.tape",
    ]);
    expect(printed[5]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_PROOF_PATH=1 slopweaver github <push|stack push|stack submit|ready>.",
    );
  });

  it("refuses inside pushAndVerify, ahead of the pre-push gate, so every stack verb is covered too", () => {
    const test = harness({ gate: ok({ hook: HOOK, kind: "ran" }), tree: PROOF_TREE });
    const outcome = pushAndVerify({ deps: test.deps, home: HOME_WITHOUT_PUSH_ROOTS, plan: PLAN });
    expect(outcome.kind).toBe("failed");
    expect(test.writes).toEqual([]);
  });

  it("lets a worktree salvage push carry the same tree, since it preserves work and opens no pull request", () => {
    const test = harness({ tree: PROOF_TREE });
    expect(
      pushAndVerify({
        deps: test.deps,
        home: HOME_WITHOUT_PUSH_ROOTS,
        plan: { ...PLAN, purpose: "worktree-salvage" },
      }),
    ).toEqual({
      kind: "pushed",
    });
    expect(test.writes).toEqual([["push", "--set-upstream", "origin", `${LOCAL_SHA}^{commit}:refs/heads/feature`]]);
  });

  it("refuses closed when the pushed tree cannot be listed", () => {
    const test = harness();
    const blindDeps: GithubPushDeps = {
      ...test.deps,
      readGit: ({ cwd, args }) => {
        if (args.includes("ls-tree")) throw new Error("fatal: not a tree object");
        return test.deps.readGit({ args, cwd });
      },
    };
    expect(pushAndVerify({ deps: blindDeps, home: HOME_WITHOUT_PUSH_ROOTS, plan: PLAN })).toEqual({
      kind: "failed",
      reason: `could not list the tree of ${LOCAL_SHA} to check it for proof output: fatal: not a tree object; nothing was sent`,
    });
  });
});
