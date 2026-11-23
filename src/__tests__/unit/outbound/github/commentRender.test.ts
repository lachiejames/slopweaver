import { describe, expect, it } from "vitest";

import { renderCommentBody } from "../../../../outbound/github/commentRender.js";
import type { GithubCommentArtifact } from "../../../../outbound/github/commentTypes.js";

describe("renderCommentBody", () => {
  it("renders the summary alone when there is no detail", () => {
    const artifact: GithubCommentArtifact = { summary: [{ kind: "text", text: "please re-review this" }] };
    expect(renderCommentBody({ artifact })).toBe("please re-review this");
  });

  it("appends a collapsed detail block when detail is present", () => {
    const artifact: GithubCommentArtifact = {
      detail: [{ content: [{ kind: "text", text: "more context" }], kind: "para" }],
      summary: [{ kind: "text", text: "please re-review this" }],
    };
    expect(renderCommentBody({ artifact })).toBe(
      "please re-review this\n\n<details>\n<summary>Detail</summary>\n\nmore context\n\n</details>",
    );
  });

  it("escapes markup in the summary rather than injecting it", () => {
    const artifact: GithubCommentArtifact = { summary: [{ kind: "text", text: "<script>alert(1)</script>" }] };
    expect(renderCommentBody({ artifact })).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
