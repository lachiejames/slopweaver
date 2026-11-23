import { describe, expect, it } from "vitest";
import {
  linkifyCommentArtifact,
  linkifyIssueArtifact,
  linkifyMilestoneFields,
  linkifyProjectFields,
} from "../../../../outbound/linear/bareRefLinks.js";
import type { LinearCommentArtifact } from "../../../../outbound/linear/commentTypes.js";
import type { LinearMilestoneFields, LinearProjectFields } from "../../../../outbound/linear/projectTypes.js";
import type { BulletsBlock, FreeformIssue, StructuredIssue } from "../../../../outbound/linear/types.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";

const CONTEXT: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };
const NO_CONTEXT: BareRefContext = { repos: [] };

describe("linkifyIssueArtifact — structured", () => {
  it("linkifies a bare reference in the problem section", () => {
    const artifact: StructuredIssue = {
      aiPrompt: [{ kind: "para", text: "investigate" }],
      kind: "structured",
      problem: [{ kind: "para", text: "caused by #10" }],
      solution: [{ kind: "para", text: "no reference here" }],
    };
    const result = linkifyIssueArtifact({ artifact, context: CONTEXT });
    expect((result.artifact as StructuredIssue).problem).toEqual([
      { kind: "para", text: "caused by [#10](https://github.com/acme/widget/issues/10)" },
    ]);
    expect(result.issues.length).toBe(0);
  });

  it("linkifies inside a nested block under a bullet item", () => {
    const artifact: StructuredIssue = {
      aiPrompt: [{ kind: "para", text: "investigate" }],
      kind: "structured",
      problem: [
        { kind: "para", text: "steps:" },
        { items: [{ nested: [{ kind: "para", text: "see #10" }], text: "step one" }], kind: "bullets" },
      ],
      solution: [{ kind: "para", text: "fine" }],
    };
    const result = linkifyIssueArtifact({ artifact, context: CONTEXT });
    const bulletsBlock = (result.artifact as StructuredIssue).problem[1] as BulletsBlock;
    expect(bulletsBlock.items[0]!.nested).toEqual([
      { kind: "para", text: "see [#10](https://github.com/acme/widget/issues/10)" },
    ]);
  });

  it("links nothing against a repo that is not GitHub-shaped, so `r)<!--` cannot open a comment", () => {
    const artifact: StructuredIssue = {
      aiPrompt: [{ kind: "para", text: "Do it" }],
      kind: "structured",
      problem: [{ kind: "para", text: "Problem #1" }],
      solution: [{ kind: "para", text: "Solution" }],
    };
    const result = linkifyIssueArtifact({ artifact, context: { repos: [{ owner: "o", repo: "r)<!--" }] } });
    expect((result.artifact as StructuredIssue).problem).toEqual(artifact.problem);
    expect(result.issues.map((issue) => [issue.path, issue.message.slice(0, 50)])).toEqual([
      [["problem", 0, "text"], '"#1" would resolve against "o/r)<!--", which is no'],
    ]);
  });

  it("links nothing to a control URL that would break out of the link, so `)<!--` stays text", () => {
    const artifact: StructuredIssue = {
      aiPrompt: [{ kind: "para", text: "Do it" }],
      kind: "structured",
      problem: [{ kind: "para", text: "Problem HRS-52" }],
      solution: [{ kind: "para", text: "Solution" }],
    };
    const context = { complianceControls: [{ id: "HRS-52", url: "https://example.test/)<!--" }], repos: [] };
    const result = linkifyIssueArtifact({ artifact, context });
    expect((result.artifact as StructuredIssue).problem).toEqual(artifact.problem);
    expect(result.issues.map((issue) => issue.path)).toEqual([["problem", 0, "text"]]);
    expect(result.issues[0]!.message).toContain("its URL would break the link");
  });

  it("never touches a code block", () => {
    const artifact: StructuredIssue = {
      aiPrompt: [{ kind: "para", text: "investigate" }],
      kind: "structured",
      problem: [{ kind: "code", lang: "", text: "raw #10 in code" }],
      solution: [{ kind: "para", text: "fine" }],
    };
    const result = linkifyIssueArtifact({ artifact, context: CONTEXT });
    expect((result.artifact as StructuredIssue).problem).toEqual(artifact.problem);
  });

  it("reports surviving residue with its full path", () => {
    const artifact: StructuredIssue = {
      aiPrompt: [{ kind: "para", text: "investigate" }],
      kind: "structured",
      problem: [{ kind: "para", text: "closed: 100, 200" }],
      solution: [{ kind: "para", text: "fine" }],
    };
    const result = linkifyIssueArtifact({ artifact, context: NO_CONTEXT });
    expect(result.issues.length).toBe(2);
    expect(result.issues[0]!.path).toEqual(["problem", 0, "text"]);
  });

  it("linkifies acceptance criteria", () => {
    const artifact: StructuredIssue = {
      acceptance: ["given #10, it resolves"],
      aiPrompt: [{ kind: "para", text: "investigate" }],
      kind: "structured",
      problem: [{ kind: "para", text: "fine" }],
      solution: [{ kind: "para", text: "fine" }],
    };
    const result = linkifyIssueArtifact({ artifact, context: CONTEXT });
    expect((result.artifact as StructuredIssue).acceptance).toEqual([
      "given [#10](https://github.com/acme/widget/issues/10), it resolves",
    ]);
  });
});

