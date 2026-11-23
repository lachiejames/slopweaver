/** Ranking a skill catalogue against a question's subject, and the brief section it renders. */
import { describe, expect, it } from "vitest";

import {
  type CatalogueSkill,
  discriminatingTokens,
  rankSkills,
  skillRoutingLines,
  subjectTokens,
} from "../../../../live/turn/skillRouting.js";

/** The incident's own question, tags stripped, exactly as the brief carried it. */
const MONITOR_ASK =
  "do a 7-day backtest for these monitors, post screenshots here so we can see when this would have alerted " +
  "(ensure it alerts when we care, is silent when we don't)";

/**
 * A catalogue of the same SHAPE the real one has: one entry that owns the subject outright, one that shares
 * its common words, and enough filler that a common token is not discriminating.
 */
const CATALOGUE: readonly CatalogueSkill[] = [
  {
    description:
      "The shape every Datadog monitor PR has to arrive in — one problem per monitor, critical-only, " +
      "deployed locally on a throwaway stack first, and a cropped, annotated 7-day backtest with the " +
      "monitor link above the fold.",
    name: "datadog-monitor-pr",
    path: ".agents/skills/datadog-monitor-pr/SKILL.md",
  },
  {
    description: "Post-PR gate — monitors CI on an open PR, enforces proof completeness, and parks for review.",
    name: "post-ship",
    path: ".agents/skills/post-ship/SKILL.md",
  },
  {
    description: "Post a release note to the team once a change is live.",
    name: "release-note",
    path: ".agents/skills/release-note/SKILL.md",
  },
  {
    description: "Post a weekly project update, gathering owners and descriptions first.",
    name: "project-updates",
    path: ".agents/skills/project-updates/SKILL.md",
  },
  { description: "Seed deterministic database fixtures.", name: "seed-fixtures", path: "s/seed-fixtures/SKILL.md" },
  { description: "Colocate GraphQL fragments with components.", name: "fragments", path: "s/fragments/SKILL.md" },
  { description: "Rotate expiring credentials on schedule.", name: "rotate-creds", path: "s/rotate-creds/SKILL.md" },
  { description: "Trace one order through the pipeline.", name: "trace-order", path: "s/trace-order/SKILL.md" },
  { description: "Write a specification from an idea.", name: "spec", path: "s/spec/SKILL.md" },
  { description: "Lint and format the whole workspace.", name: "linting", path: "s/linting/SKILL.md" },
  { description: "Bump a vulnerable dependency and prove the fix.", name: "vuln-fix", path: "s/vuln-fix/SKILL.md" },
  { description: "Post a customer-facing release announcement.", name: "announce", path: "s/announce/SKILL.md" },
];

describe("subjectTokens", () => {
  it("lower-cases, drops short words and strips the plural so `monitors` matches `monitor`", () => {
    expect([...subjectTokens({ text: "Do a 7-day BACKTEST of these Monitors" })].toSorted()).toEqual([
      "backtest",
      "monitor",
      "these",
    ]);
  });

  it("returns nothing for text with no token long enough to carry a subject", () => {
    expect([...subjectTokens({ text: "is it up? do we?" })]).toEqual([]);
  });
});

describe("discriminatingTokens", () => {
  it("keeps a token one skill owns and drops one carried by too many", () => {
    const kept = discriminatingTokens({ question: MONITOR_ASK, skills: CATALOGUE });

    expect(kept.get("backtest")).toBe(1);
    expect(kept.has("post")).toBe(false);
  });

  it("drops a token no skill carries at all — there is nothing to rank on", () => {
    expect(discriminatingTokens({ question: "what about kubernetes", skills: CATALOGUE }).size).toBe(0);
  });

  it("discriminates nothing against an empty catalogue", () => {
    expect(discriminatingTokens({ question: MONITOR_ASK, skills: [] }).size).toBe(0);
  });
});

describe("rankSkills", () => {
  it("puts the skill that OWNS the incident's subject first, clear of the one sharing its common words", () => {
    const ranked = rankSkills({ question: MONITOR_ASK, skills: CATALOGUE });

    expect(ranked[0]!.skill.name).toBe("datadog-monitor-pr");
    expect(ranked[0]!.score).toBeGreaterThan(1.2);
  });

  it("weights a token by 1/frequency, so a sole owner outranks a shared word", () => {
    const ranked = rankSkills({ question: MONITOR_ASK, skills: CATALOGUE });
    const monitorPr = ranked.find((entry) => entry.skill.name === "datadog-monitor-pr")!;
    const postShip = ranked.find((entry) => entry.skill.name === "post-ship")!;

    expect(monitorPr.score).toBeGreaterThan(postShip.score);
  });

  it("returns nothing when no discriminating token matches", () => {
    expect(rankSkills({ question: "what about kubernetes", skills: CATALOGUE })).toEqual([]);
  });

  it("honours the limit", () => {
    expect(rankSkills({ limit: 1, question: MONITOR_ASK, skills: CATALOGUE }).length).toBe(1);
  });
});

describe("skillRoutingLines", () => {
  it("names the ranked candidates and the count of the rest", () => {
    const lines = skillRoutingLines({ question: MONITOR_ASK, skills: CATALOGUE });

    expect(lines[0]).toContain("SKILLS OWNING THIS SUBJECT");
    expect(lines[2]).toBe(
      "  - datadog-monitor-pr (.agents/skills/datadog-monitor-pr/SKILL.md) — " + CATALOGUE[0]!.description,
    );
  });

  it("STATES a matched-nothing catalogue rather than rendering silence", () => {
    const lines = skillRoutingLines({ question: "what about kubernetes", skills: CATALOGUE });

    expect(lines[0]).toBe("SKILLS — 12 available, none matched this question's subject. Judgement is yours; if you");
  });

  it("tells an empty catalogue apart from a matched-nothing one, because they mean different things", () => {
    const lines = skillRoutingLines({ question: MONITOR_ASK, skills: [] });

    expect(lines[0]).toBe(
      "SKILLS — no skill catalogue was discoverable from here. That is a defect, not an absence: say so in",
    );
  });
});
