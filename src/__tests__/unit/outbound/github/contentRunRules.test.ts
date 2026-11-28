/**
 * The one-spelling rule over a cell's runs, and the edit door that applies it with each cell's own edit path. A run of
 * any other kind between two text runs, an image included, is a boundary both readers keep.
 */
import { describe, expect, it } from "vitest";

import { adjacentTextRunIssues } from "../../../../outbound/github/contentRunRules.js";
import { contentCellsOf, mapContentFields } from "../../../../outbound/github/formContent.js";
import { prFormEditSchema, storedPrFormSchema } from "../../../../outbound/github/schema.js";
import { prFormWriteSchema } from "../../../../outbound/github/writeSchema.js";
import { EVERY_CELL_BODY, formOf } from "./fixtures.js";

/** The refusal for one adjacent pair, by the two indices it names. */
function merge({ first }: { first: number }): string {
  return `text runs at indices ${String(first)} and ${String(first + 1)} are adjacent and render as one run. Merge them into one text run`;
}

describe("adjacentTextRunIssues", () => {
  it("names both indices and addresses the second run under the cell's path", () => {
    expect(adjacentTextRunIssues({ content: [{ kind: "text" }, { kind: "text" }], path: ["checks", 2] })).toStrictEqual(
      [{ message: merge({ first: 0 }), path: ["checks", 2, 1] }],
    );
  });

  it("raises one issue per adjacent pair in a run of three", () => {
    const three = [{ kind: "text" }, { kind: "text" }, { kind: "text" }];
    expect(adjacentTextRunIssues({ content: three, path: ["explainer"] })).toStrictEqual([
      { message: merge({ first: 0 }), path: ["explainer", 1] },
      { message: merge({ first: 1 }), path: ["explainer", 2] },
    ]);
  });

  it.each([
    ["a single text run", [{ kind: "text" }]],
    ["text, strong, text", [{ kind: "text" }, { kind: "strong" }, { kind: "text" }]],
    ["text, image, text", [{ kind: "text" }, { kind: "image" }, { kind: "text" }]],
    ["no runs at all", []],
  ])("raises nothing for %s", (_name, content) => {
    expect(adjacentTextRunIssues({ content, path: ["explainer"] })).toStrictEqual([]);
  });
});

describe("contentCellsOf", () => {
  it("names exactly the cells the rewrite seam maps, check groups included", () => {
    const mapped: string[] = [];
    mapContentFields({
      body: EVERY_CELL_BODY,
      map: ({ content, path }) => {
        mapped.push(path.join("."));
        return content;
      },
    });
    const walked = contentCellsOf({ sections: EVERY_CELL_BODY }).map(({ path }) => path.join("."));
    expect([walked, walked.toSorted()]).toStrictEqual([
      [
        "explainer",
        "problemProof.reason",
        "solutionProof.proves",
        "checks.0",
        "checks.1",
        "checkGroups.0.label",
        "checkGroups.0.items.0",
        "notChecked.0.check",
        "notChecked.0.why",
        "rerun.0.content",
        "rerun.1.items.0",
        "rerun.1.items.1",
      ],
      mapped.toSorted(),
    ]);
  });
});

describe("storedPrFormSchema — a form already stored with adjacent text runs", () => {
  it("still reads, so only its next write is refused", () => {
    const stored = formOf({
      body: {
        ...EVERY_CELL_BODY,
        explainer: [
          { kind: "text", text: "People at acme lost an entry in ABC-1," },
          { kind: "text", text: " and this keeps it." },
        ],
      },
    });
    expect([storedPrFormSchema.safeParse(stored).data, prFormWriteSchema.safeParse(stored).success]).toStrictEqual([
      stored,
      false,
    ]);
  });
});

describe("prFormEditSchema — adjacent text runs", () => {
  it("refuses them in a set field and in each append, at the edit's own path", () => {
    const twice = [
      { kind: "text", text: "A sign-in " },
      { kind: "text", text: "still reads." },
    ];
    const parsed = prFormEditSchema.safeParse({
      appendChecks: [[{ kind: "text", text: "One run." }], twice],
      appendNotChecked: [{ check: [{ kind: "text", text: "A work account" }], why: twice }],
      checkGroups: [{ items: [twice], label: [{ kind: "text", text: "Unchanged" }] }],
      explainer: twice,
    });
    expect(parsed.error!.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
      ["explainer.1", `ADJACENT_TEXT_RUNS: ${merge({ first: 0 })}`],
      ["checkGroups.0.items.0.1", `ADJACENT_TEXT_RUNS: ${merge({ first: 0 })}`],
      ["appendChecks.1.1", `ADJACENT_TEXT_RUNS: ${merge({ first: 0 })}`],
      ["appendNotChecked.0.why.1", `ADJACENT_TEXT_RUNS: ${merge({ first: 0 })}`],
    ]);
  });

  it("accepts an edit whose every cell has one spelling", () => {
    const parsed = prFormEditSchema.safeParse({ appendChecks: [EVERY_CELL_BODY.checkGroups![0]!.items[0]] });
    expect(parsed.success).toBe(true);
  });
});
