/**
 * The brief a session reads BEFORE it drafts a C3 pull-request description.
 *
 * It prints with both creation examples and with `pr update --pull`, the two surfaces a composer reads before
 * drafting or recutting. Most of it is ADVISORY and says so: which fact leads is a judgement no gate computes. The
 * attribution rule is the exception, and the brief says which half of it a deterministic scan refuses and which half
 * the fresh description review judges.
 *
 * Pure and static on purpose. The example verbs promise no filesystem read, so this holds no word of the operator's
 * own voice: it names the rules this repository already owns and points at `slack voice-rules` for the rest.
 */

/** The repository doc carrying the long form of this brief, with worked examples. */
export const PR_VOICE_BRIEF_DOC = "skills/github/reference/composing-a-body.md";

/** The brief's first line. */
export const PR_VOICE_BRIEF_HEADER =
  "PR DESCRIPTION BRIEF — the C3 shape, the attribution rule, and the voice (advisory past the attribution rule).";

/** The brief's body, the same on every surface it prints on. */
const BRIEF_LINES: readonly string[] = [
  "SHAPE: three derived badges (risk, problem, proof), the explainer, Proof of the problem, Proof of the solution,",
  "Checks (a group nested under its label), Not checked and why, then a Details fold holding ONLY what re-runs it.",
  "EXPLAINER, at most 70 words: what broke, for whom, and what this changes. Plain sentences, the one number first.",
  "PROOF SLOTS: each a real screenshot under the one line it proves, or a public reason there is none: at most two",
  "sentences, why there is no screenshot, then where the proof is instead: the checks or a link, never a test.",
  "Proof of the problem is the product itself failing on screen; a vendor's doc can be linked as cause, not proof.",
  "REFUSED WORDS: a proof reason about a test in its common shapes, the review judging the rest (capture it with",
  "`slopweaver browser terminal-shot`), CI's work as a check, Slopweaver's own words in the title or explainer, code",
  'as plain text, bold that is not a figure, a bare commit id, and an explainer opening on "Anyone".',
  "ATTRIBUTION (refused by a scan where it can be computed, judged by the description review where it cannot):",
  "  - No first person and no first-person plural in prose, titles, commit messages or captions (code and quotes aside).",
  '  - The owner is "the owner", every time. A one-off act (a sign-in, a live run, a screenshot) names "the owner"',
  '    or "an agent"; anything anyone can re-run names no actor. Never a model, session, thread or transcript id.',
  '  - An opinion carries "probably", "likely" or "unverified". Nothing about the owner\'s circumstances.',
  '  - not: "The owner\'s overnight ask, transcript:<id>"   but: nothing — installation state is never published.',
  '  - not: "A work account. Only a personal one was to hand."   but: "A work account. Out of scope for this PR."',
  "Run `slopweaver slack voice-rules` for the voice: lead with what, never the how; one fact per sentence; no riddles.",
  `Worked examples: ${PR_VOICE_BRIEF_DOC}`,
];

/**
 * The lines a composer reads before drafting or recutting a body, in order.
 *
 * @param currentExplainer the pulled body's explainer as authoring markdown when recutting, so the composer re-reads
 *   the paragraph a reviewer meets first; absent when drafting from an example
 * @returns the lines to print
 */
export function prVoiceBriefLines({ currentExplainer }: { currentExplainer?: string | undefined }): readonly string[] {
  const lines = [PR_VOICE_BRIEF_HEADER, ...BRIEF_LINES];
  if (currentExplainer === undefined) {
    return lines;
  }
  return [...lines, `The explainer a reviewer meets first on this body today: "${currentExplainer}"`];
}
