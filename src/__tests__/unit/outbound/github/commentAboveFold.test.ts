import { describe, expect, it } from "vitest";

import { githubCommentAboveFoldCells } from "../../../../outbound/github/aboveFold.js";
import type { GithubCommentArtifact } from "../../../../outbound/github/commentTypes.js";

describe("githubCommentAboveFoldCells", () => {
  it("names the one region — the summary — a reader sees before expanding anything", () => {
    const artifact: GithubCommentArtifact = { summary: [{ kind: "text", text: "please re-review this" }] };
    expect(githubCommentAboveFoldCells({ artifact })).toEqual([
      { path: "artifact.summary", text: "please re-review this" },
    ]);
  });

  it("replaces a code run with a space, same as the pull-request cells", () => {
    const artifact: GithubCommentArtifact = {
      summary: [
        { kind: "text", text: "run " },
        { kind: "code", text: "yarn test" },
        { kind: "text", text: " first" },
      ],
    };
    expect(githubCommentAboveFoldCells({ artifact })[0]!.text).toBe("run   first");
  });
});
