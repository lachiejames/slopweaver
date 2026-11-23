/**
 * The `transcription-fidelity` scenario's trials — pure: one call's trial from what its call file and microphone
 * capture held; the paired comparison over all six is `e2eTranscriptFidelityVerdict.ts`. The validity and stop rules are
 * fixed BEFORE a call runs, with one deliberate narrowing: v1 scores the FINAL transcript only. The raw `input_transcript` fragments a relay carries are not
 * captured, so every rule written for "both surfaces" reads the final one, and the report's limitations say so.
 *
 * An instrument failure (no transcript, a skipped line, a setting Chromium did not apply, a different microphone) makes
 * a trial INVALID; a mis-hearing never does — that is the thing being counted.
 */
import type { CallRecord } from "../talk/callRecord.js";
import type { E2eVerdict } from "./e2eOutcome.js";
import { scoreTranscriptFidelity, type TranscriptFidelity } from "./e2eTranscriptFidelity.js";
import {
  type E2eGainProfile,
  type E2eMicVariant,
  type E2eTranscriptFidelitySpec,
  type E2eTranscriptStratum,
  TRANSCRIPT_FIDELITY_CORPUS,
} from "./e2eTranscriptFidelityCorpus.js";

/** The processing a test call ASKS Chromium for. Every field is explicit, control included. */
export interface E2eMicProcessing {
  readonly echoCancellation: boolean;
  readonly noiseSuppression: boolean;
  readonly autoGainControl: boolean;
}

/** What Chromium reports it APPLIED (`MediaStreamTrack.getSettings()`); `null` where it omitted the field. */
export interface E2eAppliedMicSettings {
  readonly echoCancellation: boolean | null;
  readonly noiseSuppression: boolean | null;
  readonly autoGainControl: boolean | null;
}

/** The processing fields a variant may change, in a fixed order. */
const PROCESSING_FIELDS = ["echoCancellation", "noiseSuppression", "autoGainControl"] as const;

/**
 * The processing a variant asks for. Control is today's production chain (`site/lib/audioDevices.ts`
 * `micConstraintsOf`) with gain control made explicit, so both arms of a pair go through the same request shape.
 * Echo cancellation is never varied: it is what keeps the voice out of the owner's microphone.
 *
 * @param variant the arm
 * @returns its constraints
 */
export function micProcessingOf({ variant }: { variant: E2eMicVariant }): E2eMicProcessing {
  const noiseSuppression = variant !== "noise-suppression-off" && variant !== "both-off";
  const autoGainControl = variant !== "auto-gain-off" && variant !== "both-off";
  return { autoGainControl, echoCancellation: true, noiseSuppression };
}

/** Counts over the SCORED lines, keyed by what the line was there to provoke. */
export type StratumCounts = Readonly<Record<Exclude<E2eTranscriptStratum, "setup">, number>>;

/** One surface's score of one call. */
export interface E2eTranscriptSurfaceReport {
  /** The texts scored, in the order they began. */
  readonly heard: readonly string[];
  readonly fidelity: TranscriptFidelity;
  /** Scored lines with a critical word lost: the mis-hearing count. */
  readonly criticalErrors: number;
  readonly scoredLines: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  readonly startErrors: number;
  readonly endErrors: number;
  readonly byStratum: StratumCounts;
  readonly byGain: Readonly<Record<E2eGainProfile, number>>;
}

/**
 * Score heard texts against the v1 script. The setup line is aligned, so a mis-segmented opening cannot shift every
 * later word, but only the scored lines are counted.
 *
 * @param heard the transcript's texts, in the order they began
 * @returns the surface's score
 */
