/**
 * The judgement-mining PROMPT — the exact text `route profile-brief` shows a visible session. Kept apart from
 * `./miningBrief.ts` (which pins and validates) so the words a session reads sit in one place, beside the
 * balance contract they promise (`./miningBalance.ts`): a requirement stated here that the gate does not
 * check would be advice, and a check the prompt never states would refuse a session for a rule it was not told.
 *
 * Changing what this text MEANS bumps `JUDGEMENT_MINING_PROMPT_FINGERPRINT`.
 */
import type { JudgementSourceManifestEntry, JudgementSourceSample } from "./miningBrief.js";

/** What the three routing decisions mean, and the requirement the balance gate enforces, in its order. */
const ROUTING_BALANCE_INSTRUCTIONS: readonly string[] = [
  "ROUTING IS BALANCED ACROSS THREE DECISIONS:",
  '  "act"    — just do it, then say what was done. The owner already approved this kind of thing, or it is',
  "             obviously what the owner would want.",
  '  "ask"    — put the question to the owner first, because the choice is genuinely theirs.',
  '  "refuse" — decline, and say why, because it crosses a line the owner has drawn.',
  "The sample below is bounded and may lean one way: corrections and rulings over-represent the times the owner said",
  "no. Mine what the owner does, delegates and approves of as carefully as what they forbid.",
  'Every routing principle is an object {"decision", "text"}; at least one per decision — so one states',
  "plainly when to act WITHOUT asking.",
  'Every routing example carries "decision" (the RIGHT call it shows): at least 2 per decision, and no',
  "decision more than twice as frequent as the least frequent one.",
  'Every routing counterexample carries "expectedDecision" (the right call) and its example carries "decision"',
  "(the WRONG call that was made or proposed); the two differ. At least one counterexample per wrong decision,",
  "and both directions: an ask or refusal that should have been an act, and an act that should have been an",
  "ask or refusal. route profile-answer refuses an unbalanced or unlabelled routing section by name.",
];

/** The exact answer shape, so a session copies a skeleton instead of reconstructing it from a type name. */
const ANSWER_SKELETON: readonly string[] = [
  "{",
  '  "voice": { "principles": ["…"], "examples": [{ "text": "…", "sourceHash": "sha256:…" }] },',
  '  "routing": {',
  '    "principles": [{ "decision": "act", "text": "…" }],',
  '    "examples": [{ "decision": "act", "text": "…", "sourceHash": "sha256:…" }],',
  '    "counterexamples": [',
  '      { "expectedDecision": "act", "whyRejected": "…",',
  '        "example": { "decision": "ask", "text": "…", "sourceHash": "sha256:…" } }',
  "    ]",
  "  }",
  "}",
];

/** One manifest row as the prompt shows it: what reached the sample against what the tree held. */
function manifestLine({ entry }: { entry: JudgementSourceManifestEntry }): string {
  const { coverage } = entry;
  return (
    `  ${entry.label}: ${entry.contentHash} — ${String(coverage.selectedFiles)} of ${String(coverage.candidateFiles)} file(s), ` +
    `${String(coverage.selectedChars)} of ${String(coverage.candidateChars)} chars ` +
    `(${String(coverage.truncatedFiles)} excerpted, ${String(coverage.budgetSkippedFiles)} left out for budget; ${coverage.contract})`
  );
}

/**
 * Render the mining prompt a visible session is shown.
 *
 * @param sources every scanned sample, in the order the prompt shows them
 * @param manifest the pinned manifest rows, one per sample
 * @param manifestHash the manifest's own hash, quoted so a session can name what it mined under
 * @param heldOutSourceHashes hashes of routing-eval case texts the drafted profile must not quote
 * @returns the system and user halves of the prompt
 */
export function renderJudgementMiningPrompt({
  sources,
  manifest,
  manifestHash,
  heldOutSourceHashes,
}: {
  sources: readonly JudgementSourceSample[];
  manifest: readonly JudgementSourceManifestEntry[];
  manifestHash: string;
  heldOutSourceHashes: readonly string[];
}): { system: string; user: string } {
  const heldOut = heldOutSourceHashes.join(", ");
  const sourceBlocks = sources
    .map(
      (source) =>
        `--- SOURCE: ${source.label} (${source.contentHash}, ${String(source.fileCount)} file(s)) ---\n${source.text}`,
    )
    .join("\n\n");
  return {
    system: [
      "You are mining a private judgement/voice profile from first-person material.",
      "Separate VOICE (how to write) from ROUTING (how to decide what to do with a message) — they are",
      "different mining targets. For routing, include counterexamples: a decision you would NOT make, and",
      "why, not just principles and positive examples.",
      ...ROUTING_BALANCE_INSTRUCTIONS,
      "Every example you output must carry `sourceHash`: the sha256 (as `sha256:<hex>`) of that example's",
      "OWN text field, computed over exactly the text you write — not the source file it came from.",
      `Never quote or reference any of these held-out hashes: ${heldOut === "" ? "(none)" : heldOut}.`,
    ].join("\n"),
    user: [
      `MANIFEST (hash ${manifestHash}) — what of each source reached this brief:`,
      manifest.map((entry) => manifestLine({ entry })).join("\n"),
      "",
      sourceBlocks,
      "",
      "WHEN YOU HAVE THE PROFILE — write JSON of exactly this shape to a file and validate it with",
      "`slopweaver route profile-answer --answer <file> --json`:",
      ...ANSWER_SKELETON,
    ].join("\n"),
  };
}
