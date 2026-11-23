import { describe, expect, it } from "vitest";

import { GithubPushDoorErrors } from "../../../admit/githubPushErrors.js";
import { prePushWorkingTreeRefusal } from "../../../admit/prePushWorkingTree.js";
import { refuseDirtyWorkingTree } from "../../../admit/pushWorkingTreeGate.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One call the fake Git reader received. */
interface GitCall {
  readonly cwd: string;
  readonly args: readonly string[];
}

/**
 * A plain Git reader that records each call and answers with a fixed porcelain status.
 *
 * @returns the reader and the list it records into
 */
function recordingReader({ answer }: { answer: string }): {
  readonly calls: GitCall[];
  readonly readGit: (args: GitCall) => string;
} {
  const calls: GitCall[] = [];
  return {
    calls,
    readGit: (call) => {
      calls.push(call);
      return answer;
    },
  };
}

describe("refuseDirtyWorkingTree", () => {
  it("asks git for the porcelain status of exactly the repository root it was given", () => {
    const reader = recordingReader({ answer: "" });
    refuseDirtyWorkingTree({ readGit: reader.readGit, repoRoot: "/repo-alpha" });
    expect(reader.calls).toEqual([{ args: ["status", "--porcelain"], cwd: "/repo-alpha" }]);
  });

  it("passes a clean tree", () => {
    const result = refuseDirtyWorkingTree({ readGit: recordingReader({ answer: "" }).readGit, repoRoot: "/repo" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(undefined);
  });

  it("refuses a dirty tree with the shared pre-push refusal as a FACT_REFUSED on the working tree", () => {
    const statusPorcelain = " M src/bravo.ts\n?? notes-charlie.md\n";
    const result = refuseDirtyWorkingTree({
      readGit: recordingReader({ answer: statusPorcelain }).readGit,
      repoRoot: "/r",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(
      GithubPushDoorErrors.workingTreeDirty({ refusal: prePushWorkingTreeRefusal({ statusPorcelain }) }),
    );
    expect(unwrapErr(result).code).toBe("FACT_REFUSED");
    expect(unwrapErr(result).message).toBe(
      [
        "the working tree differs from HEAD, so a pre-push gate would judge files this push does not send (2 path(s)):",
        "   M src/bravo.ts",
        "  ?? notes-charlie.md",
        "commit or stash them, then push again — git push sends the commit, never the tree.",
      ].join("\n"),
    );
  });

  it("refuses an unreadable status with the thrown Error's message rather than reading it as clean", () => {
    const result = refuseDirtyWorkingTree({
      readGit: () => {
        throw new Error("not a repository");
      },
      repoRoot: "/nowhere",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(GithubPushDoorErrors.workingTreeUnread({ cause: "not a repository" }));
    expect(unwrapErr(result).message).toBe("could not read the working tree: not a repository");
  });

  it("stringifies a thrown value that is not an Error", () => {
    const result = refuseDirtyWorkingTree({
      readGit: () => {
        throw "exit status 128";
      },
      repoRoot: "/nowhere",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(GithubPushDoorErrors.workingTreeUnread({ cause: "exit status 128" }));
    expect(unwrapErr(result).message).toBe("could not read the working tree: exit status 128");
  });
});
