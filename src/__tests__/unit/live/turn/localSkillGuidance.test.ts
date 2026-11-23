import { describe, expect, it } from "vitest";

import { localSkillGuidanceLines, matchingLocalSkillTriggers } from "../../../../live/turn/localSkillGuidance.js";

describe("matchingLocalSkillTriggers", () => {
  it("matches the vulnerability-fix-pr trigger on a real dependency-vuln ask", () => {
    const matched = matchingLocalSkillTriggers({ question: "5 more PRs, lets squash these GitHub critical vulns" });
    expect(matched.map((trigger) => trigger.skillPath)).toEqual([".agents/skills/vulnerability-fix-pr/SKILL.md"]);
  });

  it("matches on the exact regression fixture text", () => {
    const matched = matchingLocalSkillTriggers({ question: "raise PRs for these criticals" });
    expect(matched).not.toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const matched = matchingLocalSkillTriggers({ question: "please patch this CVE-2026-12345" });
    expect(matched).not.toHaveLength(0);
  });

  it("matches nothing for an unrelated question", () => {
    expect(matchingLocalSkillTriggers({ question: "what are my open PRs?" })).toEqual([]);
  });
});

describe("localSkillGuidanceLines", () => {
  it("names the skill path and reason for a matching question", () => {
    const lines = localSkillGuidanceLines({ question: "raise PRs for these criticals" }).join("\n");
    expect(lines).toContain(".agents/skills/vulnerability-fix-pr/SKILL.md");
    expect(lines).toContain("yarn-why before/after proof — necessary but not sufficient");
  });

  it("renders nothing for an unrelated question", () => {
    expect(localSkillGuidanceLines({ question: "what are my open PRs?" })).toEqual([]);
  });
});
