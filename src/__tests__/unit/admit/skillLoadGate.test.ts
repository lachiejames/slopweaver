/** The gate that refuses an answer which loaded no skill on a subject the catalogue plainly owns. */
import { describe, expect, it } from "vitest";

import { admitDoor } from "../../../admit/door.js";
import {
  CLEAR_OWNER_SCORE,
  SKILL_LOAD_OVERRIDE,
  skillLoadFindings,
  skillLoadGate,
} from "../../../admit/skillLoadGate.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { CatalogueSkill } from "../../../live/turn/skillRouting.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** The incident's own question, tags stripped, exactly as the brief carried it. */
const MONITOR_ASK =
  "do a 7-day backtest for these monitors, post screenshots here so we can see when this would have alerted " +
  "(ensure it alerts when we care, is silent when we don't)";

/** A catalogue of the real one's shape: one clear owner, one near-miss, and enough filler to calibrate. */
const CATALOGUE: readonly CatalogueSkill[] = [
  {
    description:
      "The shape every Datadog monitor PR has to arrive in — one problem per monitor, deployed locally on a " +
      "throwaway stack first, and a cropped 7-day backtest with the monitor link above the fold.",
    name: "datadog-monitor-pr",
    path: ".agents/skills/datadog-monitor-pr/SKILL.md",
  },
  { description: "Post-PR gate — monitors CI on an open PR.", name: "post-ship", path: "s/post-ship/SKILL.md" },
  { description: "Post a release note once a change is live.", name: "release-note", path: "s/release-note/SKILL.md" },
  { description: "Post a weekly project update.", name: "project-updates", path: "s/project-updates/SKILL.md" },
  { description: "Post a customer-facing announcement.", name: "announce", path: "s/announce/SKILL.md" },
  { description: "Seed deterministic database fixtures.", name: "seed-fixtures", path: "s/seed-fixtures/SKILL.md" },
  { description: "Colocate GraphQL fragments with components.", name: "fragments", path: "s/fragments/SKILL.md" },
  { description: "Rotate expiring credentials on schedule.", name: "rotate-creds", path: "s/rotate-creds/SKILL.md" },
  { description: "Trace one order through the pipeline.", name: "trace-order", path: "s/trace-order/SKILL.md" },
  { description: "Write a specification from an idea.", name: "spec", path: "s/spec/SKILL.md" },
  { description: "Lint and format the whole workspace.", name: "linting", path: "s/linting/SKILL.md" },
  { description: "Bump a vulnerable dependency and prove the fix.", name: "vuln-fix", path: "s/vuln-fix/SKILL.md" },
];

function answer({ skillsLoaded = [] }: { skillsLoaded?: readonly string[] } = {}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else to check" },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:1 (Claude Code, in-turn)",
        skillsLoaded: [...skillsLoaded],
        verbsLoaded: ["slack read-thread", "github read", "datadog verify", "datadog raw"],
      },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "replayed both rules over 24 to 30 aug",
    measurements: [],
  };
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "slack", verb: "post" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("skillLoadFindings", () => {
  it("REFUSES the measured failure: four verbs loaded, no skills, on a subject one skill owns", () => {
    const findings = skillLoadFindings({ answer: answer(), question: MONITOR_ASK, skills: CATALOGUE });

    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_LOADED_NO_SKILL"]);
    expect(findings[0]!.correction).toContain(".agents/skills/datadog-monitor-pr/SKILL.md");
  });

  it("is discharged by naming ANY skill — it never claims to know which one was right", () => {
    const findings = skillLoadFindings({
      answer: answer({ skillsLoaded: ["slopweaver:slack-read-thread"] }),
      question: MONITOR_ASK,
      skills: CATALOGUE,
    });

    expect(findings).toEqual([]);
  });

  it("stays silent when no candidate reaches the measured floor", () => {
    const findings = skillLoadFindings({ answer: answer(), question: "post an update", skills: CATALOGUE });

    expect(findings).toEqual([]);
  });

  it("stays silent when no catalogue was discovered at all", () => {
    expect(skillLoadFindings({ answer: answer(), question: MONITOR_ASK, skills: [] })).toEqual([]);
  });

  it("keeps the floor a named measurement rather than a literal in the check", () => {
    expect(CLEAR_OWNER_SCORE).toBe(1.25);
  });
});

describe("skillLoadGate", () => {
  it("warns rather than passing, and names the override that waives it", () => {
    const decision = admitDoor({
      env: {},
      gates: [skillLoadGate({ answer: answer(), question: MONITOR_ASK, skills: CATALOGUE })],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toEqual(["ANSWER_LOADED_NO_SKILL"]);
  });

  it("is waivable by its own override token, and the door RECORDS the waiver", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: SKILL_LOAD_OVERRIDE },
      gates: [skillLoadGate({ answer: answer(), question: MONITOR_ASK, skills: CATALOGUE })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(decision.overridden.map((finding) => finding.code)).toEqual(["ANSWER_LOADED_NO_SKILL"]);
  });

  it("passes once a skill is named", () => {
    const decision = admitDoor({
      env: {},
      gates: [
        skillLoadGate({
          answer: answer({ skillsLoaded: ["datadog-monitor-pr"] }),
          question: MONITOR_ASK,
          skills: CATALOGUE,
        }),
      ],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
  });
});
