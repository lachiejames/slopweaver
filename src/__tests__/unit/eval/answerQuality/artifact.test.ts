import { describe, expect, it } from "vitest";
import {
  buildPerCaseArtifact,
  PROPERTY_FAMILIES,
  renderPerCaseArtifact,
} from "../../../../eval/answerQuality/artifact.js";
import type { AnswerQualityCase } from "../../../../eval/answerQuality/caseSchema.js";
import { runSelftest } from "../../../../eval/answerQuality/selftest.js";

/**
 * A case whose every prose field carries a sentence that must never reach a published artifact.
 *
 * The sensitive-looking phrases are the FALSIFIABLE half of the redaction test: an assertion that the artifact
 * does not contain them is evidence only because this input does contain them, and the test asserts both
 * halves rather than only the absence.
 */
const CLINICAL_CASE: AnswerQualityCase = {
  attributions: [
    {
      id: "a1",
      label: "credits the referring staff member's own note rather than asserting it",
      requires: [["the referral note"]],
      source: "the referring staff member's note",
    },
  ],
  caveats: [
    { id: "v1", label: "does not claim the customer's second scan was reviewed", requires: [["not been reviewed"]] },
  ],
  claims: [{ id: "c1", label: "the customer's result was flagged abnormal", requires: [["flagged abnormal"]] }],
  goldenText:
    "The result was flagged abnormal on intake. The referral note says the same thing. The second scan has not been reviewed.",
  id: "case-01",
  inventedCertainty: ["this rules out the differential entirely"],
  paraphrase:
    "On arrival it came back flagged abnormal, and the referral note agrees. Nothing about the second scan has not been reviewed yet by anyone.",
};

/**
 * The counterexample that rules a shape guard out as the redaction.
 *
 * It is lowercase, hyphen-joined and well under any plausible length cap, so every shape check calls it
 * synthetic — while it names the sensitive fact its own caveat tests. Ids get named after what they test,
 * which is exactly why no shape check can be the redaction.
 */
const GOLDEN_DERIVED_ID = "no-second-scan-was-reviewed";

const PROVENANCE = {
  caseCount: 1,
  casesBytes: 1234,
  casesSha256: "0f".repeat(32),
} as const;

/**
 * Phrases the self-test's own LOCAL output really prints for {@link CLINICAL_CASE}, and a published artifact
 * must not.
 *
 * Every one of these reaches `property` or `detail` through an expectation label or the invented-certainty
 * phrase, which is what makes asserting their absence from the artifact evidence rather than a tautology.
 */
const FORBIDDEN_FROM_OUTCOMES: readonly string[] = [
  "customer",
  "second scan",
  "referring staff member",
  "staff member",
  "rules out the differential",
];

/** Distinctive fragments of the golden itself, which no path is supposed to carry into an artifact at all. */
const FORBIDDEN_FROM_GOLDEN: readonly string[] = ["flagged abnormal", "referral note", "on intake"];

describe("PROPERTY_FAMILIES", () => {
  it("names every family the self-test actually produces, and no other", () => {
    expect(PROPERTY_FAMILIES.length).toBeGreaterThan(0);
    const produced = new Set(runSelftest({ cases: [CLINICAL_CASE] }).map((outcome) => outcome.redacted.family));
    expect([...produced].toSorted()).toEqual([...PROPERTY_FAMILIES].toSorted());
  });
});

describe("buildPerCaseArtifact", () => {
  it("tallies the run and carries the provenance through unchanged", () => {
    const outcomes = runSelftest({ cases: [CLINICAL_CASE] });
    const { artifact } = buildPerCaseArtifact({ outcomes, provenance: PROVENANCE });
    expect(artifact.outcomes.length).toBe(outcomes.length);
    expect(artifact.passed).toBe(outcomes.length);
    expect(artifact.failed).toBe(0);
    expect(artifact.skipped).toBe(0);
    expect(artifact.provenance).toEqual(PROVENANCE);
  });

  it("counts a skipped property as skipped rather than folding it into passed", () => {
    const { paraphrase: _unused, ...withoutParaphrase } = CLINICAL_CASE;
    const { artifact } = buildPerCaseArtifact({
      outcomes: runSelftest({ cases: [withoutParaphrase] }),
      provenance: PROVENANCE,
    });
    expect(artifact.skipped).toBe(2);
    expect(artifact.failed).toBe(0);
  });

  it("mints a label for every id it was given, and reports what each one stands for", () => {
    const { artifact, mappings } = buildPerCaseArtifact({
      outcomes: runSelftest({ cases: [CLINICAL_CASE] }),
      provenance: PROVENANCE,
    });
    expect(mappings).toEqual([
      { of: "case", published: "case-1", source: "case-01" },
      { of: "expectation", published: "case-1/e1", source: "v1" },
      { of: "expectation", published: "case-1/e2", source: "a1" },
      { of: "expectation", published: "case-1/e3", source: "k1" },
    ]);
    expect(new Set(artifact.outcomes.map((outcome) => outcome.caseLabel))).toEqual(new Set(["case-1"]));
  });

  it("scopes an expectation label to its case, so the same id in two cases never collides", () => {
    const second: AnswerQualityCase = { ...CLINICAL_CASE, id: "case-02" };
    const { artifact, mappings } = buildPerCaseArtifact({
      outcomes: runSelftest({ cases: [CLINICAL_CASE, second] }),
      provenance: PROVENANCE,
    });
    expect(mappings.filter((mapping) => mapping.of === "case")).toEqual([
      { of: "case", published: "case-1", source: "case-01" },
      { of: "case", published: "case-2", source: "case-02" },
    ]);
    expect(mappings.filter((mapping) => mapping.source === "v1")).toEqual([
      { of: "expectation", published: "case-1/e1", source: "v1" },
      { of: "expectation", published: "case-2/e1", source: "v1" },
    ]);
    expect(new Set(artifact.outcomes.map((outcome) => outcome.caseLabel))).toEqual(new Set(["case-1", "case-2"]));
  });
});

