/**
 * Decoding one line of a `knowledge export` file back into the recording it came from. Pure: no I/O.
 *
 * An export that cannot be put back is a file, not a backup. This module is the other half of
 * `../cli/commands/knowledge/exportMemories.ts`, and the two are tested as a round trip rather than
 * separately — a decoder that agrees with a encoder nobody replays is the check that cannot fail.
 *
 * Every identity is preserved verbatim, `recordingId` included: a restore that minted new ids would
 * produce a database that agrees on content and disagrees on every foreign reference and every count a
 * reader had already written down.
 *
 * **`createdAt` is preserved too, and that is a correctness property rather than tidiness.** It is one of
 * the terms that orders two recordings of one claim sharing an instant, so a restore that let it default
 * to the transaction's own `now()` would give every row the same value and push the tie-break down to an
 * arbitrary `recording_id` — surfacing an older `confirmed` where a newer `refuted` had been. The same class
 * recurs one digit deeper in the timestamp — which is why `seq`, a monotonic integer with no precision to
 * lose, is what recall actually orders by and why it too is carried verbatim.
 * `../store/schema/memories.ts` carries all three rounds.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { MEMORY_KINDS, type MemoryKind, type MemoryRecording, TRACE_OUTCOMES, type TraceOutcome } from "./memory.js";
import {
  LESSON_SURFACES,
  LESSON_TIERS,
  LESSON_VERDICTS,
  type LessonSurface,
  type LessonTier,
  type LessonVerdict,
} from "./types.js";

// Each guard is a one-parameter type predicate because TypeScript error TS1230 forbids destructuring in a
// type-predicate signature — the compiler's decision, which `named-object-params` exempts for that reason.

/** Whether an unknown value is a member of the kind vocabulary. */
function isKind(value: unknown): value is MemoryKind {
  return MEMORY_KINDS.some((entry) => entry === value);
}

/** Whether an unknown value is a member of the verdict vocabulary. */
function isVerdict(value: unknown): value is LessonVerdict {
  return LESSON_VERDICTS.some((entry) => entry === value);
}

/** Whether an unknown value is a member of the surface vocabulary. */
function isSurface(value: unknown): value is LessonSurface {
  return LESSON_SURFACES.some((entry) => entry === value);
}

/** Whether an unknown value is a member of the tier ladder. */
function isTier(value: unknown): value is LessonTier {
  return LESSON_TIERS.some((entry) => entry === value);
}

/** A nullable string field, or `undefined` when the value is neither a string nor null. */
function nullableText({ value }: { value: unknown }): string | null | undefined {
  if (value === null || typeof value === "string") {
    return value;
  }
  return undefined;
}

/** A tier, an explicit null, or `undefined` when the value is neither — which is a corrupt line. */
function nullableTier({ value }: { value: unknown }): LessonTier | null | undefined {
  if (value === null) {
    return null;
  }
  if (isTier(value)) {
    return value;
  }
  return undefined;
}

/** A surface, an explicit null, or `undefined` when the value is neither. */
function nullableSurface({ value }: { value: unknown }): LessonSurface | null | undefined {
  if (value === null) {
    return null;
  }
  if (isSurface(value)) {
    return value;
  }
  return undefined;
}

/**
 * A recording decoded from an export: both ordering columns are always present, because the decoder refuses
 * a line that lacks either — so a merge can renumber `seq` and compare `createdAt` without guessing.
 */
export type RestoredRecording = MemoryRecording & { readonly createdAt: Date; readonly seq: number };

/**
 * Decode one exported line back into the row an insert takes.
 *
 * `searchable` is deliberately NOT read even when present: it is a generated column, so Postgres computes
 * it on the way in and an insert naming it is refused outright.
 *
 * @param line one line of the export file
 * @param lineNumber the 1-based line number, carried into a corruption error so the file can be inspected
 * @returns the recording, or a corruption error naming the line
 */
