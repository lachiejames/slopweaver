import { describe, expect, it } from "vitest";

import { findingDocMarkdown, findingDocSlug, selectTopFindings } from "../../../onboardEval/findings.js";
import type { FrictionFinding } from "../../../onboardEval/frictionReport.js";

const FINDING: FrictionFinding = {
  detail: "had to guess which flag mapped where",
  severity: "had-to-guess",
  skillRef: "skills/onboard/SKILL.md § 4",
  stepId: "4-slack-app",
  verb: "slopweaver onboard",
};

describe("selectTopFindings", () => {
  it("takes the first N findings, already worst-first", () => {
    const findings = [FINDING, { ...FINDING, stepId: "b" }, { ...FINDING, stepId: "c" }];
    expect(selectTopFindings({ count: 2, findings }).map((f) => f.stepId)).toEqual(["4-slack-app", "b"]);
  });

  it("files none for a non-positive count", () => {
    expect(selectTopFindings({ count: 0, findings: [FINDING] })).toEqual([]);
    expect(selectTopFindings({ count: -1, findings: [FINDING] })).toEqual([]);
  });
});

describe("findingDocSlug", () => {
  it("is lowercase, hyphenated, and includes the run id, index, and step id", () => {
    expect(findingDocSlug({ finding: FINDING, index: 2, runId: "2026-08-29T00:00:00Z" })).toBe(
      "onboard-eval-2026-08-29t00-00-00z-2-4-slack-app",
    );
  });
});

describe("findingDocMarkdown", () => {
  it("renders valid frontmatter naming the repo, status ready, and an empty doneWhen", () => {
    const markdown = findingDocMarkdown({ finding: FINDING, index: 0, repo: "/repo", runId: "run-1" });
    expect(markdown).toContain("slug: onboard-eval-run-1-0-4-slack-app");
    expect(markdown).toContain("status: ready");
    expect(markdown).toContain("repo: /repo");
    expect(markdown).toContain("doneWhen: []");
    expect(markdown).toContain("had to guess which flag mapped where");
  });
});
