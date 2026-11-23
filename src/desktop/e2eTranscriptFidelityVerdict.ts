/**
 * The `transcription-fidelity` paired verdict — pure: the six trials `e2eTranscriptFidelityReport.ts` judged, matched
 * into rounds and compared by the validity and stop rules
 * fixed BEFORE a call ran. One invalid member voids its whole round, and fewer than three valid pairs voids the
 * comparison: two pairs cannot show a direction repeat.
 */
import {
  type E2eGainProfile,
  type E2eMicCandidate,
  type E2eTranscriptFidelitySpec,
  TRANSCRIPT_FIDELITY_CORPUS,
} from "./e2eTranscriptFidelityCorpus.js";
import type {
  E2eTranscriptFidelityTrial,
  E2eTranscriptSurfaceReport,
  StratumCounts,
} from "./e2eTranscriptFidelityReport.js";

/** Every scored stratum, in the order a regression names them. */
const SCORED_STRATA = [
  "end-critical",
  "glossary",
  "short",
  "start-critical",
] as const satisfies readonly (keyof StratumCounts)[];

/** The comparison's outcome, predeclared. */
type E2eTranscriptFidelityDecision =
  "invalid" | "stop-control-near-perfect" | "inconclusive" | "candidate-improved" | "candidate-regressed";

/** One round's pair, by critical-error count. */
interface E2eTranscriptFidelityPair {
  readonly round: E2eTranscriptFidelitySpec["round"];
  readonly valid: boolean;
  readonly controlCritical: number | null;
  readonly candidateCritical: number | null;
}

/** Aggregates over the valid pairs, one side. */
interface E2eTranscriptFidelityTotals {
  readonly criticalErrors: number;
  readonly scoredLines: number;
  readonly startErrors: number;
  readonly endErrors: number;
  readonly byStratum: StratumCounts;
  readonly byGain: Readonly<Record<E2eGainProfile, number>>;
}

/** The paired comparison. */
export interface E2eTranscriptFidelityComparison {
  readonly decision: E2eTranscriptFidelityDecision;
  readonly why: string;
  readonly pairs: readonly E2eTranscriptFidelityPair[];
  readonly control: E2eTranscriptFidelityTotals | null;
  readonly candidate: E2eTranscriptFidelityTotals | null;
}

/** The six-call report. */
export interface E2eTranscriptFidelityReport {
  readonly schemaVersion: 1;
  readonly corpusVersion: typeof TRANSCRIPT_FIDELITY_CORPUS.version;
  readonly candidate: E2eMicCandidate;
  readonly trials: readonly E2eTranscriptFidelityTrial[];
  readonly comparison: E2eTranscriptFidelityComparison;
  readonly limitations: readonly string[];
}

/** What the v1 instrument cannot see, stated in every report. */
export const FIDELITY_LIMITATIONS: readonly string[] = [
  "The microphone is a synthetic voice (macOS say), not the owner's; a rate here is the pipeline's, not the owner's calls'.",
  "Only the final transcript is scored; the raw input_transcript fragments a relay carries are not captured.",
  "Talking over the voice is not tested: nothing on record witnesses that the voice was audible when a line began.",
  "Chromium's fake microphone has no room echo, so echo cancellation is held on and never compared.",
  "Six calls make a direction, not a significance: lines inside one call share one network and one session.",
];

/** Zeroed totals. */
function emptyTotals(): E2eTranscriptFidelityTotals {
  return {
    byGain: { ordinary: 0, quiet: 0 },
    byStratum: { "end-critical": 0, glossary: 0, short: 0, "start-critical": 0 },
    criticalErrors: 0,
    endErrors: 0,
    scoredLines: 0,
    startErrors: 0,
  };
}

/** Totals over a set of scored surfaces. */
function totalsOf({ surfaces }: { surfaces: readonly E2eTranscriptSurfaceReport[] }): E2eTranscriptFidelityTotals {
  return surfaces.reduce<E2eTranscriptFidelityTotals>(
    (total, one) => ({
      byGain: { ordinary: total.byGain.ordinary + one.byGain.ordinary, quiet: total.byGain.quiet + one.byGain.quiet },
      byStratum: {
        "end-critical": total.byStratum["end-critical"] + one.byStratum["end-critical"],
        glossary: total.byStratum.glossary + one.byStratum.glossary,
        short: total.byStratum.short + one.byStratum.short,
        "start-critical": total.byStratum["start-critical"] + one.byStratum["start-critical"],
      },
      criticalErrors: total.criticalErrors + one.criticalErrors,
      endErrors: total.endErrors + one.endErrors,
      scoredLines: total.scoredLines + one.scoredLines,
      startErrors: total.startErrors + one.startErrors,
    }),
    emptyTotals(),
  );
}

