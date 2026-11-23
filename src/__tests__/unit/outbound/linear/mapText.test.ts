import { describe, expect, it } from "vitest";

import type { LinearCommentArtifact } from "../../../../outbound/linear/commentTypes.js";
import {
  mapCommentArtifactText,
  mapIssueArtifactText,
  mapProjectUpdateArtifactText,
  type TextMapper,
} from "../../../../outbound/linear/mapText.js";
import type { LinearProjectUpdateArtifact } from "../../../../outbound/linear/projectUpdateTypes.js";
import type { FreeformIssue, StructuredIssue } from "../../../../outbound/linear/types.js";

/** A mapper that upper-cases every string it is handed, records each path in call order, and reports one issue per call. */
const recorder = (): { map: TextMapper; seen: (readonly (string | number)[])[] } => {
  const seen: (readonly (string | number)[])[] = [];
  const map: TextMapper = ({ text, path }) => {
    seen.push(path);
    return { issues: [{ message: `saw ${text}`, path }], text: text.toUpperCase() };
  };
  return { map, seen };
};

/** A code block and a media block whose literal content must come through untouched. */
const CODE = { kind: "code", lang: "ts", text: "code body" } as const;
const MEDIA = { alt: "media alt", kind: "media", mime: "image/png", url: "https://x.example/a.png" } as const;

describe("mapIssueArtifactText", () => {
  it("rewrites every authored string of a structured issue, leaves code and media alone, and reports in section order", () => {
    const { map, seen } = recorder();
    const artifact: StructuredIssue = {
      acceptance: ["acc one", "acc two"],
      aiPrompt: [{ kind: "para", text: "prompt" }],
      kind: "structured",
      problem: [
        { kind: "para", text: "problem para" },
        {
          items: [
            { text: "plain item" },
            {
              nested: [
                { kind: "para", text: "nested para" },
                CODE,
                MEDIA,
                { items: [{ done: true, text: "nested check" }], kind: "checklist" },
              ],
              text: "parent item",
            },
          ],
          kind: "bullets",
        },
      ],
      proofOfProblem: [{ items: [{ done: false, text: "proof check" }], kind: "checklist" }],
      solution: [CODE, MEDIA, { kind: "para", text: "solution para" }],
    };
    const result = mapIssueArtifactText({ artifact, map });
    expect(result.artifact).toEqual({
      acceptance: ["ACC ONE", "ACC TWO"],
      aiPrompt: [{ kind: "para", text: "PROMPT" }],
      kind: "structured",
      problem: [
        { kind: "para", text: "PROBLEM PARA" },
        {
          items: [
            { text: "PLAIN ITEM" },
            {
              nested: [
                { kind: "para", text: "NESTED PARA" },
                { kind: "code", lang: "ts", text: "code body" },
                { alt: "media alt", kind: "media", mime: "image/png", url: "https://x.example/a.png" },
                { items: [{ done: true, text: "NESTED CHECK" }], kind: "checklist" },
              ],
              text: "PARENT ITEM",
            },
          ],
          kind: "bullets",
        },
      ],
      proofOfProblem: [{ items: [{ done: false, text: "PROOF CHECK" }], kind: "checklist" }],
      solution: [
        { kind: "code", lang: "ts", text: "code body" },
        { alt: "media alt", kind: "media", mime: "image/png", url: "https://x.example/a.png" },
        { kind: "para", text: "SOLUTION PARA" },
      ],
    });
    expect(seen).toEqual([
      ["aiPrompt", 0, "text"],
      ["problem", 0, "text"],
      ["problem", 1, "items", 0, "text"],
      ["problem", 1, "items", 1, "text"],
      ["problem", 1, "items", 1, "nested", 0, "text"],
      ["problem", 1, "items", 1, "nested", 3, "items", 0, "text"],
      ["solution", 2, "text"],
      ["proofOfProblem", 0, "items", 0, "text"],
      ["acceptance", 0, "text"],
      ["acceptance", 1, "text"],
    ]);
    expect(result.issues).toEqual([
      { message: "saw problem para", path: ["problem", 0, "text"] },
      { message: "saw plain item", path: ["problem", 1, "items", 0, "text"] },
      { message: "saw parent item", path: ["problem", 1, "items", 1, "text"] },
      { message: "saw nested para", path: ["problem", 1, "items", 1, "nested", 0, "text"] },
      { message: "saw nested check", path: ["problem", 1, "items", 1, "nested", 3, "items", 0, "text"] },
      { message: "saw solution para", path: ["solution", 2, "text"] },
      { message: "saw prompt", path: ["aiPrompt", 0, "text"] },
      { message: "saw proof check", path: ["proofOfProblem", 0, "items", 0, "text"] },
      { message: "saw acc one", path: ["acceptance", 0, "text"] },
      { message: "saw acc two", path: ["acceptance", 1, "text"] },
    ]);
  });

  it("adds neither acceptance nor proofOfProblem to a structured issue that declared neither", () => {
    const { map } = recorder();
    const artifact: StructuredIssue = {
      aiPrompt: [],
      kind: "structured",
      problem: [{ kind: "para", text: "p" }],
      solution: [{ kind: "para", text: "s" }],
    };
    expect(mapIssueArtifactText({ artifact, map })).toEqual({
      artifact: {
        aiPrompt: [],
        kind: "structured",
        problem: [{ kind: "para", text: "P" }],
        solution: [{ kind: "para", text: "S" }],
      },
      issues: [
        { message: "saw p", path: ["problem", 0, "text"] },
        { message: "saw s", path: ["solution", 0, "text"] },
      ],
    });
  });

  it("adds no optional key the issue omitted, and keeps one it set explicitly undefined", () => {
    const { map } = recorder();
    const base: StructuredIssue = {
      aiPrompt: [],
      kind: "structured",
      problem: [{ kind: "para", text: "p" }],
      solution: [{ kind: "para", text: "s" }],
    };
    const omitted = mapIssueArtifactText({ artifact: base, map }).artifact;
    const explicit = mapIssueArtifactText({
      artifact: { ...base, acceptance: undefined, proofOfProblem: undefined },
      map,
    }).artifact;
    expect(Object.keys(omitted).toSorted()).toEqual(["aiPrompt", "kind", "problem", "solution"]);
    expect(Object.keys(explicit).toSorted()).toEqual([
      "acceptance",
      "aiPrompt",
      "kind",
      "problem",
      "proofOfProblem",
      "solution",
    ]);
    expect(explicit).toStrictEqual({
      acceptance: undefined,
      aiPrompt: [],
      kind: "structured",
      problem: [{ kind: "para", text: "P" }],
      proofOfProblem: undefined,
      solution: [{ kind: "para", text: "S" }],
    });
  });

  it("rewrites a freeform heading and body, reporting the body before the AI prompt", () => {
    const { map, seen } = recorder();
    const artifact: FreeformIssue = {
      aiPrompt: [{ kind: "para", text: "prompt" }],
      body: [{ kind: "heading", text: "heading" }, CODE, { items: [{ text: "item" }], kind: "bullets" }],
      kind: "freeform",
    };
    expect(mapIssueArtifactText({ artifact, map })).toEqual({
      artifact: {
        aiPrompt: [{ kind: "para", text: "PROMPT" }],
        body: [
          { kind: "heading", text: "HEADING" },
          { kind: "code", lang: "ts", text: "code body" },
          { items: [{ text: "ITEM" }], kind: "bullets" },
        ],
        kind: "freeform",
      },
      issues: [
        { message: "saw heading", path: ["body", 0, "text"] },
        { message: "saw item", path: ["body", 2, "items", 0, "text"] },
        { message: "saw prompt", path: ["aiPrompt", 0, "text"] },
      ],
    });
    expect(seen).toEqual([
      ["aiPrompt", 0, "text"],
      ["body", 0, "text"],
      ["body", 2, "items", 0, "text"],
    ]);
  });
});

