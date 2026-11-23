import { describe, expect, it } from "vitest";
import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import { answerFormFingerprint, artifactFingerprint, duplicateKey } from "../../../../outbound/slack/fingerprint.js";

function artifact(): UpdateArtifact {
  return {
    citations: [],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  };
}

function answer(): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      capability: { command: ["slopweaver", "fleet", "status"], id: "fleet.status", what: "list open PRs" },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else to check" },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
      result: "3 open PRs",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "You have 3 open PRs.",
    measurements: [],
  };
}

describe("artifactFingerprint", () => {
  it("is stable across repeated calls on the same content", () => {
    expect(artifactFingerprint({ artifact: artifact() })).toBe(artifactFingerprint({ artifact: artifact() }));
  });

  it("ignores key ORDER, so a re-serialised artifact keeps its identity", () => {
    // Built by INSERTION rather than as literals: the formatter sorts object literals, which would
    // silently make both sides identical and leave this test asserting nothing.
    const forward: Record<string, unknown> = {};
    for (const key of ["kind", "tldr", "detail", "citations", "media"] as const) {
      forward[key] = artifact()[key];
    }
    const reversed: Record<string, unknown> = {};
    for (const key of ["media", "citations", "detail", "tldr", "kind"] as const) {
      reversed[key] = artifact()[key];
    }

    expect(Object.keys(forward)).not.toEqual(Object.keys(reversed));
    expect(artifactFingerprint({ artifact: forward as unknown as UpdateArtifact })).toBe(
      artifactFingerprint({ artifact: reversed as unknown as UpdateArtifact }),
    );
  });

  it("changes when the TL;DR changes", () => {
    const changed: UpdateArtifact = { ...artifact(), tldr: "A different lead." };

    expect(artifactFingerprint({ artifact: changed })).not.toBe(artifactFingerprint({ artifact: artifact() }));
  });

  it("changes when only the detail changes", () => {
    const changed: UpdateArtifact = {
      ...artifact(),
      detail: [{ runs: [{ text: "Different detail.", type: "text" }], type: "paragraph" }],
    };

    expect(artifactFingerprint({ artifact: changed })).not.toBe(artifactFingerprint({ artifact: artifact() }));
  });

  it("changes when a run gains emphasis, because the rendered card differs", () => {
    const changed: UpdateArtifact = {
      ...artifact(),
      detail: [{ runs: [{ bold: true, text: "The detail.", type: "text" }], type: "paragraph" }],
    };

    expect(artifactFingerprint({ artifact: changed })).not.toBe(artifactFingerprint({ artifact: artifact() }));
  });
});

describe("answerFormFingerprint", () => {
  it("is stable across repeated calls on the same content", () => {
    expect(answerFormFingerprint({ answer: answer() })).toBe(answerFormFingerprint({ answer: answer() }));
  });

  it("changes when the lead changes", () => {
    const changed: AnswerFormAnswer = { ...answer(), lead: "You have 4 open PRs." };

    expect(answerFormFingerprint({ answer: changed })).not.toBe(answerFormFingerprint({ answer: answer() }));
  });

  it("changes when the grounding differs, even with the same lead", () => {
    const changed: AnswerFormAnswer = {
      ...answer(),
      grounding: {
        capability: { command: ["slopweaver", "fleet", "status"], id: "fleet.status", what: "list open PRs" },
        evidence: {
          consultedEmpty: [],
          couldNotSee: { blindSpots: [], reason: "nothing else to check" },
          premiseChecks: [],
          read: [],
          substitutedForReal: [],
        },
        kind: "verb",
        provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
        result: "4 open PRs",
      },
    };

    expect(answerFormFingerprint({ answer: changed })).not.toBe(answerFormFingerprint({ answer: answer() }));
  });
});

describe("duplicateKey", () => {
  it("is stable for the same identity, target and content", () => {
    const args = { actor: "bot", artifact: artifact(), channel: "C1" };

    expect(duplicateKey(args)).toBe(duplicateKey(args));
  });

  it("DIFFERS by channel — the same words elsewhere is not a duplicate", () => {
    expect(duplicateKey({ actor: "bot", artifact: artifact(), channel: "C1" })).not.toBe(
      duplicateKey({ actor: "bot", artifact: artifact(), channel: "C2" }),
    );
  });

  it("DIFFERS by actor — the same words under another name is not a duplicate", () => {
    expect(duplicateKey({ actor: "bot", artifact: artifact(), channel: "C1" })).not.toBe(
      duplicateKey({ actor: "me", artifact: artifact(), channel: "C1" }),
    );
  });

  it("DIFFERS between a channel post and a thread reply", () => {
    expect(duplicateKey({ actor: "bot", artifact: artifact(), channel: "C1" })).not.toBe(
      duplicateKey({ actor: "bot", artifact: artifact(), channel: "C1", threadTs: "1.2" }),
    );
  });

  it("treats an absent threadTs and an explicit undefined identically", () => {
    expect(duplicateKey({ actor: "bot", artifact: artifact(), channel: "C1" })).toBe(
      duplicateKey({ actor: "bot", artifact: artifact(), channel: "C1", threadTs: undefined }),
    );
  });
});
