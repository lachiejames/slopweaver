/**
 * The length half of the voice model: is this message four times longer than anything the owner sends here?
 *
 * Slopweaver can tell a composer that a WORD was banned; this module tells one that a message is far longer
 * than the surface it is going to, using the numbers in `owner_voice_register`, which this module consumes.
 *
 * ## It WARNS. It never refuses, and that is an owner ruling rather than a design taste
 *
 * No hard blocks for voice. `ABOVE_FOLD_SENTENCE_MAX_WORDS` already refuses a sentence that
 * is structurally too long; this is a different claim — that the whole body is unusual for the owner on this
 * surface — and an unusual message is frequently the correct one. A refusal built on a percentile would
 * make a genuinely long incident write-up unsendable.
 *
 * ## The two counts are not the same count, and the warning says so
 *
 * The register's percentiles were measured over whole sent messages. This counts AUTHORED PROSE, with
 * fenced code, quoted third-party lines, URLs and technical identifiers removed by `authoredProseOf` —
 * the same extractor the exact rules and the sentence cap use, so one body cannot be two lengths inside
 * one gate. That makes this count run LOW against the register, which is the safe direction for a warning
 * (it under-fires rather than crying wolf) and is stated in the warning text rather than left for a
 * reader to work out.
 */

import type { VoiceCohort } from "../../store/profile/types.js";
import type { AboveFoldCell } from "./aboveFold.js";
import { authoredProseOf } from "./exactRules.js";
import { proseWordCount } from "./proseWords.js";

/** Which outbound surface a body is going to. A door names its own; no door may leave it unsaid. */
export type VoiceSurface = "slack" | "slack-dm" | "github" | "linear" | "notion";

/** Whether the register had anything to say about this surface at all. */
export type LengthCalibration = "measured" | "uncalibrated";

/**
 * How many authored-prose words a set of cells carries in total.
 *
 * The whole body rather than per cell, because the register measures a MESSAGE and a cell is a field on a
 * form. Two cells of forty words each is an eighty-word message however the form splits it.
 *
 * @param cells every region of the body, above and below the fold
 * @returns the total authored-prose word count
 */
export function authoredProseWordCount({ cells }: { cells: readonly AboveFoldCell[] }): number {
  return cells
    .flatMap((cell) => authoredProseOf({ path: cell.path, text: cell.text }))
    .reduce((total, region) => total + proseWordCount({ text: region.text }), 0);
}

/**
 * The cohort a surface should be judged against, or none.
 *
 * The cohort with the LARGEST sample wins when a surface carries several, because a calibration measured
 * against one colleague describes that correspondence rather than the surface — warning every Slack
 * message against a 312-message two-person sample would fire on almost all of them. A cohort with no
 * stated sample loses to one that has a number, and ties break on the order the register returned.
 *
 * @param cohorts every cohort the register holds
 * @param surface which surface the body is going to
 * @returns the cohort to judge against, or `undefined` when nothing measured this surface
 */
export function cohortForSurface({
  cohorts,
  surface,
}: {
  cohorts: readonly VoiceCohort[];
  surface: VoiceSurface;
}): VoiceCohort | undefined {
  const candidates = cohorts.filter((cohort) => cohort.surface === surface);
  return candidates.reduce<VoiceCohort | undefined>((best, cohort) => {
    if (best === undefined) {
      return cohort;
    }
    if (cohort.sampleCount === null) {
      return best;
    }
    if (best.sampleCount === null || cohort.sampleCount > best.sampleCount) {
      return cohort;
    }
    return best;
  }, undefined);
}

/**
 * The threshold one cohort sets, and the word for it a warning uses.
 *
 * `p90` when it was measured, else the stated `ceiling`, else nothing. p90 first because it is an
 * OBSERVATION of what the owner actually sends and a ceiling is an intention — and the two genuinely disagree
 * here: the owner's own register gives p90 54 alongside a 50-word ceiling for a casual reply.
 */
function thresholdOf({ cohort }: { cohort: VoiceCohort }): { words: number; label: string } | undefined {
  if (cohort.p90Words !== null) {
    return { label: "p90", words: cohort.p90Words };
  }
  if (cohort.ceilingWords !== null) {
    return { label: "stated ceiling", words: cohort.ceilingWords };
  }
  return undefined;
}

/** What the length check decided about one body. */
export interface LengthVerdict {
  /** One warning line, or none. Never a refusal. */
  readonly warnings: readonly string[];
  /** Whether the register had a threshold for this surface at all. */
  readonly calibration: LengthCalibration;
  /** The authored-prose word count, reported whether or not it warned, so a dry run can show its working. */
  readonly words: number;
}

/**
 * Judge one body's length against the measured register for its surface.
 *
 * Returns `uncalibrated` rather than a clean verdict when nothing measured that surface, and the two are
 * deliberately different values: a surface with no cohort has not been checked, and reporting that as
 * "no warnings" is the shape that makes a check which cannot fire look like a check that passed.
 *
 * @param cells every region of the body, above and below the fold
 * @param cohorts the measured register, empty when none has been imported
 * @param surface which surface the body is going to
 * @returns the warning, the calibration state, and the count behind both
 */
export function lengthVerdictFor({
  cells,
  cohorts,
  surface,
}: {
  cells: readonly AboveFoldCell[];
  cohorts: readonly VoiceCohort[];
  surface: VoiceSurface;
}): LengthVerdict {
  const words = authoredProseWordCount({ cells });
  const cohort = cohortForSurface({ cohorts, surface });
  const threshold = cohort === undefined ? undefined : thresholdOf({ cohort });
  if (cohort === undefined || threshold === undefined) {
    return { calibration: "uncalibrated", warnings: [], words };
  }
  if (words <= threshold.words) {
    return { calibration: "measured", warnings: [], words };
  }
  const ratio = (words / threshold.words).toFixed(1);
  return {
    calibration: "measured",
    warnings: [
      `this body is ${String(words)} authored-prose words against ${surface}/${cohort.cohort} ` +
        `${threshold.label} ${String(threshold.words)} — ${ratio}x. The register was measured over whole ` +
        "sent messages while this count drops code, quotes, URLs and identifiers, so the real gap is wider. " +
        "This never blocks the write.",
    ],
    words,
  };
}