describe("renderPerCaseArtifact", () => {
  it("carries not one word of the golden it graded — and the input carries every one of them", () => {
    const outcomes = runSelftest({ cases: [CLINICAL_CASE] });
    const { artifact } = buildPerCaseArtifact({ outcomes, provenance: PROVENANCE });
    const rendered = renderPerCaseArtifact({ artifact }).join("\n");
    const readable = [...outcomes.map((outcome) => outcome.property), ...outcomes.map((outcome) => outcome.detail)]
      .join("\n")
      .toLowerCase();
    const lowered = rendered.toLowerCase();
    // The input half: every forbidden phrase really is in what the run produced for a local reader.
    expect(FORBIDDEN_FROM_OUTCOMES.length).toBeGreaterThan(0);
    expect(FORBIDDEN_FROM_OUTCOMES.filter((phrase) => !readable.includes(phrase))).toEqual([]);
    // The output half: none of them survives into the published bytes.
    expect(FORBIDDEN_FROM_OUTCOMES.filter((phrase) => lowered.includes(phrase))).toEqual([]);
    // And the golden's own sentences, which the run never printed, are absent too.
    const golden = CLINICAL_CASE.goldenText.toLowerCase();
    expect(FORBIDDEN_FROM_GOLDEN.filter((phrase) => !golden.includes(phrase))).toEqual([]);
    expect(FORBIDDEN_FROM_GOLDEN.filter((phrase) => lowered.includes(phrase))).toEqual([]);
  });

  it("publishes a minted label instead of a golden-derived id that every shape check calls synthetic", () => {
    const named: AnswerQualityCase = {
      ...CLINICAL_CASE,
      caveats: [{ ...CLINICAL_CASE.caveats[0]!, id: GOLDEN_DERIVED_ID }],
    };
    const outcomes = runSelftest({ cases: [named] });
    const { artifact, mappings } = buildPerCaseArtifact({ outcomes, provenance: PROVENANCE });
    const rendered = renderPerCaseArtifact({ artifact }).join("\n");
    // The input half: the run's own property names really do carry that id.
    expect(outcomes.filter((outcome) => outcome.property.includes(GOLDEN_DERIVED_ID)).length).toBe(1);
    // The output half: it reaches neither the table nor the prose around it.
    expect(rendered).not.toContain(GOLDEN_DERIVED_ID);
    expect(rendered).toContain("| degrades-down · caveat-dropped · e1 |");
    // And the operator can still map the row back, off a mapping that stays out of the file.
    expect(mappings).toContainEqual({ of: "expectation", published: "case-1/e1", source: GOLDEN_DERIVED_ID });
  });

  it("renders one row per outcome, with the golden's score beside each degraded variant's", () => {
    const outcomes = runSelftest({ cases: [CLINICAL_CASE] });
    const { artifact } = buildPerCaseArtifact({ outcomes, provenance: PROVENANCE });
    const lines = renderPerCaseArtifact({ artifact });
    const rows = lines.filter((line) => line.startsWith("| case-1 | "));
    expect(rows.length).toBe(outcomes.length);
    expect(rows).toContain("| case-1 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |");
    expect(rows).toContain("| case-1 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.750 | 1.000 |");
    expect(rows).toContain("| case-1 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.414 | 0.500 |");
    expect(rows).toContain("| case-1 | anchors-are-droppable | PASS | — | — | — |");
  });

  it("states in its own words that CI cannot re-derive it, and prints the digest", () => {
    const { artifact } = buildPerCaseArtifact({
      outcomes: runSelftest({ cases: [CLINICAL_CASE] }),
      provenance: PROVENANCE,
    });
    const body = renderPerCaseArtifact({ artifact }).join("\n");
    expect(body).toContain("This is the evidence behind the scorer's gold claim: the ordering properties that prove");
    expect(body).toContain("**Nothing in CI can re-derive this table**");
    expect(body).toContain(PROVENANCE.casesSha256);
    expect(body).toContain("**7 passed, 0 failed, 0 skipped**");
  });

  it("states its provenance as the input, the case count and the outcomes, and stamps no instant", () => {
    const { artifact } = buildPerCaseArtifact({
      outcomes: runSelftest({ cases: [CLINICAL_CASE] }),
      provenance: PROVENANCE,
    });
    const provenance = renderPerCaseArtifact({ artifact }).filter((line) =>
      /^- (?:input|cases|generated|outcomes):/u.test(line),
    );
    expect(provenance).toEqual([
      `- input: the operator's own case file, sha256 \`${PROVENANCE.casesSha256}\`, 1234 bytes`,
      "- cases: 1",
      "- outcomes: **7 passed, 0 failed, 0 skipped**",
    ]);
  });
});
