/**
 * The SOP gate over an EDITED document — which is the only kind it exists for.
 *
 * A freshly rendered draft passes every check here trivially. The draft is written to a file precisely so a
 * person can change it before it goes anywhere, and `sop publish` lints what is on disk rather than what the
 * form said, so each case below starts from the rendered document and breaks it the way a hand-edit would.
 */
import { describe, expect, it } from "vitest";
import { SOP_FORM_EXAMPLE } from "../../../../cli/commands/sop/formExample.js";
import { lintSop, sopFindingLines } from "../../../../outbound/sop/lint.js";
import { renderSop } from "../../../../outbound/sop/render.js";

const clean = renderSop({ form: SOP_FORM_EXAMPLE });

/** Every rule the linter fired on one document. */
function rulesFor({ markdown }: { markdown: string }): readonly string[] {
  return lintSop({ markdown }).findings.map((finding) => finding.rule);
}

describe("a rendered draft passes", () => {
  it("finds nothing and does not block", () => {
    const result = lintSop({ markdown: clean });
    expect(result.findings).toEqual([]);
    expect(result.blocked).toBe(false);
  });
});

describe("a section deleted by hand", () => {
  it("is reported as missing", () => {
    const markdown = clean.replace("## Escalation", "## Who to bother");
    expect(rulesFor({ markdown })).toEqual(["missing-section"]);
  });

  it("is reported once per missing section", () => {
    const markdown = clean.replace("## Escalation", "## Who to bother").replace("## Purpose", "## Why");
    expect(rulesFor({ markdown })).toEqual(["missing-section", "missing-section"]);
  });
});

describe("sections moved out of the house order", () => {
  it("names the order it found and the order it wanted", () => {
    const markdown = `## Steps\n\n### 1. a\n\n**Who:** someone\n\n${clean}`;
    const finding = lintSop({ markdown }).findings.find((each) => each.rule === "section-order");
    expect(finding?.message).toContain("steps > at-a-glance");
  });
});

describe("a placeholder typed into an edited draft", () => {
  it("is reported with the line it sits on", () => {
    const markdown = clean.replace("**Who:** a tool admin", "**Who:** TBD");
    const findings = lintSop({ markdown }).findings;
    expect(findings.map((each) => each.rule)).toEqual(["unfilled-placeholder"]);
    expect(findings[0]!.line).toBe(clean.split("\n").indexOf("**Who:** a tool admin") + 1);
  });
});

describe("a step whose actor line was removed", () => {
  it("names the step that now names nobody", () => {
    const markdown = clean.replace("\n**Who:** a tool admin\n", "\n");
    const findings = lintSop({ markdown }).findings;
    expect(findings.map((each) => each.rule)).toEqual(["step-without-actor"]);
    expect(findings[0]!.message).toContain("Create the seat at the lowest level");
  });
});

describe("the source", () => {
  it("must be a link rather than the name of one", () => {
    const markdown = clean.replace("[the request thread](https://example.test/threads/1)", "the request thread");
    expect(rulesFor({ markdown })).toEqual(["unlinked-source"]);
  });
});

describe("the unreviewed-draft notice", () => {
  it("cannot be quietly deleted, because removing it changes what the page claims", () => {
    const markdown = clean.split("\n").slice(1).join("\n");
    expect(rulesFor({ markdown })).toEqual(["missing-unreviewed-notice"]);
  });
});

describe("the operator-facing report", () => {
  it("says nothing at all when there is nothing to say", () => {
    expect(sopFindingLines({ findings: [] })).toEqual([]);
  });

  it("counts the findings and prints the rule, the line and the message", () => {
    const lines = sopFindingLines({ findings: [{ line: 7, message: "a thing", rule: "a-rule" }] });
    expect(lines).toEqual(["1 blocking finding(s):", "  [a-rule] line 7: a thing"]);
  });
});