describe("mapCommentArtifactText", () => {
  it("rewrites only the summary of a comment with no detail", () => {
    const { map } = recorder();
    const artifact: LinearCommentArtifact = { evidence: [{ label: "ev", url: "https://x.example" }], summary: "sum" };
    expect(mapCommentArtifactText({ artifact, map })).toEqual({
      artifact: { evidence: [{ label: "ev", url: "https://x.example" }], summary: "SUM" },
      issues: [{ message: "saw sum", path: ["summary", "text"] }],
    });
  });

  it("rewrites the summary and every detail block, leaving the evidence label alone", () => {
    const { map } = recorder();
    const artifact: LinearCommentArtifact = {
      detail: [{ kind: "para", text: "det" }, MEDIA],
      evidence: [{ label: "ev", url: "https://x.example" }],
      summary: "sum",
    };
    expect(mapCommentArtifactText({ artifact, map })).toEqual({
      artifact: {
        detail: [
          { kind: "para", text: "DET" },
          { alt: "media alt", kind: "media", mime: "image/png", url: "https://x.example/a.png" },
        ],
        evidence: [{ label: "ev", url: "https://x.example" }],
        summary: "SUM",
      },
      issues: [
        { message: "saw sum", path: ["summary", "text"] },
        { message: "saw det", path: ["detail", 0, "text"] },
      ],
    });
  });
});

describe("mapProjectUpdateArtifactText", () => {
  it("rewrites only the summary of an update with no detail", () => {
    const { map } = recorder();
    const artifact: LinearProjectUpdateArtifact = { summary: "sum" };
    expect(mapProjectUpdateArtifactText({ artifact, map })).toEqual({
      artifact: { summary: "SUM" },
      issues: [{ message: "saw sum", path: ["summary", "text"] }],
    });
  });

  it("rewrites the summary and every detail block of an update", () => {
    const { map } = recorder();
    const artifact: LinearProjectUpdateArtifact = {
      detail: [{ items: [{ done: false, text: "todo" }], kind: "checklist" }, CODE],
      summary: "sum",
    };
    expect(mapProjectUpdateArtifactText({ artifact, map })).toEqual({
      artifact: {
        detail: [
          { items: [{ done: false, text: "TODO" }], kind: "checklist" },
          { kind: "code", lang: "ts", text: "code body" },
        ],
        summary: "SUM",
      },
      issues: [
        { message: "saw sum", path: ["summary", "text"] },
        { message: "saw todo", path: ["detail", 0, "items", 0, "text"] },
      ],
    });
  });
});
