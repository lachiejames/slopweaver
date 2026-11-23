/** Real evidence or say why: the subject table, the check, and the gate that refuses the incident answer. */
import { describe, expect, it } from "vitest";

import { admitDoor } from "../../../admit/door.js";
import {
  answerCarriesOpenableLink,
  REAL_ARTIFACT_SUBJECTS,
  realArtifactPreflightLines,
  realArtifactSubjectsOf,
  unaccountedRealArtifacts,
} from "../../../admit/realArtifact.js";
import { REAL_ARTIFACT_OVERRIDE, realArtifactFindings, realArtifactGate } from "../../../admit/realArtifactGate.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** The incident's own question, tags stripped, exactly as the brief carried it. */
const MONITOR_ASK =
  "do a 7-day backtest for these monitors, post screenshots here so we can see when this would have alerted " +
  "(ensure it alerts when we care, is silent when we don't)";

function answer(over: Partial<AnswerFormAnswer> = {}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: ["the monitors are not deployed, so datadog holds no alert history"] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:1 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: [],
      },
      reason: "answered from the thread",
    },
    images: ["/tmp/datadog-monitor-backtest.png", "/tmp/gcp-monitor-backtest.png"],
    index: [[{ text: "gcp: 1 alert in 7 days", type: "text" }]],
    kind: "answer",
    lead: "replayed both rules over 24 to 30 aug",
    measurements: [],
    ...over,
  };
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "slack", verb: "post" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("realArtifactSubjectsOf", () => {
  it("fires on the incident question, which never says the word `deploy`", () => {
    expect(MONITOR_ASK.includes("deploy")).toBe(false);
    expect(realArtifactSubjectsOf({ question: MONITOR_ASK }).map((subject) => subject.id)).toEqual([
      "deployed-monitor",
    ]);
  });

  it("raises nothing for a question with no real artifact behind it", () => {
    expect(realArtifactSubjectsOf({ question: "what did we decide about the retention window" })).toEqual([]);
  });

  it("has exactly the rows this module's header accounts for", () => {
    expect(REAL_ARTIFACT_SUBJECTS.map((subject) => subject.id)).toEqual(["deployed-monitor"]);
  });
});

describe("answerCarriesOpenableLink", () => {
  it("is false for the incident's own answer — it carried zero link runs of any kind", () => {
    expect(answerCarriesOpenableLink({ answer: answer() })).toBe(false);
  });

  it("is true once a link run renders in the body", () => {
    const withLink = answer({
      body: [
        {
          runs: [{ label: "monitor 600101", type: "link", url: "https://example.test/monitors/600101" }],
          type: "paragraph",
        },
      ],
    });

    expect(answerCarriesOpenableLink({ answer: withLink })).toBe(true);
  });
});

describe("unaccountedRealArtifacts", () => {
  it("REFUSES the measured failure: two generated charts, a named gap, no link and no reason", () => {
    expect(unaccountedRealArtifacts({ answer: answer(), question: MONITOR_ASK }).map((s) => s.id)).toEqual([
      "deployed-monitor",
    ]);
  });

  it("is discharged by a stated reason — the say-why half", () => {
    const said = answer({
      grounding: {
        ...answer().grounding,
        evidence: {
          ...answer().grounding.evidence,
          substitutedForReal: [
            {
              real: "the deployed monitor's own evaluation panel",
              why: "no DD_APP_KEY on this machine, so pulumi up refused",
            },
          ],
        },
      },
    });

    expect(unaccountedRealArtifacts({ answer: said, question: MONITOR_ASK })).toEqual([]);
  });

  it("is discharged by the real thing itself — the use-the-real-one half", () => {
    const linked = answer({
      body: [
        {
          runs: [{ label: "monitor 600101", type: "link", url: "https://example.test/monitors/600101" }],
          type: "paragraph",
        },
      ],
    });

    expect(unaccountedRealArtifacts({ answer: linked, question: MONITOR_ASK })).toEqual([]);
  });

  it("says nothing about a question that raises no real artifact", () => {
    expect(unaccountedRealArtifacts({ answer: answer(), question: "what did we decide" })).toEqual([]);
  });
});

describe("realArtifactFindings", () => {
  it("names the subject in the code so a refusal says which one tripped", () => {
    const findings = realArtifactFindings({ answer: answer(), question: MONITOR_ASK });

    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_NO_REAL_ARTIFACT_DEPLOYED_MONITOR"]);
    expect(findings[0]!.severity).toBe("warn");
  });
});

describe("realArtifactGate", () => {
  it("warns rather than passing, and names the override that waives it", () => {
    const decision = admitDoor({
      env: {},
      gates: [realArtifactGate({ answer: answer(), question: MONITOR_ASK })],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.code)).toEqual(["ANSWER_NO_REAL_ARTIFACT_DEPLOYED_MONITOR"]);
  });

  it("is waivable by its own override token, and the door RECORDS the waiver", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: REAL_ARTIFACT_OVERRIDE },
      gates: [realArtifactGate({ answer: answer(), question: MONITOR_ASK })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(decision.overridden.map((finding) => finding.code)).toEqual(["ANSWER_NO_REAL_ARTIFACT_DEPLOYED_MONITOR"]);
  });

  it("passes once the answer states why it could not get the real one", () => {
    const said = answer({
      grounding: {
        ...answer().grounding,
        evidence: {
          ...answer().grounding.evidence,
          substitutedForReal: [
            { real: "the deployed monitor's own panel", why: "the throwaway stack would not come up" },
          ],
        },
      },
    });

    const decision = admitDoor({
      env: {},
      gates: [realArtifactGate({ answer: said, question: MONITOR_ASK })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
  });
});

describe("realArtifactPreflightLines", () => {
  it("tells the worker what to go and get, and that the reason is the required part", () => {
    const lines = realArtifactPreflightLines({ question: MONITOR_ASK });

    expect(lines[0]).toBe(
      "REAL EVIDENCE, OR SAY WHY — this ask has a real artifact, and a picture you generate is not it:",
    );
    expect(lines.join("\n")).toContain("state WHY, in one line");
  });

  it("renders nothing for every other ask", () => {
    expect(realArtifactPreflightLines({ question: "what did we decide about retention" })).toEqual([]);
  });
});
