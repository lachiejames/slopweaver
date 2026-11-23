/** Which regions of a Linear form the above-the-fold rules are allowed to read. */
import { describe, expect, it } from "vitest";

import { linearCommentAboveFoldCells, linearIssueAboveFoldCells } from "../../../../outbound/linear/aboveFold.js";
import type { LinearIssueArtifact } from "../../../../outbound/linear/types.js";

const STRUCTURED: LinearIssueArtifact = {
  aiPrompt: [{ kind: "para", text: "the whole investigation, which folds" }],
  kind: "structured",
  problem: [{ kind: "para", text: "the pool exhausted overnight." }],
  solution: [{ kind: "para", text: "we raised the ceiling." }],
};

describe("linearIssueAboveFoldCells", () => {
  it("reads Problem and Solution, and never the collapsed aiPrompt", () => {
    expect(linearIssueAboveFoldCells({ artifact: STRUCTURED })).toStrictEqual([
      { path: "artifact.problem", text: "the pool exhausted overnight." },
      { path: "artifact.solution", text: "we raised the ceiling." },
    ]);
  });

  it("never reads a details fold, which renders collapsed", () => {
    const artifact: LinearIssueArtifact = {
      ...STRUCTURED,
      details: [{ blocks: [{ kind: "para", text: "options weighed; three of them" }], title: "Options weighed" }],
    };
    expect(linearIssueAboveFoldCells({ artifact })).toStrictEqual([
      { path: "artifact.problem", text: "the pool exhausted overnight." },
      { path: "artifact.solution", text: "we raised the ceiling." },
    ]);
  });

  it("folds proofOfProblem into the Problem cell, since it renders under the same heading", () => {
    const artifact: LinearIssueArtifact = {
      ...STRUCTURED,
      proofOfProblem: [{ kind: "para", text: "the graph shows it." }],
    };
    expect(linearIssueAboveFoldCells({ artifact })[0]).toStrictEqual({
      path: "artifact.problem",
      text: "the pool exhausted overnight.\nthe graph shows it.",
    });
  });

  it("skips a code block and a media block, which carry no authored prose", () => {
    const artifact: LinearIssueArtifact = {
      ...STRUCTURED,
      solution: [
        { kind: "code", lang: "bash", text: "yarn validate; echo done" },
        { alt: "a screenshot", kind: "media", mime: "image/png", url: "https://example.test/a.png" },
        { kind: "para", text: "we raised the ceiling." },
      ],
    };
    expect(linearIssueAboveFoldCells({ artifact })[1]!.text).toBe("we raised the ceiling.");
  });

  it("reads a bullet's own text and anything nested beneath it", () => {
    const artifact: LinearIssueArtifact = {
      ...STRUCTURED,
      solution: [
        { items: [{ nested: [{ kind: "para", text: "and the note under it." }], text: "the step." }], kind: "bullets" },
      ],
    };
    expect(linearIssueAboveFoldCells({ artifact })[1]!.text).toBe("the step.\nand the note under it.");
  });

  it("reads a freeform body as one region", () => {
    const artifact: LinearIssueArtifact = {
      aiPrompt: [{ kind: "para", text: "folded" }],
      body: [
        { kind: "heading", text: "Context" },
        { kind: "para", text: "the pool exhausted." },
      ],
      kind: "freeform",
    };
    expect(linearIssueAboveFoldCells({ artifact })).toStrictEqual([
      { path: "artifact.body", text: "Context\nthe pool exhausted." },
    ]);
  });

  it("yields no region for a section whose blocks are all media", () => {
    const artifact: LinearIssueArtifact = {
      ...STRUCTURED,
      solution: [{ alt: "a screenshot", kind: "media", mime: "image/png", url: "https://example.test/a.png" }],
    };
    expect(linearIssueAboveFoldCells({ artifact }).map((cell) => cell.path)).toStrictEqual(["artifact.problem"]);
  });
});

describe("linearCommentAboveFoldCells", () => {
  it("reads the summary, which is the whole message above the fold", () => {
    expect(
      linearCommentAboveFoldCells({
        artifact: { evidence: [{ label: "the run", url: "https://example.test/r" }], summary: "we fixed it." },
      }),
    ).toStrictEqual([{ path: "artifact.summary", text: "we fixed it." }]);
  });

  it("never reads the collapsed detail", () => {
    const cells = linearCommentAboveFoldCells({
      artifact: {
        detail: [{ kind: "para", text: "the workings; joined by a semicolon" }],
        evidence: [{ label: "the run", url: "https://example.test/r" }],
        summary: "we fixed it.",
      },
    });
    expect(cells.map((cell) => cell.text)).toStrictEqual(["we fixed it."]);
  });
});
