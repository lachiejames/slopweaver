/**
 * The readers for the Alignment page's four reads: the owner's measured voice (`profile voice --json`), the owner's voice rules
 * (`slack voice-rules --json`), the owner's answers to the page's own questions (`talk log --about-prefix align: --json`) and
 * the owner's named feedback on drafts the owner sent back (`talk log --about-prefix post: --json`).
 *
 * Strict in `./read.ts`'s sense: a payload that does not read is `undefined`, which the page names as not measured,
 * never a substitute. A cohort or an answer that does not read refuses its whole reading, because a dropped answer
 * is a question the page would ask the owner again. A statistic the register says it never measured (`null`) is not a
 * cohort that does not read: it is carried as `undefined`.
 */

import type { CardFeedback } from "../../lib/alignmentRules";
import { type Bag, bags, bool, isBag, nullableNum, nullableStr, str } from "../../lib/bag";
import {
  feedbackRefusal,
  type TriageRulingWire,
  triageFeedbackOf,
  triageLabelOf,
  triageVerdictOf,
} from "../../lib/triageWords";

/**
 * One measured cohort of the owner's own messages. Every statistic is nullable in the register (`profile voice` prints an
 * absent one as `—`), so each is `undefined` here when not measured: a cohort the register holds with no median is a
 * cohort nothing measured yet, never a read that failed.
 */
export interface VoiceCohort {
  readonly surface: string;
  readonly cohort: string;
  readonly medianWords: number | undefined;
  readonly p75Words: number | undefined;
  readonly p90Words: number | undefined;
  readonly sampleCount: number | undefined;
  readonly measuredAt: string;
}

/** One rule the owner's voice gate enforces: a banned literal, word or phrase. */
export interface VoiceRule {
  readonly kind: string;
  readonly value: string;
}

/** The owner's voice rules as the gate reads them, and the prose shape the composer is briefed with. */
export interface VoiceRules {
  readonly rules: readonly VoiceRule[];
  readonly shape: string;
}

/** One answer the owner gave on the Alignment page. */
export interface AlignmentAnswer {
  /** The question's key, `align:<id>`. */
  readonly about: string;
  readonly words: string;
  readonly atIso: string;
}

/**
 * Project one cohort.
 *
 * @returns the cohort, or `undefined` when a field the page states does not read
 */
function cohortOf(bag: Bag): VoiceCohort | undefined {
  const surface = str({ bag, key: "surface" });
  const cohort = str({ bag, key: "cohort" });
  const measuredAt = str({ bag, key: "measuredAt" });
  const medianWords = nullableNum({ bag, key: "medianWords" });
  const p75Words = nullableNum({ bag, key: "p75Words" });
  const p90Words = nullableNum({ bag, key: "p90Words" });
  const sampleCount = nullableNum({ bag, key: "sampleCount" });
  if (
    surface === undefined ||
    cohort === undefined ||
    measuredAt === undefined ||
    medianWords === false ||
    p75Words === false ||
    p90Words === false ||
    sampleCount === false
  ) {
    return undefined;
  }
  return { cohort, measuredAt, medianWords, p75Words, p90Words, sampleCount, surface };
}

/**
 * Project `profile voice --json`.
 *
 * @returns every cohort, or `undefined` when the payload or any cohort in it does not read
 */
export function readVoiceProfile(payload: unknown): readonly VoiceCohort[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const list = bags({ bag: payload, key: "cohorts" });
  if (list === undefined) {
    return undefined;
  }
  const out: VoiceCohort[] = [];
  for (const bag of list) {
    const cohort = cohortOf(bag);
    if (cohort === undefined) {
      return undefined;
    }
    out.push(cohort);
  }
  return out;
}

/**
 * Project `slack voice-rules --json`.
 *
 * @returns the rules and the shape, or `undefined` when the payload or any rule in it does not read
 */
export function readVoiceRules(payload: unknown): VoiceRules | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const list = bags({ bag: payload, key: "rules" });
  const shape = str({ bag: payload, key: "shape" });
  if (list === undefined || shape === undefined) {
    return undefined;
  }
  const rules: VoiceRule[] = [];
  for (const bag of list) {
    const kind = str({ bag, key: "kind" });
    const value = str({ bag, key: "value" });
    if (kind === undefined || value === undefined) {
      return undefined;
    }
    rules.push({ kind, value });
  }
  return { rules, shape };
}

