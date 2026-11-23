/**
 * Recall accounting — what a session says about a memory it has just leaned on, and what that does to the
 * register. Pure: no I/O, no clock.
 *
 * A trace regrades at the one moment the evidence is in hand: if the memory still holds, that strengthens
 * it, and if it does not hold this time, that is important to know, a false memory perhaps.
 *
 * ## The regrade is a consequence of the outcome, not a second decision
 *
 * The session that just recalled a memory and checked it is the only one holding the evidence, so the
 * verdict moves THERE or it never moves at all — 97.6% of this register read `confirmed` because nothing
 * ever re-graded. {@link regradeFor} is that rule as a total function over the three outcomes, and the
 * recording it asks for is built from the LATEST recording of the claim rather than from anything the
 * caller types: the claim text has to match byte for byte or the id changes and the correction becomes a
 * second, unrelated claim ( `skills/knowledge/reference/detective-lessons.md` has always asked a human to
 * do that by hand; here it is mechanical).
 *
 * ## Why `broke` will not take a default verdict
 *
 * A memory that did not hold has either been REFUTED (it is not true) or CHANGED (still a trap, but the
 * numbers, names or endpoint moved), and those are different facts about the same observation. Defaulting
 * one would put a verdict nobody chose into the register, which is the silent substitution
 * `.claude/rules/typescript-patterns.md` bans, so the caller states it.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { MemoryRecordingRow } from "../store/schema/memories.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import type { MemoryRecording } from "./memory.js";
import { requireText } from "./row.js";
import { LESSON_SURFACES, LESSON_TIERS, type LessonVerdict } from "./types.js";

/** What checking a recalled memory established. */
export type RecallOutcome = "held" | "broke" | "unchecked";

/** Every outcome. A plain array, for the reason `./memory.ts`'s vocabularies give. */
export const RECALL_OUTCOMES: readonly RecallOutcome[] = ["held", "broke", "unchecked"];

/** The verdicts a broken memory may be regraded to. Both are real states; neither is a default. */
export type BrokeVerdict = "refuted" | "changed";

/** Both of them. */
export const BROKE_VERDICTS: readonly BrokeVerdict[] = ["refuted", "changed"];

/** The longest a recall's evidence may run. The register's own evidence bound. */
export const RECALL_EVIDENCE_MAX = 1600;

/** What a session is recording about one recall. */
export interface RecallFields {
  /** The claim id it recalled. */
  readonly memoryId: string;
  readonly outcome: RecallOutcome;
  /** What the session observed when it checked. */
  readonly evidence: string;
  /** The verdict a BROKEN memory moves to. Required for `broke`, refused for anything else. */
  readonly verdict?: BrokeVerdict | undefined;
  readonly run: string;
}

/** What the register should do about this recall: nothing, or append one regrading recording. */
export type Regrade = { readonly kind: "none" } | { readonly kind: "record"; readonly verdict: LessonVerdict };

/**
 * Whether this recall moves the claim's verdict, and to what.
 *
 * `broke` always records, because the memory failed the check it was just put to. `held` records ONLY when
 * the register currently believes something other than `confirmed` — a claim that held is already saying
 * so, and a second identical recording would inflate the repeat count that drives the owner's
 * consolidation trigger. `unchecked` never records: the session recalled it and did not put it to any
 * test, which is worth counting and is not evidence about the claim.
 *
 * @param outcome what checking established
 * @param currentVerdict what the register believes now — the latest recording's verdict
 * @param verdict the verdict a broken memory moves to
 * @returns whether to append a recording, and which verdict it carries
 */
export function regradeFor({
  outcome,
  currentVerdict,
  verdict,
}: {
  outcome: RecallOutcome;
  currentVerdict: LessonVerdict;
  verdict: BrokeVerdict | undefined;
}): Regrade {
  if (outcome === "broke" && verdict !== undefined) {
    return { kind: "record", verdict };
  }
  if (outcome === "held" && currentVerdict !== "confirmed") {
    return { kind: "record", verdict: "confirmed" };
  }
  return { kind: "none" };
}

/**
 * Validate what a session is recording about one recall.
 *
 * Refuses a `broke` with no verdict, and a verdict on an outcome that cannot carry one: both would write a
 * fact nobody stated. Evidence is required for every outcome — including `unchecked`, where it says what
 * the session did instead of checking, which is the honest content of that row.
 *
 * @param fields what the caller supplied
 * @returns the fields, trimmed, or the first check that failed
 */
