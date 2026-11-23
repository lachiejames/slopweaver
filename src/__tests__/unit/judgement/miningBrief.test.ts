/**
 * Pure mining-brief/answer logic: building a brief from bounded source samples, and validating a drafted
 * profile against it — self-consistency (every example's hash matches its own text), held-out leakage (no
 * example may match a routing-eval case that was held out), and the act / ask / refuse balance contract.
 */
import { describe, expect, it } from "vitest";

import {
  acceptJudgementMiningAnswer,
  buildJudgementMiningBrief,
  JUDGEMENT_MINING_BRIEF_VERSION,
  JUDGEMENT_MINING_PROMPT_FINGERPRINT,
  type JudgementMiningBrief,
  type JudgementSourceSample,
} from "../../../judgement/miningBrief.js";
import { JUDGEMENT_SELECTION_CONTRACT } from "../../../judgement/sourceSelection.js";
import { sha256Text as hashOf } from "../../../lib/hash.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { balancedRouting, labelledExample } from "../../balancedRouting.js";

const FIXED_NOW = "2026-08-11T00:00:00.000Z";

/** A coverage measurement for a small fixture source. */
const COVERAGE = {
  budgetSkippedFiles: 0,
  candidateChars: 17,
  candidateFiles: 1,
  contract: JUDGEMENT_SELECTION_CONTRACT,
  selectedChars: 17,
  selectedFiles: 1,
  strata: [{ candidateFiles: 1, selectedFiles: 1, stratum: "." }],
  truncatedFiles: 0,
};

const RECEIPT = {
  candidateChars: 17,
  contentHash: `sha256:${"e".repeat(64)}`,
  relativePath: "note.md",
  selectedChars: 17,
  truncated: false,
};

const ONE_SOURCE: readonly JudgementSourceSample[] = [
  {
    contentHash: `sha256:${"a".repeat(64)}`,
    coverage: COVERAGE,
    fileCount: 1,
    label: "test-source",
    selected: [RECEIPT],
    text: "some bounded text",
  },
];