/**
 * Project `talk log --about-prefix align: --json` into the owner's answers, newest first.
 *
 * The owner's words are `heard`, exactly as the owner typed them; the instant is when the relay registered
 * (`src/talk/relayStore.ts` `TurnRecord`). A turn still `intended` — its board row never confirmed, so its
 * `registeredAtIso` is `null` — is not an answer the supervisor has, so it is not one here either. Any other
 * state with no readable instant refuses the reading.
 *
 * @returns every registered answer, or `undefined` when the payload or any row in it does not read
 */
export function readAlignmentAnswers(payload: unknown): readonly AlignmentAnswer[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "rows" });
  if (rows === undefined) {
    return undefined;
  }
  const out: AlignmentAnswer[] = [];
  for (const row of rows) {
    const about = str({ bag: row, key: "about" });
    const words = str({ bag: row, key: "heard" });
    const state = str({ bag: row, key: "state" });
    const typed = bool({ bag: row, key: "typed" });
    const atIso = nullableStr({ bag: row, key: "registeredAtIso" });
    if (about === undefined || words === undefined || state === undefined || typed === undefined || atIso === false) {
      return undefined;
    }
    if (state === "intended" && atIso === undefined) {
      continue;
    }
    if (atIso === undefined || Number.isNaN(Date.parse(atIso))) {
      return undefined;
    }
    out.push({ about, atIso, words });
  }
  return out.toSorted((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso));
}

/**
 * Project `talk log --about-prefix post: --json` into the owner's named feedback on the drafts the owner sent back. A relay with no
 * triage, or a triage naming no feedback, carries none and is skipped; one whose triage does not read — a verdict,
 * label or feedback class this page does not know — refuses the whole reading, since a dropped one is a repeat the
 * page would stop counting. A turn still `intended` is skipped exactly as {@link readAlignmentAnswers} skips it.
 *
 * @returns every registered feedback, or `undefined` when the payload or any row in it does not read
 */
export function readTriageFeedback(payload: unknown): readonly CardFeedback[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "rows" });
  if (rows === undefined) {
    return undefined;
  }
  const out: CardFeedback[] = [];
  for (const row of rows) {
    const about = str({ bag: row, key: "about" });
    const words = str({ bag: row, key: "heard" });
    const state = str({ bag: row, key: "state" });
    const atIso = nullableStr({ bag: row, key: "registeredAtIso" });
    const triage = triageOf({ value: row["triageRuling"] });
    if (about === undefined || words === undefined || state === undefined || atIso === false || triage === false) {
      return undefined;
    }
    if (triage?.feedback === undefined || (state === "intended" && atIso === undefined)) {
      continue;
    }
    if (atIso === undefined || Number.isNaN(Date.parse(atIso))) {
      return undefined;
    }
    out.push({ about, atIso, feedback: triage.feedback, words });
  }
  return out;
}

/**
 * A stored triage ruling, read as strictly as `src/talk/turnRecordShape.ts` reads it.
 *
 * @returns the ruling, `undefined` when the row carries none (absent on a record written before rulings were stored,
 *   `null` on a relay that said it carried none), or `false` when it carries one that does not read
 */
function triageOf({ value }: { value: unknown }): TriageRulingWire | undefined | false {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isBag(value) || Object.keys(value).some((key) => !TRIAGE_KEYS.has(key))) {
    return false;
  }
  const verdict = triageVerdictOf({ value: value["verdict"] });
  const label = triageLabelOf({ value: value["label"] });
  const feedback = triageFeedbackOf({ value: value["feedback"] });
  if (
    verdict === undefined ||
    (value["label"] !== undefined && label === undefined) ||
    (value["feedback"] !== undefined && feedback === undefined) ||
    feedbackRefusal({ feedback: value["feedback"], verdict }) !== undefined
  ) {
    return false;
  }
  return feedback === undefined ? { label, verdict } : { feedback, label, verdict };
}

/** The keys a stored triage ruling may carry. */
const TRIAGE_KEYS: ReadonlySet<string> = new Set(["feedback", "label", "verdict"]);
