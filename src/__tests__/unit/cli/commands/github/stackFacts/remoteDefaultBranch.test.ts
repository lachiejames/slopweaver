/*
 * `stackRemoteDefaultBranch`: the remote HEAD symref read fresh and the branch it names returned, and the
 * parser's own message thrown when the remote reports no default branch.
 */
import { describe, expect, it } from "vitest";

import { stackRemoteDefaultBranch } from "../../../../../../cli/commands/github/stackFacts.js";
import { gitFake, SHA_TIP_ALPHA, SHA_TIP_QUEBEC } from "./harness.js";

describe("stackRemoteDefaultBranch", () => {
  it("reads the remote HEAD symref fresh and returns the branch it names", () => {
    const { git, reads } = gitFake({
      answers: [
        [
          "/repo-golf :: ls-remote --symref mirror-delta HEAD",
          `ref: refs/heads/main-echo\tHEAD\n${SHA_TIP_ALPHA}\tHEAD`,
        ],
      ],
    });

    const branch = stackRemoteDefaultBranch({ git, remote: "mirror-delta", repoRoot: "/repo-golf" });

    expect(branch).toBe("main-echo");
    expect(reads).toEqual([{ args: ["ls-remote", "--symref", "mirror-delta", "HEAD"], cwd: "/repo-golf" }]);
  });

  it("throws the parser's own message when the remote reports no default branch", () => {
    const { git } = gitFake({
      answers: [["/repo-lima :: ls-remote --symref mirror-mike HEAD", `${SHA_TIP_QUEBEC}\tHEAD`]],
    });

    expect(() => stackRemoteDefaultBranch({ git, remote: "mirror-mike", repoRoot: "/repo-lima" })).toThrow(
      new Error("the remote did not report its default branch"),
    );
  });
});
