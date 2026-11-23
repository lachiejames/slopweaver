/**
 * Typed failures for the judgement-mining brief/answer protocol ({@link ./miningBrief}). Modeled on
 * an earlier codebase's `<domain>/errors.ts` pattern (discriminated union + a factory object keyed by
 * variant), re-skinned rather than ported verbatim; see `AGENTS.md`'s "Porting from private sources".
 */

import type { RoutingDecisionBalance } from "./miningBalance.js";

/** No source sample was supplied — there is nothing to mine a brief from. */
export interface JudgementMiningNoSourcesError {
  readonly code: "JUDGEMENT_MINING_NO_SOURCES";
  readonly message: string;
}

/** The brief's prompt fingerprint no longer matches the mining contract this build runs under. */
export interface JudgementMiningStaleFingerprintError {
  readonly code: "JUDGEMENT_MINING_STALE_FINGERPRINT";
  readonly message: string;
}

/** The brief's own source manifest hash no longer matches its manifest — the brief was tampered with. */
export interface JudgementMiningManifestTamperedError {
  readonly code: "JUDGEMENT_MINING_MANIFEST_TAMPERED";
  readonly message: string;
}

/** A source manifest holds a value the scan never writes, so it cannot be hashed faithfully (`./manifestSchema.ts`). */
export interface JudgementMiningManifestInvalidError {
  readonly code: "JUDGEMENT_MINING_MANIFEST_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** The drafted answer is not a JSON object with `voice` and `routing` sections. */
export interface JudgementMiningAnswerShapeInvalidError {
  readonly code: "JUDGEMENT_MINING_ANSWER_SHAPE_INVALID";
  readonly message: string;
}

/** One or more examples carry a `sourceHash` that does not match their own `text`. */
export interface JudgementMiningInconsistentExamplesError {
  readonly code: "JUDGEMENT_MINING_INCONSISTENT_EXAMPLES";
  readonly message: string;
  readonly count: number;
}

/** One or more examples match a case the routing evaluation programme held out. */
export interface JudgementMiningHeldOutLeakError {
  readonly code: "JUDGEMENT_MINING_HELD_OUT_LEAK";
  readonly message: string;
  readonly count: number;
}

/** The drafted routing section is unlabelled or unbalanced across act / ask / refuse (`./miningBalance.ts`). */
export interface JudgementMiningRoutingUnbalancedError {
  readonly code: "JUDGEMENT_MINING_ROUTING_UNBALANCED";
  readonly message: string;
  readonly problems: readonly string[];
  readonly balance: RoutingDecisionBalance;
}

/** The accepted profile itself failed its own schema — wraps `parseJudgementProfile`'s generic issues. */
export interface JudgementMiningProfileInvalidError {
  readonly code: "JUDGEMENT_MINING_PROFILE_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Every way building or accepting a judgement-mining brief/answer can fail. */
export type JudgementMiningError =
  | JudgementMiningNoSourcesError
  | JudgementMiningStaleFingerprintError
  | JudgementMiningManifestTamperedError
  | JudgementMiningManifestInvalidError
  | JudgementMiningAnswerShapeInvalidError
  | JudgementMiningInconsistentExamplesError
  | JudgementMiningHeldOutLeakError
  | JudgementMiningProfileInvalidError
  | JudgementMiningRoutingUnbalancedError;

/** Factories for {@link JudgementMiningError} — the one place its message text is composed. */
export const JudgementMiningErrors = {
  /** @returns a {@link JudgementMiningAnswerShapeInvalidError} */
  answerShapeInvalid: (): JudgementMiningAnswerShapeInvalidError => ({
    code: "JUDGEMENT_MINING_ANSWER_SHAPE_INVALID",
    message: "the answer must be a JSON object with `voice` and `routing` sections",
  }),

  /**
   * Build a {@link JudgementMiningHeldOutLeakError}.
   *
   * @param count how many examples matched a held-out routing-eval case
   * @returns the typed error
   */
  heldOutLeak: ({ count }: { count: number }): JudgementMiningHeldOutLeakError => ({
    code: "JUDGEMENT_MINING_HELD_OUT_LEAK",
    count,
    message: `${String(count)} example(s) match a held-out routing-eval case — mining on the test set is refused`,
  }),

  /**
   * Build a {@link JudgementMiningInconsistentExamplesError}.
   *
   * @param count how many examples had a `sourceHash` that does not match their own text
   * @returns the typed error
   */
  inconsistentExamples: ({ count }: { count: number }): JudgementMiningInconsistentExamplesError => ({
    code: "JUDGEMENT_MINING_INCONSISTENT_EXAMPLES",
    count,
    message: `${String(count)} example(s) have a sourceHash that does not match their own text`,
  }),

  /**
   * Build a {@link JudgementMiningManifestInvalidError}.
   *
   * @param issues one line per schema violation, at its path in the manifest
   * @returns the typed error
   */
  manifestInvalid: ({ issues }: { issues: readonly string[] }): JudgementMiningManifestInvalidError => ({
    code: "JUDGEMENT_MINING_MANIFEST_INVALID",
    issues,
    message: `the source manifest holds a value the scan never writes, so it cannot be hashed: ${issues.join("; ")}`,
  }),

  /** @returns a {@link JudgementMiningManifestTamperedError} */
  manifestTampered: (): JudgementMiningManifestTamperedError => ({
    code: "JUDGEMENT_MINING_MANIFEST_TAMPERED",
    message: "the brief's source manifest hash does not match its own manifest — the brief was tampered with",
  }),
  /** @returns a {@link JudgementMiningNoSourcesError} */
  noSources: (): JudgementMiningNoSourcesError => ({
    code: "JUDGEMENT_MINING_NO_SOURCES",
    message: "at least one source sample is required to build a mining brief",
  }),

  /**
   * Build a {@link JudgementMiningProfileInvalidError} wrapping the profile schema's own issues.
   *
   * @param issues every schema violation message
   * @returns the typed error
   */
  profileInvalid: ({ issues }: { issues: readonly string[] }): JudgementMiningProfileInvalidError => ({
    code: "JUDGEMENT_MINING_PROFILE_INVALID",
    issues,
    message: issues.join("; "),
  }),

  /**
   * Build a {@link JudgementMiningRoutingUnbalancedError}.
   *
   * @param balance the measured decision mix the problems were read from
   * @param problems one sentence per shortfall against the balance contract
   * @returns the typed error
   */
  routingUnbalanced: ({
    balance,
    problems,
  }: {
    balance: RoutingDecisionBalance;
    problems: readonly string[];
  }): JudgementMiningRoutingUnbalancedError => ({
    balance,
    code: "JUDGEMENT_MINING_ROUTING_UNBALANCED",
    message: `the routing section is not balanced across act / ask / refuse: ${problems.join("; ")}`,
    problems,
  }),

  /** @returns a {@link JudgementMiningStaleFingerprintError} */
  staleFingerprint: (): JudgementMiningStaleFingerprintError => ({
    code: "JUDGEMENT_MINING_STALE_FINGERPRINT",
    message: "the brief's prompt fingerprint does not match the current mining contract — rebuild it",
  }),
} as const;