describe("buildJudgementMiningBrief", () => {
  it("refuses an empty source list", () => {
    const result = buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: [] });
    expect(unwrapErr(result).code).toBe("JUDGEMENT_MINING_NO_SOURCES");
  });

  it("builds a v2 brief pinning each source's coverage and receipts", () => {
    const brief = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: ONE_SOURCE }));
    expect(brief.version).toBe(JUDGEMENT_MINING_BRIEF_VERSION);
    expect(brief.promptFingerprint).toBe(JUDGEMENT_MINING_PROMPT_FINGERPRINT);
    expect(brief.sourceManifest).toEqual([
      {
        contentHash: ONE_SOURCE[0]!.contentHash,
        coverage: COVERAGE,
        fileCount: 1,
        label: "test-source",
        selected: [RECEIPT],
      },
    ]);
  });

  it("shows each source's coverage and the balance contract in the prompt", () => {
    const brief = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: ONE_SOURCE }));
    expect(brief.prompt.user).toContain(
      `  test-source: ${ONE_SOURCE[0]!.contentHash} — 1 of 1 file(s), 17 of 17 chars (0 excerpted, 0 left out for budget; ${JUDGEMENT_SELECTION_CONTRACT})`,
    );
    expect(brief.prompt.system).toContain("ROUTING IS BALANCED ACROSS THREE DECISIONS:");
    expect(brief.prompt.system).toContain("plainly when to act WITHOUT asking.");
    expect(brief.prompt.user).toContain('"expectedDecision": "act"');
  });

  it("computes the same manifest hash regardless of source order", () => {
    const second = { ...ONE_SOURCE[0]!, contentHash: `sha256:${"b".repeat(64)}`, label: "another-source" };
    const forward = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: [ONE_SOURCE[0]!, second] }));
    const reversed = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: [second, ONE_SOURCE[0]!] }));
    expect(forward.manifestHash).toBe(reversed.manifestHash);
  });

  it("computes the same manifest hash for two orders of rows tied on label and content hash", () => {
    const tied = { ...ONE_SOURCE[0]!, fileCount: ONE_SOURCE[0]!.fileCount + 1 };
    expect(tied.label).toBe(ONE_SOURCE[0]!.label);
    expect(tied.contentHash).toBe(ONE_SOURCE[0]!.contentHash);
    const forward = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: [ONE_SOURCE[0]!, tied] }));
    const reversed = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: [tied, ONE_SOURCE[0]!] }));
    const single = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: ONE_SOURCE }));
    expect(forward.manifestHash).toBe(reversed.manifestHash);
    expect(forward.manifestHash).not.toBe(single.manifestHash);
  });

  it("changes the manifest hash when only the coverage or only a receipt changes", () => {
    const base = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: ONE_SOURCE }));
    const moreCandidates = unwrap(
      buildJudgementMiningBrief({
        heldOutSourceHashes: [],
        sources: [{ ...ONE_SOURCE[0]!, coverage: { ...COVERAGE, candidateFiles: 2 } }],
      }),
    );
    const otherReceipt = unwrap(
      buildJudgementMiningBrief({
        heldOutSourceHashes: [],
        sources: [{ ...ONE_SOURCE[0]!, selected: [{ ...RECEIPT, relativePath: "other.md" }] }],
      }),
    );
    expect(new Set([base.manifestHash, moreCandidates.manifestHash, otherReceipt.manifestHash]).size).toBe(3);
  });

  it("refuses to hash a count of -0, which JSON would write as 0", () => {
    const built = buildJudgementMiningBrief({
      heldOutSourceHashes: [],
      sources: [{ ...ONE_SOURCE[0]!, coverage: { ...COVERAGE, truncatedFiles: -0 } }],
    });
    expect(JSON.stringify(-0)).toBe("0");
    expect(unwrapErr(built).code).toBe("JUDGEMENT_MINING_MANIFEST_INVALID");
    expect(unwrapErr(built).message).toContain("coverage.truncatedFiles: a count is never negative zero");
  });

  it.each([
    ["Infinity", JSON.parse("1e400") as number],
    ["-Infinity", JSON.parse("-1e400") as number],
    ["NaN", Number.NaN],
    ['the string "-0"', JSON.parse('"-0"') as number],
  ])("refuses to hash a fileCount of %s, which no scan writes", (_name, fileCount) => {
    const built = buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: [{ ...ONE_SOURCE[0]!, fileCount }] });
    expect(unwrapErr(built).code).toBe("JUDGEMENT_MINING_MANIFEST_INVALID");
    expect(unwrapErr(built).message).toContain("0.fileCount: ");
  });

  it("refuses an answer against a brief whose manifest holds a value no scan writes, before comparing hashes", () => {
    const brief = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: ONE_SOURCE }));
    const edited = { ...brief, sourceManifest: [{ ...brief.sourceManifest[0]!, fileCount: Number.NaN }] };
    const accepted = acceptJudgementMiningAnswer({
      answer: {},
      brief: edited,
      nowIso: () => "2026-11-06T00:00:00.000Z",
    });
    expect(unwrapErr(accepted).code).toBe("JUDGEMENT_MINING_MANIFEST_INVALID");
  });

  it("carries the held-out hashes through unchanged", () => {
    const heldOut = [`sha256:${"c".repeat(64)}`];
    const brief = unwrap(buildJudgementMiningBrief({ heldOutSourceHashes: heldOut, sources: ONE_SOURCE }));
    expect(brief.heldOutSourceHashes).toEqual(heldOut);
  });
});

