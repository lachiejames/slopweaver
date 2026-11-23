/**
 * One TRACE as the readers outside the store see it — the projection `./lessonRecording.ts` is for a lesson.
 * Pure: no I/O, no clock.
 *
 * A trace's facets are NOT a lesson's : there is no tier and no surface, and there is a
 * question, a probe and an outcome instead. A reader that tried to squeeze one into {@link LessonRow} would
 * have to invent a tier, which is the fabricated judgement `../store/schema/memories.ts` refuses at the
 * database — so the projection is its own type and its own function.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { MemoryRecordingRow } from "../store/schema/memories.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { TRACE_OUTCOMES, type TraceOutcome } from "./memory.js";
import { LESSON_LEARNER_DEFAULT, type LessonLearner, type LessonVerdict } from "./types.js";

/** One trace, as every reader outside the store sees it. */
export interface TraceRow {
  /** The claim id — stable across two recordings of the same probe for the same question. */
  readonly id: string;
  /** Which system or area the probe reached. */
  readonly domain: string;
  /** The question the probe was run for. */
  readonly question: string;
  /** The exact probe, as it was run. */
  readonly probe: string;
  /** Whether it paid or came back empty. */
  readonly outcome: TraceOutcome;
  /** What the probe actually returned. */
  readonly evidence: string;
  /** What is currently believed about this trace. */
  readonly verdict: LessonVerdict;
  /** Whose trace it is. */
  readonly learner: LessonLearner;
  /** When this recording was made. */
  readonly recordedAtIso: string;
  /** The board row it was traced on, or `ad-hoc`. */
  readonly run: string;
  /** What the emptiness does not prove. Always present on an empty trace, by the CHECK constraint. */
  readonly doesNotProve?: string;
}

/**
 * Project one stored `trace` recording into the row every pure reader is written against.
 *
 * A recording whose kind is not `trace`, or whose trace facets are null, is REFUSED by recording id rather
 * than defaulted — the CHECK constraint makes both impossible, so either one is a row this code cannot
 * explain and guessing would put an invented probe in front of the reader.
 *
 * @param recording the row as the database returned it
 * @returns the trace row, or the reason this recording is not one
 */
export function traceRowOf({ recording }: { recording: MemoryRecordingRow }): Result<TraceRow, KnowledgeError> {
  if (recording.kind !== "trace") {
    return err(
      KnowledgeErrors.corruptRecording({ recordingId: recording.recordingId, why: `it is a ${recording.kind}` }),
    );
  }
  const outcome = TRACE_OUTCOMES.find((entry) => entry === recording.outcome);
  if (outcome === undefined || recording.question === null || recording.repro === null) {
    return err(KnowledgeErrors.corruptRecording({ recordingId: recording.recordingId, why: "a trace facet is null" }));
  }
  const base: TraceRow = {
    domain: recording.domain,
    evidence: recording.evidence,
    id: recording.id,
    learner: recording.learner === "owner" ? "owner" : LESSON_LEARNER_DEFAULT,
    outcome,
    probe: recording.repro,
    question: recording.question,
    recordedAtIso: recording.recordedAt.toISOString(),
    run: recording.run,
    verdict: recording.verdict,
  };
  return ok(recording.caveat === null ? base : { ...base, doesNotProve: recording.caveat });
}
