import { describe, expect, it } from "vitest";

import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import { groundingProse } from "../../../../outbound/assistant/groundingRefs.js";

type Evidence = AnswerFormAnswer["grounding"]["evidence"];

/** The evidence trail every grounding kind carries, with only what a case varies filled in. */
function evidence({
  read = [],
  consultedEmpty = [],
  premiseChecks = [],
  substitutedForReal = [],
  blindSpots = [],
}: {
  read?: Evidence["read"];
  consultedEmpty?: Evidence["consultedEmpty"];
  premiseChecks?: Evidence["premiseChecks"];
  substitutedForReal?: Evidence["substitutedForReal"];
  blindSpots?: readonly string[];
} = {}): Evidence {
  const couldNotSee: Evidence["couldNotSee"] =
    blindSpots.length === 0 ? { blindSpots: [], reason: "nothing was out of reach" } : { blindSpots: [...blindSpots] };
  return { consultedEmpty, couldNotSee, premiseChecks, read, substitutedForReal };
}

const PROVENANCE = { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] };

describe("groundingProse", () => {
  it("reports an UNLINKED evidence label, which renders to the reader as plain text", () => {
    const prose = groundingProse({
      grounding: {
        evidence: evidence({ read: [{ label: "the HRS-52 control page" }] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    expect(prose.map((entry) => ({ path: entry.path, text: entry.text }))).toContainEqual({
      path: ["grounding", "evidence", "read", 0, "label"],
      text: "the HRS-52 control page",
    });
  });

  it("omits a LINKED evidence label, whose reference is already a hyperlink over its own text", () => {
    const prose = groundingProse({
      grounding: {
        evidence: evidence({ read: [{ label: "the HRS-52 control page", url: "https://example.com/c" }] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    expect(prose.map((entry) => entry.text)).toEqual(["nothing was out of reach", "judgement alone"]);
  });

  it("reports every blind spot by index — the field a real answer carried two bare references in", () => {
    const prose = groundingProse({
      grounding: {
        evidence: evidence({ blindSpots: ["no shot of HRS-52", "DCH-108 was not probed"] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    expect(prose.map((entry) => ({ path: entry.path, text: entry.text }))).toEqual([
      { path: ["grounding", "evidence", "couldNotSee", "blindSpots", 0], text: "no shot of HRS-52" },
      { path: ["grounding", "evidence", "couldNotSee", "blindSpots", 1], text: "DCH-108 was not probed" },
      { path: ["grounding", "reason"], text: "judgement alone" },
    ]);
  });

  it("reports an unlinked premise check's subject and how, and neither when it carries a url", () => {
    const check = {
      checkedAtIso: "2026-09-07T04:00:00Z",
      finding: "absent" as const,
      how: "read HRS-52",
      subject: "HRS-52",
    };
    const unlinked = groundingProse({
      grounding: {
        evidence: evidence({ premiseChecks: [check] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    expect(unlinked.map((entry) => entry.text)).toEqual([
      "HRS-52",
      "read HRS-52",
      "nothing was out of reach",
      "judgement alone",
    ]);
    const linked = groundingProse({
      grounding: {
        evidence: evidence({ premiseChecks: [{ ...check, url: "https://example.com/c" }] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    expect(linked.map((entry) => entry.text)).toEqual(["nothing was out of reach", "judgement alone"]);
  });

  it("reports a verb grounding's capability.what and result, and never its command", () => {
    const prose = groundingProse({
      grounding: {
        capability: {
          command: ["slopweaver", "atlas", "vanta", "read", "--id", "HRS-52"],
          id: "vanta-read",
          what: "read HRS-52 live",
        },
        evidence: evidence(),
        kind: "verb",
        provenance: PROVENANCE,
        result: "HRS-52 is one test away",
      },
    });
    expect(prose.map((entry) => entry.text)).toEqual([
      "nothing was out of reach",
      "read HRS-52 live",
      "HRS-52 is one test away",
    ]);
  });

  it("reports an unreachable grounding's surface.what and why", () => {
    const prose = groundingProse({
      grounding: {
        evidence: evidence(),
        kind: "unreachable",
        provenance: PROVENANCE,
        surface: { id: "vanta", what: "the HRS-52 page" },
        why: "no browser reached DCH-108",
      },
    });
    expect(prose.map((entry) => entry.text)).toEqual([
      "nothing was out of reach",
      "the HRS-52 page",
      "no browser reached DCH-108",
    ]);
  });

  it("reports both halves of a substitutedForReal entry", () => {
    const prose = groundingProse({
      grounding: {
        evidence: evidence({ substitutedForReal: [{ real: "the HRS-52 panel", why: "no capture verb" }] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    expect(prose.map((entry) => ({ path: entry.path, text: entry.text }))).toEqual([
      { path: ["grounding", "evidence", "substitutedForReal", 0, "real"], text: "the HRS-52 panel" },
      { path: ["grounding", "evidence", "substitutedForReal", 0, "why"], text: "no capture verb" },
      { path: ["grounding", "evidence", "couldNotSee", "reason"], text: "nothing was out of reach" },
      { path: ["grounding", "reason"], text: "judgement alone" },
    ]);
  });
});

describe("groundingProse — which remedy a field earns", () => {
  it("tells an evidence line to fill its own url, and a blind spot to move the reference", () => {
    const prose = groundingProse({
      grounding: {
        evidence: evidence({ blindSpots: ["no shot of GOV-109"], read: [{ label: "the BCD-69 control" }] }),
        kind: "conversation",
        provenance: PROVENANCE,
        reason: "judgement alone",
      },
    });
    const byPath = new Map(prose.map((entry) => [entry.path.join("."), entry.remedy]));
    expect(byPath.get("grounding.evidence.read.0.label")).toContain("carries its own `url` field");
    expect(byPath.get("grounding.evidence.couldNotSee.blindSpots.0")).toContain("nowhere to put a link");
  });
});
