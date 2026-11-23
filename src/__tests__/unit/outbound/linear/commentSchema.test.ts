import { describe, expect, it } from "vitest";

import { linearCommentFormSchema, linearRelationFormSchema } from "../../../../outbound/linear/commentSchema.js";
import { renderBlock, renderCommentBody, renderDocumentCommentBody } from "../../../../outbound/linear/render.js";
import { SECTION_MAX_WORDS } from "../../../../outbound/linear/sectionWords.js";
import { hasRawHtml } from "../../../../outbound/linear/structuralEscapes.js";

/** The minimum valid comment: a lead, and the evidence behind it. */
const VALID = {
  artifact: {
    evidence: [{ label: "the failing run", url: "https://example.test/run/1" }],
    summary: "The staging pool exhausted because the migration held 40 connections open.",
  },
  fields: { issueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
};

/** Every rejection path, so a message can be asserted rather than a boolean. */
function problems({ form }: { form: unknown }): readonly string[] {
  const parsed = linearCommentFormSchema.safeParse(form);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("linearCommentFormSchema", () => {
  it("accepts the minimum valid comment", () => {
    expect(problems({ form: VALID })).toEqual([]);
  });

  it("REFUSES a comment with no evidence — an unsourced claim is what the required field exists for", () => {
    const found = problems({ form: { ...VALID, artifact: { ...VALID.artifact, evidence: [] } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("artifact.evidence");
  });

  it("REFUSES a summary over the word cap rather than truncating it", () => {
    const long = Array.from({ length: SECTION_MAX_WORDS + 1 }, () => "word").join(" ");
    const found = problems({ form: { ...VALID, artifact: { ...VALID.artifact, summary: long } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain(`capped at ${String(SECTION_MAX_WORDS)} words`);
  });

  it("counts a markdown link as ZERO words, so an evidence-heavy lead is not punished for linking", () => {
    const words = Array.from({ length: SECTION_MAX_WORDS }, () => "word").join(" ");
    const summary = `${words} [a long descriptive link label](https://example.test/very/long/path)`;

    expect(problems({ form: { ...VALID, artifact: { ...VALID.artifact, summary } } })).toEqual([]);
  });

  it("REFUSES a newline in the summary — it renders as one line above the collapsible", () => {
    const found = problems({ form: { ...VALID, artifact: { ...VALID.artifact, summary: "one\ntwo" } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("ONE line");
  });

  it("REFUSES a `+++` line in the summary, which would close the detail block early", () => {
    const found = problems({ form: { ...VALID, artifact: { ...VALID.artifact, summary: "+++ gotcha" } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("collapsible delimiter");
  });

  it("REFUSES a `+++` a vertical tab, form feed or NEL puts on its own line in the summary", () => {
    const found = [0x0b, 0x0c, 0x85].map((code) =>
      problems({
        form: { ...VALID, artifact: { ...VALID.artifact, summary: `gotcha${String.fromCodePoint(code)}+++` } },
      }).map((problem) => [problem.includes("ONE line"), problem.includes("collapsible delimiter")]),
    );

    expect(found).toEqual(
      [0x0b, 0x0c, 0x85].map(() => [
        [true, false],
        [false, true],
      ]),
    );
  });

  it("REFUSES an evidence label a vertical tab splits, which would open a fold inside the detail fold", () => {
    const vt = String.fromCodePoint(0x0b);
    const found = problems({
      form: {
        ...VALID,
        artifact: {
          ...VALID.artifact,
          evidence: [{ label: `source${vt}+++ injected${vt}${vt}content`, url: "https://example.test/run/1" }],
        },
      },
    });

    expect(found.map((problem) => problem.includes("ONE list item"))).toEqual([true]);
  });

  it("REFUSES an evidence URL carrying an angle bracket, which the renderer's brackets cannot survive", () => {
    const found = problems({
      form: {
        ...VALID,
        artifact: { ...VALID.artifact, evidence: [{ label: "x", url: "https://example.test/a>b" }] },
      },
    });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("angle brackets");
  });

  it("REFUSES a summary opening a code fence, which would swallow the detail fold below it", () => {
    const found = problems({ form: { ...VALID, artifact: { ...VALID.artifact, summary: "```" } } });

    expect(found.map((problem) => problem.slice(0, 48))).toEqual(["artifact.summary: a summary opening a code fence"]);
  });

  it("REFUSES raw HTML in the summary and a detail paragraph, not in an evidence label", () => {
    const found = problems({
      form: {
        ...VALID,
        artifact: {
          detail: [{ kind: "para", text: "<!--" }],
          evidence: [{ label: "the Array<string> run", url: "https://example.test/run/1" }],
          summary: "Pool exhausted <span>here</span>.",
        },
      },
    });

    expect(found.map((problem) => problem.split(": ")[0])).toEqual(["artifact.summary", "artifact.detail.0.text"]);
  });

  it("REFUSES an undeclared key rather than dropping it, and names the nearest field", () => {
    const found = problems({ form: { ...VALID, artifact: { ...VALID.artifact, citations: [] } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("REFUSED, not ignored");
  });
});

describe("linearCommentFormSchema — a document destination", () => {
  const DOCUMENT = {
    artifact: { evidence: [], summary: "i'd push to do this first, or at least alongside." },
    fields: { documentId: "f0a8e983-ffe3-4334-8a0c-cae7404502e3", quotedText: "Lean: no, as a follow-up." },
  };

  it("accepts a quoted document comment with NO evidence — the passage is its provenance", () => {
    expect(problems({ form: DOCUMENT })).toEqual([]);
  });

  it("accepts a top-level document comment with no quote", () => {
    expect(problems({ form: { ...DOCUMENT, fields: { documentId: "cdd0e58a1f3b" } } })).toEqual([]);
  });

  it("REFUSES a quote spanning a newline, which could never anchor to one selection", () => {
    const found = problems({ form: { ...DOCUMENT, fields: { ...DOCUMENT.fields, quotedText: "one\ntwo" } } });

    expect(found).toEqual(["fields.quotedText: quotedText is ONE passage of one paragraph; a newline never anchors"]);
  });

  it("REFUSES fields naming both an issue and a document", () => {
    const found = problems({ form: { ...DOCUMENT, fields: { ...DOCUMENT.fields, issueId: "AAA-1" } } });

    expect(found).toEqual([
      "fields: fields names ONE destination: { issueId } or { documentId, quotedText? | parentId? }",
    ]);
  });

  it("accepts a reply naming its thread's parent and no quote", () => {
    expect(problems({ form: { ...DOCUMENT, fields: { documentId: "cdd0e58a1f3b", parentId: "root-1" } } })).toEqual([]);
  });

  it("REFUSES a reply that also quotes a passage, since a reply inherits its thread's anchor", () => {
    const found = problems({ form: { ...DOCUMENT, fields: { ...DOCUMENT.fields, parentId: "root-1" } } });

    expect(found).toEqual([
      "fields.quotedText: a reply (parentId) inherits its thread's anchor, so it carries no quotedText — drop one of the two",
    ]);
  });

  it("REFUSES an empty parentId", () => {
    const found = problems({ form: { ...DOCUMENT, fields: { documentId: "cdd0e58a1f3b", parentId: "" } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("fields");
  });

  it("still REFUSES an ISSUE comment with no evidence, at the evidence path", () => {
    const found = problems({ form: { ...DOCUMENT, fields: { issueId: "AAA-1" } } });

    expect(found.length).toBe(1);
    expect(found[0]!).toContain("artifact.evidence: an issue comment needs at least one evidence link");
  });
});

describe("renderDocumentCommentBody", () => {
  it("is the summary alone when there is nothing to fold — no empty Evidence heading", () => {
    expect(renderDocumentCommentBody({ artifact: { evidence: [], summary: "agree for NODE_OPTIONS." } })).toBe(
      "agree for NODE_OPTIONS.",
    );
  });

  it("folds evidence exactly as an issue comment does when there is some", () => {
    const artifact = { evidence: [{ label: "run", url: "https://example.test/run/1" }], summary: "lead" };

    expect(renderDocumentCommentBody({ artifact })).toBe(renderCommentBody({ artifact }));
  });
});

describe("linearRelationFormSchema", () => {
  it("accepts each of the three kinds", () => {
    const kinds = ["blocks", "duplicate", "related"].map(
      (type) => linearRelationFormSchema.safeParse({ fields: { issueId: "a", relatedIssueId: "b", type } }).success,
    );

    expect(kinds).toEqual([true, true, true]);
  });

  it("REFUSES `similar`, which Linear's own engine produces rather than a caller asserting it", () => {
    expect(
      linearRelationFormSchema.safeParse({ fields: { issueId: "a", relatedIssueId: "b", type: "similar" } }).success,
    ).toBe(false);
  });

  it("REFUSES a self-relation here rather than letting the provider reject it after the door recorded a write", () => {
    const parsed = linearRelationFormSchema.safeParse({
      fields: { issueId: "same", relatedIssueId: "same", type: "blocks" },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join("\n")).toContain("cannot be related to itself");
  });
});

describe("renderCommentBody", () => {
  it("puts the summary above the fold and everything else inside Linear's collapsible", () => {
    const body = renderCommentBody({
      artifact: {
        detail: [{ kind: "para", text: "The migration ran at 02:14 and held its transaction open." }],
        evidence: [
          { label: "the failing run", url: "https://example.test/run/1" },
          { label: "the migration", url: "https://example.test/pr/2" },
        ],
        summary: "Staging exhausted its pool.",
      },
    });

    expect(body).toBe(
      [
        "Staging exhausted its pool.",
        "",
        "+++ Detail and evidence",
        "",
        "The migration ran at 02:14 and held its transaction open.",
        "",
        "**Evidence**",
        "",
        "- [the failing run](<https://example.test/run/1>)",
        "- [the migration](<https://example.test/pr/2>)",
        "",
        "+++",
      ].join("\n"),
    );
  });

  it("still opens and closes the collapsible when there is no detail, so the evidence is never bare", () => {
    const body = renderCommentBody({
      artifact: {
        evidence: [{ label: "the run", url: "https://example.test/run/1" }],
        summary: "Done.",
      },
    });

    expect(body).toBe(
      [
        "Done.",
        "",
        "+++ Detail and evidence",
        "",
        "**Evidence**",
        "",
        "- [the run](<https://example.test/run/1>)",
        "",
        "+++",
      ].join("\n"),
    );
  });

  it("escapes a bracket in an evidence label so it cannot break out of its own link construct", () => {
    const body = renderCommentBody({
      artifact: {
        evidence: [{ label: "x](https://attacker.test/p) [y", url: "https://example.test/run/1" }],
        summary: "Done.",
      },
    });

    expect(body).toContain("- [x\\](https://attacker.test/p) \\[y](<https://example.test/run/1>)");
  });

  it("keeps an accepted escaped tag escaped, so doubling its backslash cannot leave raw HTML", () => {
    const artifact = { evidence: [{ label: "\\<textarea>", url: "https://example.test/run/1" }], summary: "Done." };
    const body = renderCommentBody({ artifact });

    expect(problems({ form: { ...VALID, artifact } })).toEqual([]);
    expect(body).toContain("- [\\\\\\<textarea\\>](<https://example.test/run/1>)");
    expect(hasRawHtml({ text: body })).toBe(false);
  });

  it("accepts an unescaped tag or open comment in a label, which renders escaped and never raw", () => {
    const evidence = ["<!--", "the <b>run", "Array<string>"].map((label) => ({ label, url: "https://example.test/r" }));
    const artifact = { evidence, summary: "Done." };
    const body = renderCommentBody({ artifact });

    expect(problems({ form: { ...VALID, artifact } })).toEqual([]);
    expect(body).toContain("- [\\<!--](<https://example.test/r>)");
    expect(hasRawHtml({ text: body })).toBe(false);
  });

  it("keeps an escaped tag in a media alt escaped the same way", () => {
    const media = renderBlock({
      block: { alt: "\\<textarea>", kind: "media", mime: "image/png", url: "https://example.test/a.png" },
    });

    expect(media).toBe("![\\\\\\<textarea\\>](<https://example.test/a.png>)");
    expect(hasRawHtml({ text: media })).toBe(false);
  });
});