export function surfaceReportOf({ heard }: { heard: readonly string[] }): E2eTranscriptSurfaceReport {
  const script = TRANSCRIPT_FIDELITY_CORPUS.utterances.map((line) => ({
    critical: line.critical,
    id: line.id,
    words: line.text,
  }));
  const fidelity = scoreTranscriptFidelity({ heard, script });
  const scored = fidelity.utterances
    .map((one, index) => ({ line: TRANSCRIPT_FIDELITY_CORPUS.utterances[index]!, one }))
    .filter(({ line }) => line.scored);
  const lost = scored.filter(({ one }) => one.criticalLost.length > 0);
  const lostIn = ({ stratum }: { stratum: E2eTranscriptStratum }): number =>
    lost.filter(({ line }) => line.stratum === stratum).length;
  const sum = ({ pick }: { pick: (one: (typeof scored)[number]["one"]) => number }): number =>
    scored.reduce((total, { one }) => total + pick(one), 0);
  return {
    byGain: {
      ordinary: lost.filter(({ line }) => line.gain === "ordinary").length,
      quiet: lost.filter(({ line }) => line.gain === "quiet").length,
    },
    byStratum: {
      "end-critical": lostIn({ stratum: "end-critical" }),
      glossary: lostIn({ stratum: "glossary" }),
      short: lostIn({ stratum: "short" }),
      "start-critical": lostIn({ stratum: "start-critical" }),
    },
    criticalErrors: lost.length,
    deletions: sum({ pick: (one) => one.deletions }),
    endErrors: scored.filter(({ one }) => one.endWrong).length,
    fidelity,
    heard,
    insertions: sum({ pick: (one) => one.insertions }),
    scoredLines: scored.length,
    startErrors: scored.filter(({ one }) => one.startWrong).length,
    substitutions: sum({ pick: (one) => one.substitutions }),
  };
}

/**
 * The owner's final transcript segments, in the order the call file holds them.
 *
 * @param record the folded call
 * @returns each final owner segment's text
 */
function finalOwnerTexts({ record }: { record: CallRecord }): readonly string[] {
  return record.segments.filter((segment) => segment.who === "owner" && segment.final).map((segment) => segment.text);
}

/** One call of the paired run. */
export interface E2eTranscriptFidelityTrial {
  readonly round: E2eTranscriptFidelitySpec["round"];
  readonly variant: E2eMicVariant;
  readonly callId: string | null;
  readonly wavSha256: string;
  readonly requested: E2eMicProcessing;
  /** Every settings capture the page recorded; exactly one is valid. */
  readonly applied: readonly E2eAppliedMicSettings[];
  readonly final: E2eTranscriptSurfaceReport | null;
  readonly valid: boolean;
  readonly invalidReasons: readonly string[];
}

/**
 * How long the call was held after its microphone opened, on the page's own monotonic clock, against how long the
 * script and its settle need. `heldMs` is `null` when the page's clock could not be read.
 */
export interface E2eFidelityHold {
  readonly heldMs: number | null;
  readonly neededMs: number;
}

/** What one call left behind, read by the effectful shell. */
export interface E2eTranscriptFidelityEvidence {
  readonly spec: E2eTranscriptFidelitySpec;
  readonly wavSha256: string;
  /** Every transcript call id the session opened. */
  readonly callIds: readonly string[];
  /** The folded call file, or why it could not be read. */
  readonly record: CallRecord | string;
  readonly applied: readonly E2eAppliedMicSettings[];
  /**
   * The call's own scenario verdict. It never reads the owner's words, so a failure is the call's — a drop before the script
   * finished, no answer — and a trial whose call failed is partial, never scored.
   */
  readonly verdict: E2eVerdict;
  /**
   * The one measured hold, `null` when the scenario measured none or more than one. A hold short of the script is a
   * partial script, never a run of mis-hearings.
   */
  readonly hold: E2eFidelityHold | null;
}

/**
 * Why a call's hold does not prove the whole script played.
 *
 * @param hold the measured hold, `null` when there was not exactly one
 * @returns one reason, none when the hold covers the script and its settle
 */
function holdProblems({ hold }: { hold: E2eFidelityHold | null }): readonly string[] {
  if (hold === null) {
    return ["the hold was not measured exactly once, so the whole script is unproven"];
  }
  // A clock that read Infinity or NaN would pass any comparison below, so a non-finite reading is an unread one.
  if (hold.heldMs === null || !Number.isFinite(hold.heldMs)) {
    return ["the page's clock could not be read, so the whole script is unproven"];
  }
  if (hold.heldMs < hold.neededMs) {
    const held = Math.floor(hold.heldMs / 1000);
    const needed = Math.ceil(hold.neededMs / 1000);
    return [
      `the call was held ${held}s of the ${needed}s the script and its settle need, so its later lines may never have played`,
    ];
  }
  return [];
}

/**
 * Why one applied capture does not match what was asked, field by field.
 *
 * @param requested what the arm asked for
 * @param applied what Chromium reported
 * @returns one reason per absent or differing field
 */