/** Every count on which the candidate is worse than control, named. */
function regressions({
  candidate,
  control,
}: {
  candidate: E2eTranscriptFidelityTotals;
  control: E2eTranscriptFidelityTotals;
}): readonly string[] {
  const named: readonly (readonly [string, number, number])[] = [
    ["critical errors", candidate.criticalErrors, control.criticalErrors],
    ["start errors", candidate.startErrors, control.startErrors],
    ["end errors", candidate.endErrors, control.endErrors],
    ...SCORED_STRATA.map(
      (stratum) => [`${stratum} critical errors`, candidate.byStratum[stratum], control.byStratum[stratum]] as const,
    ),
    ["ordinary-gain critical errors", candidate.byGain.ordinary, control.byGain.ordinary],
    ["quiet-gain critical errors", candidate.byGain.quiet, control.byGain.quiet],
  ];
  return named.filter(([, mine, theirs]) => mine > theirs).map(([what, mine, theirs]) => `${what} ${mine} > ${theirs}`);
}

/**
 * The paired comparison, by the predeclared rules.
 *
 * @param trials every call, in any order; pairs are matched by round
 * @returns the decision and what it rests on
 */
export function compareTranscriptFidelity({
  trials,
}: {
  trials: readonly E2eTranscriptFidelityTrial[];
}): E2eTranscriptFidelityComparison {
  const hashes = new Set(trials.map((trial) => trial.wavSha256));
  const rounds: readonly E2eTranscriptFidelitySpec["round"][] = [1, 2, 3];
  const pairs = rounds.map((round) => pairOf({ round, sameMicrophone: hashes.size === 1, trials }));
  const valid = pairs.filter((pair) => pair.valid);
  const surfacesOf = ({ control }: { control: boolean }): readonly E2eTranscriptSurfaceReport[] =>
    trials
      .filter((trial) => valid.some((pair) => pair.round === trial.round) && (trial.variant === "control") === control)
      .map((trial) => trial.final!);
  if (valid.length < 3) {
    const why =
      hashes.size === 1
        ? `${valid.length} of 3 pairs valid; three are the fewest that show a direction repeat`
        : `the calls played ${hashes.size} different microphones, so no pair compares like with like`;
    return { candidate: null, control: null, decision: "invalid", pairs, why };
  }
  const control = totalsOf({ surfaces: surfacesOf({ control: true }) });
  const candidate = totalsOf({ surfaces: surfacesOf({ control: false }) });
  const base = { candidate, control, pairs };
  const controlWithErrors = valid.filter((pair) => pair.controlCritical! > 0).length;
  if (controlWithErrors < 2) {
    return {
      ...base,
      decision: "stop-control-near-perfect",
      why: `control misheard a critical word in ${controlWithErrors} of 3 calls; under two, there is no baseline to improve`,
    };
  }
  const worse = regressions({ candidate, control });
  if (worse.length > 0) {
    return { ...base, decision: "candidate-regressed", why: `candidate worse on ${worse.join(", ")}` };
  }
  const better = valid.filter((pair) => pair.candidateCritical! < pair.controlCritical!).length;
  if (candidate.criticalErrors < control.criticalErrors && better >= 2) {
    return {
      ...base,
      decision: "candidate-improved",
      why: `critical errors ${candidate.criticalErrors} against ${control.criticalErrors}, better in ${better} of 3 rounds, nothing worse`,
    };
  }
  return {
    ...base,
    decision: "inconclusive",
    why: `critical errors ${candidate.criticalErrors} against ${control.criticalErrors}, better in ${better} of 3 rounds`,
  };
}

/** One round's pair: valid only when both members are valid and every call played the same microphone. */
function pairOf({
  round,
  sameMicrophone,
  trials,
}: {
  round: E2eTranscriptFidelitySpec["round"];
  sameMicrophone: boolean;
  trials: readonly E2eTranscriptFidelityTrial[];
}): E2eTranscriptFidelityPair {
  const members = trials.filter((trial) => trial.round === round);
  const control = members.filter((trial) => trial.variant === "control");
  const candidate = members.filter((trial) => trial.variant !== "control");
  const valid =
    sameMicrophone && control.length === 1 && candidate.length === 1 && control[0]!.valid && candidate[0]!.valid;
  return {
    candidateCritical: criticalOf({ trials: candidate }),
    controlCritical: criticalOf({ trials: control }),
    round,
    valid,
  };
}

/** The one trial's critical-error count, or `null` when there is not exactly one scored trial. */
function criticalOf({ trials }: { trials: readonly E2eTranscriptFidelityTrial[] }): number | null {
  if (trials.length !== 1 || trials[0]!.final === null) {
    return null;
  }
  return trials[0]!.final.criticalErrors;
}

/**
 * The six-call report.
 *
 * @param candidate the arm compared against control
 * @param trials every call's trial
 * @returns the report `transcript-fidelity.json` holds
 */
export function transcriptFidelityReport({
  candidate,
  trials,
}: {
  candidate: E2eMicCandidate;
  trials: readonly E2eTranscriptFidelityTrial[];
}): E2eTranscriptFidelityReport {
  return {
    candidate,
    comparison: compareTranscriptFidelity({ trials }),
    corpusVersion: TRANSCRIPT_FIDELITY_CORPUS.version,
    limitations: FIDELITY_LIMITATIONS,
    schemaVersion: 1,
    trials,
  };
}
