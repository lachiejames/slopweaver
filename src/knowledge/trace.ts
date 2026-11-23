/**
 * A trace — where an investigation looked, and what came back. Pure: no I/O, no clock.
 *
 * The third memory kind: the exact probe, whether it paid or was empty, and what the emptiness does not
 * prove. It can be more accurate than a ruling, because a ruling can be wrong when it generalizes from what
 * was found.
 *
 * ## Why the claim is DERIVED, and what it is derived from
 *
 * The claim id is a hash of the domain and the claim (`./memoryRow.ts`'s `memoryId`), and two recordings
 * sharing an id are one belief over time. So the claim is built from the probe and the question and from
 * NOTHING that moves between two runs of the same probe — not the outcome, not the evidence. A later run
 * whose probe now PAYS where it was empty records the same claim again, the latest recording wins in recall,
 * and the flip is visible in the history rather than hidden behind a second, unrelated trace.
 *
 * ## Why the placement fields are derived too
 *
 * Every new recording must say what the next agent does differently and which words retrieve it. For a
 * trace both answers follow from the facts, so a writer is not asked to invent them: the retrieval cue is the
 * question itself, and the behaviour change is fixed by the outcome — including, for an empty probe, the
 * ruling's first line: a remembered dead end never skips a leg.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { TRACE_OUTCOMES, type TraceOutcome } from "./memory.js";
import type { MemoryInput } from "./memoryRow.js";
import { requireText } from "./row.js";
import { LESSON_LEARNERS } from "./types.js";

/** The longest a trace's question may be. With {@link TRACE_PROBE_MAX} it keeps a derived claim under the claim cap. */
export const TRACE_QUESTION_MAX = 200;

/** The longest a trace's probe may be — one command, not a script. */
export const TRACE_PROBE_MAX = 180;

/** What a trace writer supplies. */
export interface TraceFields {
  /** Which system or area the probe reached. */
  readonly domain: string;
  /** The question the probe was run for. */
  readonly question: string;
  /** The exact command, pasteable. */
  readonly probe: string;
  readonly outcome: TraceOutcome;
  /** What the probe actually returned — counts, statuses, the window. */
  readonly evidence: string;
  /** What the result does NOT prove. Required for an empty probe. */
  readonly doesNotProve?: string;
  readonly learner: string;
  readonly run: string;
}

/**
 * The claim a trace is filed under — the probe and the question, and nothing that changes between runs.
 *
 * @returns the one-sentence claim
 */
export function traceClaim({ probe, question }: { probe: string; question: string }): string {
  return `${probe.trim()} — for: ${question.trim()}`;
}

/**
 * What the next agent does differently for having read a trace.
 *
 * @returns the fixed sentence for that outcome
 */
export function traceBehaviourChange({ outcome }: { outcome: TraceOutcome }): string {
  if (outcome === "paid") {
    return "open this probe early on a question like this one — it paid last time";
  }
  return "still run this leg; read the trace to reorder the work and to check what the emptiness did not prove";
}

/**
 * Turn what a trace writer supplied into the memory input the shared builder validates and stores.
 *
 * Refuses an empty probe with nothing said about what that emptiness does not prove: an unqualified dead end
 * is the blind spot the owner warned about, and the CHECK constraint refuses the same row at the database.
 *
 * @param fields what the writer supplied
 * @returns the `trace` memory input, or the first field that failed
 */
export function traceInput({ fields }: { fields: TraceFields }): Result<MemoryInput, KnowledgeError> {
  if (!TRACE_OUTCOMES.some((entry) => entry === fields.outcome)) {
    return err(KnowledgeErrors.invalidField({ field: "outcome", why: `must be one of ${TRACE_OUTCOMES.join(", ")}` }));
  }
  if (!LESSON_LEARNERS.some((entry) => entry === fields.learner)) {
    return err(KnowledgeErrors.invalidField({ field: "learner", why: `must be one of ${LESSON_LEARNERS.join(", ")}` }));
  }
  const question = requireText({ field: "question", max: TRACE_QUESTION_MAX, value: fields.question });
  if (question.isErr()) {
    return err(question.error);
  }
  const probe = requireText({ field: "probe", max: TRACE_PROBE_MAX, value: fields.probe });
  if (probe.isErr()) {
    return err(probe.error);
  }
  const doesNotProve = fields.doesNotProve === undefined ? "" : fields.doesNotProve.trim();
  if (fields.outcome === "empty" && doesNotProve.length === 0) {
    return err(
      KnowledgeErrors.invalidField({
        field: "does-not-prove",
        why: "is required for an empty probe — say what the emptiness does not establish, or it becomes a blind spot",
      }),
    );
  }
  return ok({
    behaviourChange: traceBehaviourChange({ outcome: fields.outcome }),
    claim: traceClaim({ probe: probe.value, question: question.value }),
    domain: fields.domain,
    evidence: fields.evidence,
    kind: "trace",
    learner: fields.learner,
    outcome: fields.outcome,
    placement: "retrieved",
    question: question.value,
    repro: probe.value,
    retrievalCue: question.value,
    run: fields.run,
    verdict: "confirmed",
    ...(doesNotProve.length === 0 ? {} : { caveat: doesNotProve }),
  });
}