describe("acceptJudgementMiningAnswer", () => {
  const brief: JudgementMiningBrief = unwrap(
    buildJudgementMiningBrief({ heldOutSourceHashes: [], sources: ONE_SOURCE }),
  );

  const voiceText = "terse, outcome-first";
  const validAnswer = {
    routing: balancedRouting(),
    voice: { examples: [{ sourceHash: hashOf({ text: voiceText }), text: voiceText }], principles: [] },
  };

  /** Accept `routing` in place of the valid answer's routing section. */
  const acceptRouting = ({ routing }: { routing: unknown }): ReturnType<typeof acceptJudgementMiningAnswer> =>
    acceptJudgementMiningAnswer({ answer: { ...validAnswer, routing }, brief, nowIso: () => FIXED_NOW });

  it("accepts a balanced, self-consistent answer and fills in provenance", () => {
    const profile = unwrap(acceptJudgementMiningAnswer({ answer: validAnswer, brief, nowIso: () => FIXED_NOW }));
    expect(profile.provenance).toEqual({ minedAt: FIXED_NOW, sourceManifestHash: brief.manifestHash });
    expect(profile.voice).toEqual(validAnswer.voice);
    expect(profile.routing).toEqual(validAnswer.routing);
  });

  it("refuses a brief with a stale prompt fingerprint", () => {
    const staleBrief: JudgementMiningBrief = { ...brief, promptFingerprint: "judgement-mining-v1" };
    const result = acceptJudgementMiningAnswer({ answer: validAnswer, brief: staleBrief, nowIso: () => FIXED_NOW });
    expect(unwrapErr(result).code).toBe("JUDGEMENT_MINING_STALE_FINGERPRINT");
  });

  it("refuses a manifest whose coverage was edited after the hash was computed", () => {
    const tamperedBrief: JudgementMiningBrief = {
      ...brief,
      sourceManifest: [{ ...brief.sourceManifest[0]!, coverage: { ...COVERAGE, candidateFiles: 99 } }],
    };
    const result = acceptJudgementMiningAnswer({ answer: validAnswer, brief: tamperedBrief, nowIso: () => FIXED_NOW });
    expect(unwrapErr(result).code).toBe("JUDGEMENT_MINING_MANIFEST_TAMPERED");
  });

  it("refuses an answer missing the voice/routing sections", () => {
    const result = acceptJudgementMiningAnswer({ answer: { routing: {} }, brief, nowIso: () => FIXED_NOW });
    expect(unwrapErr(result).code).toBe("JUDGEMENT_MINING_ANSWER_SHAPE_INVALID");
  });

  it("refuses an example whose sourceHash does not match its own text", () => {
    const tampered = {
      ...validAnswer,
      voice: { examples: [{ sourceHash: hashOf({ text: "different text" }), text: voiceText }], principles: [] },
    };
    const result = acceptJudgementMiningAnswer({ answer: tampered, brief, nowIso: () => FIXED_NOW });
    expect(unwrapErr(result).message).toContain("does not match");
  });

  it("refuses an example matching a held-out routing-eval case", () => {
    const briefWithHeldOut: JudgementMiningBrief = { ...brief, heldOutSourceHashes: [hashOf({ text: voiceText })] };
    const result = acceptJudgementMiningAnswer({
      answer: validAnswer,
      brief: briefWithHeldOut,
      nowIso: () => FIXED_NOW,
    });
    expect(unwrapErr(result).message).toContain("held-out");
  });

  it("checks a counterexample's nested example the same way", () => {
    const routing = balancedRouting();
    routing.counterexamples[0]!.example = { ...routing.counterexamples[0]!.example, sourceHash: hashOf({ text: "x" }) };
    expect(unwrapErr(acceptRouting({ routing }))).toEqual({
      code: "JUDGEMENT_MINING_INCONSISTENT_EXAMPLES",
      count: 1,
      message: "1 example(s) have a sourceHash that does not match their own text",
    });
  });

  it("refuses the ask/refuse-only profile this contract exists for, naming every shortfall", () => {
    const routing = balancedRouting();
    const skewed = {
      counterexamples: routing.counterexamples.filter((entry) => entry.expectedDecision !== "act"),
      examples: routing.examples.filter((entry) => entry.decision !== "act"),
      principles: routing.principles.filter((entry) => entry.decision !== "act"),
    };
    const error = unwrapErr(acceptRouting({ routing: skewed }));
    expect(error.code).toBe("JUDGEMENT_MINING_ROUTING_UNBALANCED");
    expect(error).toEqual(
      expect.objectContaining({
        problems: [
          'routing principles hold 0 "act", at least 1 needed',
          'routing examples hold 0 "act", at least 2 needed',
          'routing counterexamples hold 0 "ask", at least 1 needed',
          'routing counterexamples hold 0 "refuse", at least 1 needed',
          "no routing counterexample shows an ask or refusal that should have been an act",
        ],
      }),
    );
  });

  it("refuses bare-string principles and unlabelled examples on a new mining pass", () => {
    const routing = balancedRouting();
    const unlabelled = {
      ...routing,
      examples: [...routing.examples, { sourceHash: hashOf({ text: "no label" }), text: "no label" }],
      principles: [...routing.principles, "a bare principle"],
    };
    expect(unwrapErr(acceptRouting({ routing: unlabelled }))).toEqual(
      expect.objectContaining({
        problems: ["1 routing principles miss a decision", "1 routing examples miss a decision"],
      }),
    );
  });

  it("refuses a counterexample with no expectedDecision", () => {
    const routing = balancedRouting();
    const { expectedDecision: _dropped, ...withoutExpected } = routing.counterexamples[0]!;
    const missing = { ...routing, counterexamples: [...routing.counterexamples, withoutExpected] };
    expect(unwrapErr(acceptRouting({ routing: missing })).message).toContain(
      "1 routing counterexamples miss a decision",
    );
  });

  it("accepts a 2:1 example ratio and refuses anything past it", () => {
    const routing = balancedRouting();
    const atRatio = {
      ...routing,
      examples: [
        ...routing.examples,
        labelledExample({ decision: "ask", text: "ask three" }),
        labelledExample({ decision: "ask", text: "ask four" }),
      ],
    };
    const pastRatio = {
      ...atRatio,
      examples: [...atRatio.examples, labelledExample({ decision: "ask", text: "ask five" })],
    };
    expect(acceptRouting({ routing: atRatio }).isOk()).toBe(true);
    expect(unwrapErr(acceptRouting({ routing: pastRatio })).message).toContain(
      "the largest decision holds 5, more than 2x the smallest (2)",
    );
  });

  it("refuses a counterexample whose wrong and right decision are the same", () => {
    const routing = balancedRouting();
    const contradictory = {
      ...routing,
      counterexamples: [
        ...routing.counterexamples,
        {
          example: labelledExample({ decision: "ask", text: "ask was right?" }),
          expectedDecision: "ask",
          whyRejected: "it was not wrong",
        },
      ],
    };
    expect(unwrapErr(acceptRouting({ routing: contradictory })).message).toContain(
      "1 routing counterexamples name the same wrong and right decision",
    );
  });

  it("cannot be tricked by nowIso mutating a nested example in place after validation (adversarial R1 finding)", () => {
    const heldOutText = "held-out case";
    const heldOutHash = hashOf({ text: heldOutText });
    const briefWithHeldOut: JudgementMiningBrief = { ...brief, heldOutSourceHashes: [heldOutHash] };
    const mutableAnswer = { ...validAnswer, routing: balancedRouting() };
    const safeExample = mutableAnswer.routing.counterexamples[0]!.example;
    const result = acceptJudgementMiningAnswer({
      answer: mutableAnswer,
      brief: briefWithHeldOut,
      // A malicious/buggy clock that mutates the SAME nested object the answer already validated, timed to
      // run between the held-out check and the final profile assembly — exactly the gap a reference capture
      // alone would not close.
      nowIso: () => {
        mutableAnswer.routing.counterexamples[0]!.example = {
          decision: "ask",
          sourceHash: heldOutHash,
          text: heldOutText,
        };
        return FIXED_NOW;
      },
    });
    expect(unwrap(result).routing.counterexamples[0]!.example).toEqual(safeExample);
  });
});
