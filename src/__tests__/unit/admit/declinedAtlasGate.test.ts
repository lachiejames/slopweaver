/** The gate that refuses an answer declining an atlas this install can actually read. */
import { describe, expect, it } from "vitest";

import {
  atlasesNamedInBlindSpots,
  DECLINED_ATLAS_OVERRIDE,
  type DeclinedAtlasReading,
  declinedAtlasFindings,
  declinedAtlasGate,
} from "../../../admit/declinedAtlasGate.js";
import { admitDoor } from "../../../admit/door.js";
import type { DoorRequest } from "../../../admit/types.js";
import { atlasPlatforms } from "../../../atlas/registry.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/**
 * The blind spot the gate exists for, in the shape a posted answer carries it. Note "google admin" with a
 * space, where the registry slug is `google-admin`.
 */
const DECLINED_BOTH =
  "the jumpcloud and google admin atlases, so i can't say where else an example rule is already enforced";

/**
 * A second blind spot from the SAME answer, and a completely honest one — a browser surface nobody walked.
 * It names `vanta`, which grades ANSWERABLE, so it is what proves the criterion needs the word "atlas".
 */
const HONEST_VANTA_SPOT =
  "no screenshot of the vanta control page: control-evidence reads the manage api only, and i didn't run " +
  "the browser walk that fills vanta's other channel";

/** The same claim, narrowed to the KIND that is genuinely dark — the sentence the gate must leave alone. */
const DECLINED_ONE_KIND = "the jumpcloud atlas's policies kind has never synced, so no example rule is readable";

/** Both atlases as this install really grades them: answerable, with the kinds each generation declares. */
const ANSWERABLE_BOTH: readonly DeclinedAtlasReading[] = [
  { answerable: true, kinds: ["policies", "systems", "usergroups"], platform: "jumpcloud" },
  { answerable: true, kinds: ["domain", "role", "user"], platform: "google-admin" },
];

/** The same two atlases in the state that makes the blind spot TRUE. */
const DARK_BOTH: readonly DeclinedAtlasReading[] = ANSWERABLE_BOTH.map((reading) => ({
  ...reading,
  answerable: false,
}));

function answer({ blindSpots }: { blindSpots: readonly string[] }): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [...blindSpots] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:133 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: ["slack read-thread", "atlas vanta read"],
      },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the example control is sitting at 1 of 2 tests",
    measurements: [],
  };
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "slack", verb: "post" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("atlasesNamedInBlindSpots", () => {
  it("names both atlases the measured blind spot declined, including the space-spelled slug", () => {
    expect(
      atlasesNamedInBlindSpots({
        blindSpots: [DECLINED_BOTH],
        platforms: ["datadog", "google-admin", "jumpcloud", "vanta"],
      }),
    ).toEqual(["google-admin", "jumpcloud"]);
  });

  it("names nothing when the blind spot never says atlas, so the shell grades nothing and reads no disk", () => {
    expect(atlasesNamedInBlindSpots({ blindSpots: [HONEST_VANTA_SPOT], platforms: ["datadog", "vanta"] })).toEqual([]);
  });

  it("does not match a platform sitting inside a longer word", () => {
    expect(
      atlasesNamedInBlindSpots({ blindSpots: ["the vantage atlas was unreachable"], platforms: ["vanta"] }),
    ).toEqual([]);
  });

  it("selects against the real registry, which is not empty", () => {
    const platforms = atlasPlatforms();

    expect(platforms.length).toBeGreaterThan(0);
    expect(atlasesNamedInBlindSpots({ blindSpots: [DECLINED_BOTH], platforms })).toEqual(["google-admin", "jumpcloud"]);
  });
});

describe("declinedAtlasFindings", () => {
  it("REFUSES the measured failure: one bullet declining two atlases that both grade ANSWERABLE", () => {
    const findings = declinedAtlasFindings({
      answer: answer({ blindSpots: [DECLINED_BOTH] }),
      readings: ANSWERABLE_BOTH,
    });

    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_DECLINES_READABLE_ATLAS"]);
    expect(findings[0]!.summary).toContain("jumpcloud");
    expect(findings[0]!.summary).toContain("google-admin");
    expect(findings[0]!.correction).toContain("slopweaver atlas");
  });

  it("stays silent on the SAME bullet when both atlases are dark — the grade does the work, not the text", () => {
    expect(declinedAtlasFindings({ answer: answer({ blindSpots: [DECLINED_BOTH] }), readings: DARK_BOTH })).toEqual([]);
  });

  it("leaves the same answer's honest vanta blind spot alone, because it never says atlas", () => {
    const findings = declinedAtlasFindings({
      answer: answer({ blindSpots: [HONEST_VANTA_SPOT] }),
      readings: [{ answerable: true, kinds: ["control", "policy", "test"], platform: "vanta" }],
    });

    expect(findings).toEqual([]);
  });

  it("is discharged by naming a KIND the generation declares, rather than the atlas", () => {
    expect(
      declinedAtlasFindings({ answer: answer({ blindSpots: [DECLINED_ONE_KIND] }), readings: ANSWERABLE_BOTH }),
    ).toEqual([]);
  });

  it("reports one finding per bullet, so a composer sees every one at once", () => {
    const findings = declinedAtlasFindings({
      answer: answer({ blindSpots: [DECLINED_BOTH, "the google admin atlas, so i can't check the org policy"] }),
      readings: ANSWERABLE_BOTH,
    });

    expect(findings.length).toBe(2);
    expect(findings[1]!.summary).toContain("google-admin atlas could not be seen");
  });

  it("checks nothing for a platform the shell handed back no reading for", () => {
    expect(declinedAtlasFindings({ answer: answer({ blindSpots: [DECLINED_BOTH] }), readings: [] })).toEqual([]);
  });
});

describe("declinedAtlasGate", () => {
  it("warns rather than passing, and names the override that waives it", () => {
    const decision = admitDoor({
      env: {},
      gates: [declinedAtlasGate({ answer: answer({ blindSpots: [DECLINED_BOTH] }), readings: ANSWERABLE_BOTH })],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(decision.findings.map((finding) => finding.severity)).toEqual(["warn"]);
    expect(decision.findings[0]!.code).toBe("ANSWER_DECLINES_READABLE_ATLAS");
  });

  it("passes once the override token is set, and records the waived finding", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: DECLINED_ATLAS_OVERRIDE },
      gates: [declinedAtlasGate({ answer: answer({ blindSpots: [DECLINED_BOTH] }), readings: ANSWERABLE_BOTH })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(decision.overridden.map((finding) => finding.code)).toEqual(["ANSWER_DECLINES_READABLE_ATLAS"]);
  });
});
