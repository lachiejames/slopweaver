import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pushAndVerify } from "../../../../../../admit/githubPush.js";
import { type GithubPushDeps, runGithubPush } from "../../../../../../cli/commands/github/pushRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import { HOME_WITHOUT_PUSH_ROOTS } from "../../../../../pushRootFixture.js";
import {
  fixtureDirs,
  GATE_WRITE,
  HOOK,
  harness,
  LOCAL_SHA,
  PLAN,
  PREFIX,
  REMOTE_SHA,
  useFixtureDirCleanup,
} from "./harness.js";

useFixtureDirCleanup();

// The finding this closes, measured on a real pull request: a typecheck fix sat
// uncommitted on top of a red commit, so the gate would have read the fixed tree while the push sent the
// red commit.
describe("a working tree that is not what the push sends", () => {
  const DIRTY = " M src/lib/paging.ts\n?? scratch/notes.txt\n";

  /** The one refusal both paths build, printed as it reaches a reader. */
  const REFUSAL =
    "the working tree differs from HEAD, so a pre-push gate would judge files this push does not send (2 path(s)):\n" +
    "   M src/lib/paging.ts\n" +
    "  ?? scratch/notes.txt\n" +
    "commit or stash them, then push again — git push sends the commit, never the tree.";

  it("refuses at plan time, before base freshness, the door and the transport, naming every path", async () => {
    const test = harness({ statusPorcelain: DIRTY });
    const home = mkdtempSync(join(tmpdir(), "github-push-home-"));
    fixtureDirs.push(home);
    const code = await runGithubPush({ argv: [...PREFIX, "--home", home], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.writes).toEqual([]);
    // Refused before the plan exists, so nothing claims it "would push" the commit the gate cannot speak for.
    expect(test.lines).toEqual([`refused: ${REFUSAL}`]);
  });

  it("refuses a dry run too, which exists to disclose what a real invocation would decide", async () => {
    const test = harness({ statusPorcelain: DIRTY });
    const code = await runGithubPush({ argv: [...PREFIX, "--dry-run"], deps: test.deps });
    expect(code).toBe(EXIT_ERROR);
    expect(test.lines).toEqual([`refused: ${REFUSAL}`]);
  });

  it("refuses inside pushAndVerify, ahead of the gate, so every stack verb is covered too", () => {
    const test = harness({ gate: ok({ hook: HOOK, kind: "ran" }), statusPorcelain: DIRTY });
    expect(pushAndVerify({ deps: test.deps, home: HOME_WITHOUT_PUSH_ROOTS, plan: PLAN })).toEqual({
      kind: "failed",
      reason: `${REFUSAL}; nothing was sent`,
    });
    expect(test.writes).toEqual([]);
  });

  it("pushes a clean tree through the same choke point, so the refusal is falsifiable", () => {
    const test = harness({ gate: ok({ hook: HOOK, kind: "ran" }) });
    expect(pushAndVerify({ deps: test.deps, home: HOME_WITHOUT_PUSH_ROOTS, plan: PLAN })).toEqual({ kind: "pushed" });
    expect(test.writes).toEqual([
      [GATE_WRITE, "/repo", "origin", `${LOCAL_SHA}^{commit} ${LOCAL_SHA} refs/heads/feature ${REMOTE_SHA}\n`],
      ["push", "--no-verify", "--set-upstream", "origin", `${LOCAL_SHA}^{commit}:refs/heads/feature`],
    ]);
  });

  it("refuses, rather than assuming clean, when the working tree cannot be read", () => {
    const test = harness();
    const blindDeps: GithubPushDeps = {
      ...test.deps,
      readGit: ({ cwd, args }) => {
        if (args.join(" ") === "status --porcelain") throw new Error("fatal: not a git repository");
        return test.deps.readGit({ args, cwd });
      },
    };
    expect(pushAndVerify({ deps: blindDeps, home: HOME_WITHOUT_PUSH_ROOTS, plan: PLAN })).toEqual({
      kind: "failed",
      reason: "could not read the working tree: fatal: not a git repository; nothing was sent",
    });
  });
});
