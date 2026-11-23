/** Proof lives on the description: a screenshot off user-attachments, or proof linked off it, is refused by name. */
import { describe, expect, it } from "vitest";

import { hostingIssues, isUserAttachmentUrl } from "../../../../outbound/github/formHosting.js";
import type { PrBody } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, shot, TESTS_BODY, TESTS_ONLY_BODY, t } from "./fixtures.js";

/** The fix body with its solution screenshot hosted at `url`. */
function withSolutionImage({ url }: { url: string }): PrBody {
  return {
    ...FIX_BODY,
    solutionProof: {
      image: { alt: "store start refusing", kind: "image", url },
      kind: "screenshot",
      proves: t({ text: "On this branch, start refuses." }),
      runBy: "agent",
    },
  };
}

/** The tests-only body with one check linking to `url`. */
function withCheckLink({ url }: { url: string }): PrBody {
  return { ...TESTS_ONLY_BODY, checks: [[{ kind: "link", text: "the proof", url }]] };
}

describe("hostingIssues", () => {
  it("accepts every fixture, whose screenshots are user-attachments uploads", () => {
    expect(
      [TESTS_BODY, FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY].flatMap((body) => hostingIssues({ body })),
    ).toStrictEqual([]);
  });

  it("refuses a screenshot hosted anywhere else, at the slot's image url, naming the attach verb", () => {
    const issues = hostingIssues({ body: withSolutionImage({ url: "https://example.com/shot.png" }) });
    expect(issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
      ["IMAGE_NOT_USER_ATTACHMENT", ["solutionProof", "image", "url"]],
    ]);
    expect(issues[0]!.message).toContain("slopweaver github attach");
  });

  it.each([
    ["https://github.com/o/r/releases/download/v1/shot.png", "EVIDENCE_RELEASE_DOWNLOAD"],
    ["https://github.com/o/r/pull/1#issuecomment-123", "EVIDENCE_COMMENT_LINK"],
    ["https://github.com/o/r/pull/1#discussion_r456", "EVIDENCE_COMMENT_LINK"],
    ["https://github.com/o/r/blob/main/proof/shot.png", "EVIDENCE_COMMITTED_MEDIA"],
    ["https://raw.githubusercontent.com/o/r/main/proof/run.mp4", "EVIDENCE_COMMITTED_MEDIA"],
  ])("refuses a check linking to %s as %s", (url, code) => {
    expect(hostingIssues({ body: withCheckLink({ url }) }).map((issue) => [issue.code, issue.path])).toStrictEqual([
      [code, ["checks", 0, 0]],
    ]);
  });

  it("reads a link in a reason slot and in a screenshot's proof line, each at its own path", () => {
    const comment = "https://github.com/o/r/pull/1#issuecomment-1";
    const body: PrBody = {
      ...FEATURE_BODY,
      problemProof: { kind: "reason", reason: [{ kind: "link", text: "a comment", url: comment }] },
      solutionProof: {
        image: shot({ alt: "the result", id: "33333333-aaaa-4bbb-8ccc-000000000001" }),
        kind: "screenshot",
        proves: [
          { kind: "text", text: "see " },
          { kind: "link", text: "a comment", url: comment },
        ],
        runBy: "agent",
      },
    };
    expect(hostingIssues({ body }).map((issue) => [issue.code, issue.path])).toStrictEqual([
      ["EVIDENCE_COMMENT_LINK", ["problemProof", "reason", 0]],
      ["EVIDENCE_COMMENT_LINK", ["solutionProof", "proves", 1]],
    ]);
  });

  it("lets a committed source file and a plain pull-request link stand as a check", () => {
    const body: PrBody = {
      ...TESTS_ONLY_BODY,
      checks: [
        [{ kind: "link", text: "the source", url: "https://github.com/o/r/blob/main/src/a.ts" }],
        [{ kind: "link", text: "the pull request", url: "https://github.com/o/r/pull/1" }],
      ],
    };
    expect(hostingIssues({ body })).toStrictEqual([]);
  });
});

describe("isUserAttachmentUrl", () => {
  it("accepts exactly a user-attachments upload, and nothing beside or after it", () => {
    expect(
      [
        "https://github.com/user-attachments/assets/0b6a1c2e-3d4f",
        "https://github.com/user-attachments/assets/0b6a1c2e-3d4f/extra",
        "http://github.com/user-attachments/assets/0b6a1c2e",
        "https://example.com/user-attachments/assets/0b6a1c2e",
      ].map((url) => isUserAttachmentUrl({ url })),
    ).toStrictEqual([true, false, false, false]);
  });
});