function settingMismatches({
  applied,
  requested,
}: {
  applied: E2eAppliedMicSettings;
  requested: E2eMicProcessing;
}): readonly string[] {
  return PROCESSING_FIELDS.flatMap((field) => {
    const got = applied[field];
    if (got === null) {
      return [`Chromium omitted ${field}, so the arm is unproven`];
    }
    if (got !== requested[field]) {
      return [`${field} applied ${String(got)}, asked ${String(requested[field])}`];
    }
    return [];
  });
}

/**
 * One call's trial: its final transcript scored, and every instrument failure named.
 *
 * @param evidence what the call left behind
 * @returns the trial
 */
export function transcriptFidelityTrial({
  evidence,
}: {
  evidence: E2eTranscriptFidelityEvidence;
}): E2eTranscriptFidelityTrial {
  const requested = micProcessingOf({ variant: evidence.spec.variant });
  const reasons: string[] = [];
  if (!evidence.verdict.passed) {
    reasons.push(`the call itself failed (${evidence.verdict.kind}): ${evidence.verdict.detail}`);
  }
  reasons.push(...holdProblems({ hold: evidence.hold }));
  if (evidence.callIds.length !== 1) {
    reasons.push(`expected exactly one transcript call id, saw ${evidence.callIds.length}`);
  }
  if (evidence.applied.length === 1) {
    reasons.push(...settingMismatches({ applied: evidence.applied[0]!, requested }));
  } else {
    reasons.push(`expected exactly one microphone settings capture, saw ${evidence.applied.length}`);
  }
  let final: E2eTranscriptSurfaceReport | null = null;
  if (typeof evidence.record === "string") {
    reasons.push(`call file unreadable: ${evidence.record}`);
  } else {
    reasons.push(...recordProblems({ record: evidence.record }));
    final = surfaceReportOf({ heard: finalOwnerTexts({ record: evidence.record }) });
    reasons.push(...scoreProblems({ final }));
  }
  let callId: string | null = null;
  if (evidence.callIds.length === 1) {
    callId = evidence.callIds[0]!;
  }
  return {
    applied: evidence.applied,
    callId,
    final,
    invalidReasons: reasons,
    requested,
    round: evidence.spec.round,
    valid: reasons.length === 0,
    variant: evidence.spec.variant,
    wavSha256: evidence.wavSha256,
  };
}

/** The call-file failures that make a trial an instrument failure. */
function recordProblems({ record }: { record: CallRecord }): readonly string[] {
  const problems: string[] = [];
  if (record.skipped > 0) {
    problems.push(`call file has ${record.skipped} unreadable line(s)`);
  }
  if (record.ended === undefined) {
    problems.push("call never recorded its end");
  }
  // A hang-up writes its end with no reason (`site/components/voice/VoiceProvider.tsx` hangUp); any reason is a drop,
  // and the page's own hang-up control can still be clicked in the instant after one, so this is the record's word.
  if (record.ended !== undefined && record.ended.why !== null) {
    problems.push(`the call ended on "${record.ended.why}", not on the test's hang-up`);
  }
  if (finalOwnerTexts({ record }).length === 0) {
    problems.push("no final transcript of the microphone at all — the call never heard the script");
  }
  // A turn the server never ended loses its words to the record whatever was heard: that is turn-taking, not hearing,
  // so it voids the trial rather than scoring as lost words (measured on the first paired run).
  const open = record.segments.filter((segment) => segment.who === "owner" && !segment.final).length;
  if (open > 0) {
    problems.push(`${open} of the owner's turn(s) never finalised before the call ended — turn-taking, not hearing`);
  }
  return problems;
}

/**
 * The score-shape failures that point at the instrument rather than the transcriber: more words inserted than the
 * script holds means the looping microphone repeated it, or something else spoke into the call.
 */
function scoreProblems({ final }: { final: E2eTranscriptSurfaceReport }): readonly string[] {
  const scripted = final.fidelity.utterances.reduce((sum, one) => sum + one.expected.length, 0);
  const inserted = final.fidelity.utterances.reduce((sum, one) => sum + one.insertions, 0);
  // A whole script's worth of extra words is at least one full repeat: the looped file, or another voice. Fewer is an
  // ordinary insertion error, counted where it fell.
  if (inserted >= scripted) {
    return [
      `${inserted} words heard beyond a ${scripted}-word script — the microphone repeated or something else spoke`,
    ];
  }
  return [];
}