export function parseExportedLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<RestoredRecording, KnowledgeError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  if (!isRecord(decoded)) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const { recordingId, id, kind, domain, claim, evidence, verdict, run, recordedAt } = decoded;
  const textsOk =
    typeof recordingId === "string" &&
    typeof id === "string" &&
    typeof domain === "string" &&
    typeof claim === "string" &&
    typeof evidence === "string" &&
    typeof run === "string" &&
    typeof recordedAt === "string";
  if (!textsOk || !isKind(kind) || !isVerdict(verdict)) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const ordering = orderingFields({ decoded });
  if (ordering === undefined) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const when = new Date(recordedAt);
  if (Number.isNaN(when.getTime())) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const optional = nullableFields({ decoded });
  if (optional === undefined) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  return ok({
    ...optional,
    ...ordering,
    claim,
    domain,
    evidence,
    id,
    kind,
    recordedAt: when,
    recordingId,
    run,
    verdict,
  });
}

/**
 * The two columns that decide which recording of a claim recall shows, or `undefined` when either is
 * missing or malformed.
 *
 * They are required rather than optional on the way IN: a restore that let either default would change
 * what the register believes.
 *
 * @param decoded one exported line, already known to be an object
 * @returns the ordering columns, or undefined when the line cannot supply them
 */
function orderingFields({
  decoded,
}: {
  decoded: Record<string, unknown>;
}): { createdAt: Date; seq: number } | undefined {
  const seq = decoded["seq"];
  const createdAt = decoded["createdAt"];
  // A safe integer, not just an integer: `JSON.parse` rounds a value past 2^53 to a neighbour that is still an
  // integer, so a plain integer check would restore a seq the file does not hold.
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1 || typeof createdAt !== "string") {
    return undefined;
  }
  const entered = new Date(createdAt);
  return Number.isNaN(entered.getTime()) ? undefined : { createdAt: entered, seq };
}

/**
 * A column an export written BEFORE the column existed does not carry at all. Absent reads as NULL, which
 * is exactly what that row held; present-but-malformed is still corruption, so the two are kept apart.
 */
function laterText({ decoded, key }: { decoded: Record<string, unknown>; key: string }): string | null | undefined {
  if (!(key in decoded)) {
    return null;
  }
  return nullableText({ value: decoded[key] });
}

/** A trace outcome, an explicit null, an absent key (an older export), or `undefined` when malformed. */
function laterOutcome({ decoded }: { decoded: Record<string, unknown> }): TraceOutcome | null | undefined {
  if (!("outcome" in decoded) || decoded["outcome"] === null) {
    return null;
  }
  return TRACE_OUTCOMES.find((entry) => entry === decoded["outcome"]);
}

/** Every column an export may leave null, decoded together — or `undefined` when any of them is malformed. */
function nullableFields({ decoded }: { decoded: Record<string, unknown> }):
  | {
      behaviourChange: string | null;
      caveat: string | null;
      importKey: string | null;
      learner: string | null;
      outcome: TraceOutcome | null;
      question: string | null;
      repro: string | null;
      retrievalCue: string | null;
      supersedes: string | null;
      surface: LessonSurface | null;
      tier: LessonTier | null;
    }
  | undefined {
  const question = laterText({ decoded, key: "question" });
  const outcome = laterOutcome({ decoded });
  const supersedes = laterText({ decoded, key: "supersedes" });
  if (question === undefined || outcome === undefined || supersedes === undefined) {
    return undefined;
  }
  const tier = nullableTier({ value: decoded["tier"] });
  const surface = nullableSurface({ value: decoded["surface"] });
  const repro = nullableText({ value: decoded["repro"] });
  const caveat = nullableText({ value: decoded["caveat"] });
  const learner = nullableText({ value: decoded["learner"] });
  const behaviourChange = nullableText({ value: decoded["behaviourChange"] });
  const retrievalCue = nullableText({ value: decoded["retrievalCue"] });
  const importKey = nullableText({ value: decoded["importKey"] });
  // Each is tested by name rather than through an array so the narrowing reaches the return below: past this
  // `if` every one is a value or an explicit NULL, which is what the export held, and is carried as it stands.
  if (
    tier === undefined ||
    surface === undefined ||
    repro === undefined ||
    caveat === undefined ||
    learner === undefined ||
    behaviourChange === undefined ||
    retrievalCue === undefined ||
    importKey === undefined
  ) {
    return undefined;
  }
  return {
    behaviourChange,
    caveat,
    importKey,
    learner,
    outcome,
    question,
    repro,
    retrievalCue,
    supersedes,
    surface,
    tier,
  };
}