describe("linkifyIssueArtifact — freeform", () => {
  it("linkifies inside the body and a heading", () => {
    const artifact: FreeformIssue = {
      aiPrompt: [{ kind: "para", text: "investigate" }],
      body: [
        { kind: "heading", text: "see #10" },
        { kind: "para", text: "detail" },
      ],
      kind: "freeform",
    };
    const result = linkifyIssueArtifact({ artifact, context: CONTEXT });
    expect((result.artifact as FreeformIssue).body[0]).toEqual({
      kind: "heading",
      text: "see [#10](https://github.com/acme/widget/issues/10)",
    });
  });
});

describe("linkifyCommentArtifact", () => {
  it("linkifies the summary and reports nothing once resolved", () => {
    const artifact: LinearCommentArtifact = { evidence: [], summary: "fixed by #10" };
    const result = linkifyCommentArtifact({ artifact, context: CONTEXT });
    expect(result.artifact.summary).toBe("fixed by [#10](https://github.com/acme/widget/issues/10)");
    expect(result.issues.length).toBe(0);
  });

  it("linkifies the detail blocks", () => {
    const artifact: LinearCommentArtifact = {
      detail: [{ kind: "para", text: "see #10" }],
      evidence: [],
      summary: "found something",
    };
    const result = linkifyCommentArtifact({ artifact, context: CONTEXT });
    expect(result.artifact.detail).toEqual([
      { kind: "para", text: "see [#10](https://github.com/acme/widget/issues/10)" },
    ]);
  });
});

describe("linkifyProjectFields", () => {
  const FIELDS: LinearProjectFields = { description: "caused by #10", name: "A project", teamIds: ["team-1"] };

  it("rewrites a resolvable reference in the plain-text description as its bare URL, not a markdown link", () => {
    const result = linkifyProjectFields({ context: CONTEXT, fields: FIELDS });
    expect(result.fields.description).toBe("caused by https://github.com/acme/widget/issues/10");
    expect(result.issues.length).toBe(0);
  });

  it("reports an unresolvable reference at the description path, and leaves it bare", () => {
    const result = linkifyProjectFields({ context: NO_CONTEXT, fields: FIELDS });
    expect(result.fields.description).toBe("caused by #10");
    expect(result.issues).toEqual([{ message: result.issues[0]!.message, path: ["description"] }]);
  });

  it("does nothing when the project has no description", () => {
    const noDescription: LinearProjectFields = { name: "A project", teamIds: ["team-1"] };
    const result = linkifyProjectFields({ context: CONTEXT, fields: noDescription });
    expect(result.fields).toBe(noDescription);
    expect(result.issues).toEqual([]);
  });
});

describe("linkifyMilestoneFields", () => {
  const FIELDS: LinearMilestoneFields = { description: "caused by #10", name: "A milestone", projectId: "puuid-1" };

  it("rewrites a resolvable reference in the markdown description as a real link", () => {
    const result = linkifyMilestoneFields({ context: CONTEXT, fields: FIELDS });
    expect(result.fields.description).toBe("caused by [#10](https://github.com/acme/widget/issues/10)");
    expect(result.issues.length).toBe(0);
  });

  it("reports an unresolvable reference, and leaves it bare", () => {
    const result = linkifyMilestoneFields({ context: NO_CONTEXT, fields: FIELDS });
    expect(result.fields.description).toBe("caused by #10");
    expect(result.issues.length).toBe(1);
  });

  it("does nothing when the milestone has no description", () => {
    const noDescription: LinearMilestoneFields = { name: "A milestone", projectId: "puuid-1" };
    const result = linkifyMilestoneFields({ context: CONTEXT, fields: noDescription });
    expect(result.fields).toBe(noDescription);
    expect(result.issues).toEqual([]);
  });
});
