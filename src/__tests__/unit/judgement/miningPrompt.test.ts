/** The mining prompt's exact words: what a session is told about coverage and about balanced routing. */
import { describe, expect, it } from "vitest";

import type { JudgementSourceManifestEntry, JudgementSourceSample } from "../../../judgement/miningBrief.js";
import { renderJudgementMiningPrompt } from "../../../judgement/miningPrompt.js";
import { JUDGEMENT_SELECTION_CONTRACT } from "../../../judgement/sourceSelection.js";

const HASH = `sha256:${"c".repeat(64)}`;
const COVERAGE = {
  budgetSkippedFiles: 31,
  candidateChars: 4000,
  candidateFiles: 40,
  contract: JUDGEMENT_SELECTION_CONTRACT,
  selectedChars: 916,
  selectedFiles: 9,
  strata: [{ candidateFiles: 40, selectedFiles: 9, stratum: "dated" }],
  truncatedFiles: 0,
};
const SOURCE: JudgementSourceSample = {
  contentHash: HASH,
  coverage: COVERAGE,
  fileCount: 40,
  label: "notes",
  selected: [],
  text: "sample body",
};
const ENTRY: JudgementSourceManifestEntry = {
  contentHash: HASH,
  coverage: COVERAGE,
  fileCount: 40,
  label: "notes",
  selected: [],
};

describe("renderJudgementMiningPrompt", () => {
  const prompt = renderJudgementMiningPrompt({
    heldOutSourceHashes: [],
    manifest: [ENTRY],
    manifestHash: HASH,
    sources: [SOURCE],
  });

  it("shows each source's coverage against what its tree held, so a skewed sample is visible", () => {
    expect(prompt.user.split("\n").slice(0, 2)).toEqual([
      `MANIFEST (hash ${HASH}) — what of each source reached this brief:`,
      `  notes: ${HASH} — 9 of 40 file(s), 916 of 4000 chars (0 excerpted, 31 left out for budget; ${JUDGEMENT_SELECTION_CONTRACT})`,
    ]);
    expect(prompt.user).toContain(`--- SOURCE: notes (${HASH}, 40 file(s)) ---\nsample body`);
  });

  it("states when to act without asking, and the counterexample directions the gate checks", () => {
    expect(prompt.system).toContain("ROUTING IS BALANCED ACROSS THREE DECISIONS:");
    expect(prompt.system).toContain("plainly when to act WITHOUT asking.");
    expect(prompt.system).toContain("an ask or refusal that should have been an act");
    expect(prompt.system).toContain("Never quote or reference any of these held-out hashes: (none).");
  });

  it("gives the labelled answer skeleton verbatim", () => {
    expect(prompt.user).toContain('    "principles": [{ "decision": "act", "text": "…" }],');
    expect(prompt.user).toContain('      { "expectedDecision": "act", "whyRejected": "…",');
  });
});
