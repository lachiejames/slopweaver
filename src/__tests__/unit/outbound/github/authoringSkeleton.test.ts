/**
 * The authoring file's section skeleton: one raw string per `## ` section, in the one order the C3 format allows,
 * three of them required.
 */
import { describe, expect, it } from "vitest";
import { splitSections } from "../../../../outbound/github/authoringSkeleton.js";

const REQUIRED = ["Explainer", "Proof of the problem", "Proof of the solution"].map(
  (name) => `## ${name}\n\n${name} text`,
);
const SECTION_LIST =
  "## Explainer, ## Proof of the problem, ## Proof of the solution, ## Checks, ## Not checked, and why, ## Re-run";

describe("splitSections", () => {
  it("cuts a body into its sections, in order, each body trimmed", () => {
    const body = [...REQUIRED, "## Checks\n\n- c", "## Re-run\n\n```sh\nyarn x\n```"].join("\n\n");
    const sections = splitSections({ body });
    if (!(sections instanceof Map)) {
      throw new Error("expected the body to split into sections");
    }
    expect([...sections.entries()]).toEqual([
      ["Explainer", "Explainer text"],
      ["Proof of the problem", "Proof of the problem text"],
      ["Proof of the solution", "Proof of the solution text"],
      ["Checks", "- c"],
      ["Re-run", "```sh\nyarn x\n```"],
    ]);
  });

  it("refuses a section out of order, naming the order", () => {
    const body = [...REQUIRED, "## Re-run\n\nr", "## Checks\n\nc"].join("\n\n");
    expect(splitSections({ body })).toEqual({
      error: `"## Checks" is out of order — the sections go: ${SECTION_LIST}`,
    });
  });

  it("refuses a retired section by name, listing the ones this format has", () => {
    const body = ["## Risk\n\nr", ...REQUIRED].join("\n\n");
    expect(splitSections({ body })).toEqual({
      error: `unknown section "## Risk" — this format's sections are: ${SECTION_LIST}`,
    });
  });

  it("names every missing required section", () => {
    expect(splitSections({ body: "## Explainer\n\ne" })).toEqual({
      error: "missing required section(s): ## Proof of the problem, ## Proof of the solution",
    });
  });

  it("refuses text before the first header", () => {
    expect(splitSections({ body: `stray\n\n${REQUIRED.join("\n\n")}` })).toEqual({
      error: "there is text before the first `## ` section header — every section must be under one",
    });
  });
});
