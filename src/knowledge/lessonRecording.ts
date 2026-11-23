/**
 * The two projections between a {@link LessonRow} — the `knowledge record` contract — and a row of the
 * memories table. Pure: no I/O, no clock, no connection.
 *
 * ## Why `record` does not go through `./memoryRow.ts`
 *
 * `buildMemoryRecording` is the `knowledge remember` contract: it REQUIRES `learner`, `behaviourChange` and
 * `retrievalCue`, because a writer who reached that verb was asked the placement question and answered it.
 * A `knowledge record` caller was never asked — the verb predates the table, and every session, hook and
 * skill that calls it supplies a domain, a claim, a verdict, a tier, a surface and evidence, and nothing
 * else. The verb is cut over to the table on one condition that is the whole
 * of this file: **do not fabricate those judgements.** So {@link lessonRecording} writes the two placement
 * fields as NULL unless the caller actually supplied them, exactly as `./importLessons.ts` does for a row
 * that predates them, and a NULL there reads as "nobody answered", which is true.
 *
 * `learner` is the one field that IS written for a `record` row and NULL for an imported one, and the two
 * are not in tension: `record`'s `--learner` has a documented default (`LESSON_LEARNER_DEFAULT`) that the
 * caller accepted by omitting the flag, whereas a line in the old file carried no field at all and a parsed
 * `fleet` there could not be told from an absent one. A value the verb's own contract supplies is not a
 * fabrication; a value guessed for a file that had no such field would be.
 *
 * ## The reverse projection is what keeps every reader unchanged
 *
 * {@link lessonRowOf} turns a stored `lesson` recording back into the {@link LessonRow} that
 * `./query.ts`, `./declared.ts` and `./quiz/` were written against, so the settle gate, `knowledge list`
 * and the quiz read the table through the same pure functions they read the file through — the
 * current-cycle rule in `lessonsDeclaration` is untouched rather than re-derived in SQL. A `preference`
 * never reaches it: the reader in `./memoryStore.ts` selects `kind = 'lesson'` at the database, so a
 * preference cannot be counted as a measured lesson by construction rather than by a filter somebody
 * remembers to apply. A NULL `learner` (an imported row) reads as `LESSON_LEARNER_DEFAULT`, which is what an
 * absent field in the file always meant.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../lib/result.js";
import type { MemoryRecordingRow } from "../store/schema/memories.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { MEMORY_ID_PREFIXES, type MemoryRecording } from "./memory.js";
import {
  LESSON_LEARNER_DEFAULT,
  LESSON_SURFACES,
  LESSON_TIERS,
  type LessonRow,
  type LessonSurface,
  type LessonTier,
} from "./types.js";

/** A trimmed optional text, or NULL — never an empty string in a column. */
function textOrNull({ value }: { value: string | undefined }): string | null {
  return value === undefined || value.trim().length === 0 ? null : value.trim();
}

/**
 * Project one lesson row into the recording an insert takes.
 *
 * @param lesson the validated row — `record` built it, or the import decoded it
 * @param recordingId this physical recording's uuid, passed in so this stays pure
 * @param importKey the source line this came from, or null for a row recorded directly
 * @param learner who learned it, or null when the source carried no attribution — see the file overview
 * @param behaviourChange what the next agent does differently, when the caller said; never invented
 * @param retrievalCue the words a task would have to mention, when the caller said; never invented
 * @returns the recording, with the `l-` id the lesson already carries
 */
export function lessonRecording({
  lesson,
  recordingId,
  importKey,
  learner,
  behaviourChange,
  retrievalCue,
}: {
  lesson: LessonRow;
  recordingId: string;
  importKey: string | null;
  learner: string | null;
  behaviourChange?: string | undefined;
  retrievalCue?: string | undefined;
}): MemoryRecording {
  return {
    behaviourChange: textOrNull({ value: behaviourChange }),
    caveat: textOrNull({ value: lesson.caveat }),
    claim: lesson.claim.trim(),
    domain: lesson.domain,
    evidence: lesson.evidence.trim(),
    // Every row here is a lesson: the contract has no other kind. The `l-` prefix its ids already carry is
    // preserved exactly, and added only for a line written before `lessonId` prefixed them.
    id: lesson.id.startsWith(MEMORY_ID_PREFIXES.lesson) ? lesson.id : `${MEMORY_ID_PREFIXES.lesson}${lesson.id}`,
    importKey,
    kind: "lesson",
    learner,
    outcome: null,
    question: null,
    recordedAt: new Date(lesson.recordedAtIso),
    recordingId,
    repro: textOrNull({ value: lesson.repro }),
    retrievalCue: textOrNull({ value: retrievalCue }),
    run: lesson.run.trim(),
    supersedes: unsetFieldAsNull({ key: "supersedes", record: lesson }),
    surface: lesson.surface,
    tier: lesson.tier,
    verdict: lesson.verdict,
  };
}

/**
 * Project one stored `lesson` recording back into the row every pure reader was written against.
 *
 * The lesson facets are nullable in the DDL because a preference carries none; the CHECK constraint
 * `memories_lesson_facets` guarantees a `lesson` row has both, so a NULL here is a row this code cannot
 * explain and is refused by recording id rather than defaulted. The same goes for a `preference` handed in
 * by mistake: it is refused, never coerced into a lesson.
 *
 * @param recording the row as the database returned it
 * @returns the lesson row, or the reason this recording is not one
 */
export function lessonRowOf({ recording }: { recording: MemoryRecordingRow }): Result<LessonRow, KnowledgeError> {
  if (recording.kind !== "lesson") {
    return err(
      KnowledgeErrors.corruptRecording({ recordingId: recording.recordingId, why: `it is a ${recording.kind}` }),
    );
  }
  const tier: LessonTier | undefined = LESSON_TIERS.find((entry) => entry === recording.tier);
  const surface: LessonSurface | undefined = LESSON_SURFACES.find((entry) => entry === recording.surface);
  if (tier === undefined || surface === undefined) {
    return err(KnowledgeErrors.corruptRecording({ recordingId: recording.recordingId, why: "a lesson facet is null" }));
  }
  const base: LessonRow = {
    claim: recording.claim,
    domain: recording.domain,
    evidence: recording.evidence,
    id: recording.id,
    learner: recording.learner === "owner" ? "owner" : LESSON_LEARNER_DEFAULT,
    recordedAtIso: recording.recordedAt.toISOString(),
    run: recording.run,
    surface,
    tier,
    verdict: recording.verdict,
  };
  return ok({
    ...base,
    ...(recording.caveat === null ? {} : { caveat: recording.caveat }),
    ...(recording.repro === null ? {} : { repro: recording.repro }),
    ...(recording.supersedes === null ? {} : { supersedes: recording.supersedes }),
  });
}
