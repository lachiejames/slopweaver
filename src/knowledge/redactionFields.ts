/**
 * Which register columns a knowledge redaction reads, named the way a report prints them (`table.column`). Pure
 * data, apart from `./redaction.ts` so its error union can name a field without importing the planner.
 *
 * Physical identity and order — `recording_id`, `recall_id`, `memory_recalls.recording_id`, `seq` and every
 * timestamp — are absent on purpose: they are minted by this codebase, never written by a person, and a
 * redaction preserves them byte for byte.
 */

/** One scanned column. */
export type KnowledgeReferenceField =
  | "memories.id"
  | "memories.domain"
  | "memories.claim"
  | "memories.evidence"
  | "memories.repro"
  | "memories.question"
  | "memories.caveat"
  | "memories.learner"
  | "memories.behaviour_change"
  | "memories.retrieval_cue"
  | "memories.run"
  | "memories.import_key"
  | "memories.supersedes"
  | "memory_recalls.memory_id"
  | "memory_recalls.evidence"
  | "memory_recalls.run";

/**
 * Every scanned column, in the order a report lists them. A plain array rather than an `as const` tuple, for
 * the reason `./memory.ts`'s `MEMORY_PLACEMENTS` gives.
 */
export const KNOWLEDGE_REFERENCE_FIELDS: readonly KnowledgeReferenceField[] = [
  "memories.id",
  "memories.domain",
  "memories.claim",
  "memories.evidence",
  "memories.repro",
  "memories.question",
  "memories.caveat",
  "memories.learner",
  "memories.behaviour_change",
  "memories.retrieval_cue",
  "memories.run",
  "memories.import_key",
  "memories.supersedes",
  "memory_recalls.memory_id",
  "memory_recalls.evidence",
  "memory_recalls.run",
];