export function parseRecallFields({ fields }: { fields: RecallFields }): Result<RecallFields, KnowledgeError> {
  if (!RECALL_OUTCOMES.some((entry) => entry === fields.outcome)) {
    return err(KnowledgeErrors.invalidField({ field: "outcome", why: `must be one of ${RECALL_OUTCOMES.join(", ")}` }));
  }
  if (fields.outcome === "broke" && fields.verdict === undefined) {
    return err(
      KnowledgeErrors.invalidField({
        field: "verdict",
        why: `is required when a memory broke — ${BROKE_VERDICTS.join(" or ")}, and the two say different things about the claim`,
      }),
    );
  }
  if (fields.outcome !== "broke" && fields.verdict !== undefined) {
    return err(
      KnowledgeErrors.invalidField({ field: "verdict", why: "only a memory that BROKE carries a new verdict" }),
    );
  }
  const memoryId = requireText({ field: "memory-id", max: 200, value: fields.memoryId });
  if (memoryId.isErr()) {
    return err(memoryId.error);
  }
  const evidence = requireText({ field: "evidence", max: RECALL_EVIDENCE_MAX, value: fields.evidence });
  if (evidence.isErr()) {
    return err(evidence.error);
  }
  const run = requireText({ field: "run", max: 200, value: fields.run });
  if (run.isErr()) {
    return err(run.error);
  }
  return ok({
    evidence: evidence.value,
    memoryId: memoryId.value,
    outcome: fields.outcome,
    run: run.value,
    ...(fields.verdict === undefined ? {} : { verdict: fields.verdict }),
  });
}

/**
 * A value a lookup may not have found, as the NULL a column holds — an `if` naming the absent case.
 *
 * `?? null` is what this would be in another repository and is refused here (`no-silent-fallback`), and the
 * ternary it replaced is what oxlint refuses. So the substitution is a line of code, once, rather than an
 * operator at every call site.
 *
 * @param value what the lookup returned
 * @returns the value, or null when the lookup found nothing
 */
function orNull<T>({ value }: { value: T | undefined }): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * Narrow a stored row into the recording shape a writer builds.
 *
 * `tier` is a `smallint`, so the database hands back `number | null` where this codebase's own type is the
 * four-value ladder — the same narrowing `./lessonRecording.ts` does for a lesson. A tier or surface outside
 * its vocabulary reads as NULL rather than being asserted through: the CHECK constraint makes that
 * impossible for a lesson, and inventing a tier for a row that somehow lacked one would put a judgement
 * nobody made into the register.
 *
 * @param row the recording as the database returned it
 * @returns the same recording, with both facets narrowed to their vocabularies
 */
export function recordingOf({ row }: { row: MemoryRecordingRow }): MemoryRecording {
  const tier = orNull({ value: LESSON_TIERS.find((entry) => entry === row.tier) });
  const surface = orNull({ value: LESSON_SURFACES.find((entry) => entry === row.surface) });
  return {
    behaviourChange: row.behaviourChange,
    caveat: row.caveat,
    claim: row.claim,
    domain: row.domain,
    evidence: row.evidence,
    id: row.id,
    importKey: row.importKey,
    kind: row.kind,
    learner: row.learner,
    outcome: row.outcome,
    question: row.question,
    recordedAt: row.recordedAt,
    recordingId: row.recordingId,
    repro: row.repro,
    retrievalCue: row.retrievalCue,
    run: row.run,
    supersedes: row.supersedes,
    surface,
    tier,
    verdict: row.verdict,
  };
}

/**
 * The regrading recording, built from the claim's latest recording so every identity survives.
 *
 * The claim, the domain, the kind and every facet are carried across UNCHANGED — the id is a hash of the
 * domain and the claim, so a single altered character mints a different claim and leaves the old belief
 * standing as the one recall returns. Only the verdict, the evidence, the run and the instant are this
 * recording's own.
 *
 * @param latest the claim's current recording
 * @param verdict what the register now believes
 * @param evidence what the checking session observed
 * @param run the board row that checked it
 * @param recordingId this physical recording's uuid, passed in so this stays pure
 * @param recordedAt the instant to stamp, for the same reason
 * @returns the recording an insert takes
 */
export function regradeRecording({
  latest,
  verdict,
  evidence,
  run,
  recordingId,
  recordedAt,
}: {
  latest: MemoryRecording;
  verdict: LessonVerdict;
  evidence: string;
  run: string;
  recordingId: string;
  recordedAt: Date;
}): MemoryRecording {
  return {
    behaviourChange: latest.behaviourChange,
    caveat: latest.caveat,
    claim: latest.claim,
    domain: latest.domain,
    evidence,
    id: latest.id,
    importKey: null,
    kind: latest.kind,
    learner: latest.learner,
    outcome: latest.outcome,
    question: latest.question,
    recordedAt,
    recordingId,
    repro: latest.repro,
    retrievalCue: latest.retrievalCue,
    run,
    // A regrade moves a verdict; it retires nothing. A supersession the claim already made stays in force
    // through the recording that made it, which is still later than the retired claim's own latest.
    supersedes: null,
    surface: latest.surface,
    tier: latest.tier,
    verdict,
  };
}
