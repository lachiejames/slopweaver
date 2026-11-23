/*
 * `stackRemoteTip`: the remote's tip of a branch read off `ls-remote`, and undefined when the remote carries no
 * such branch.
 */
import { describe, expect, it } from "vitest";

import { stackRemoteTip } from "../../../../../../cli/commands/github/stackFacts.js";
import { gitFake, SHA_TIP_ALPHA } from "./harness.js";

describe("stackRemoteTip", () => {
  it("reads the remote's tip of the branch off ls-remote", () => {
    const { git } = gitFake({
      answers: [["/repo :: ls-remote mirror refs/heads/feature", `${SHA_TIP_ALPHA}\trefs/heads/feature`]],
    });
    expect(stackRemoteTip({ branch: "feature", git, remote: "mirror", repoRoot: "/repo" })).toBe(SHA_TIP_ALPHA);
  });

  it("is undefined when the remote carries no such branch", () => {
    const { git } = gitFake({ answers: [["/repo :: ls-remote origin refs/heads/gone", ""]] });
    expect(stackRemoteTip({ branch: "gone", git, remote: "origin", repoRoot: "/repo" })).toBe(undefined);
  });
});
