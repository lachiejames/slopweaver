/**
 * The tick ledger's two closed vocabularies — what an action or judgement is ABOUT, and what a sweep DID — as
 * the one list each that both `./tickTypes.ts`'s types and `./tickSchema.ts`'s strict enums read, so a kind
 * added to one cannot be missing from the other.
 */

/**
 * Every `TickSubject` kind. `ceiling` names one of `../capacity/ceilings.ts`'s ceilings by id — `machine`,
 * `claude:<alias>`, `codex:<alias>` — and is what a hold-rationale's `relatedSubjects` carries to say which
 * ceiling it waited on.
 */
export const TICK_SUBJECT_KINDS = [
  "session",
  "handover",
  "pull-request",
  "recipe",
  "artifact",
  "owner-turn",
  "machine",
  "outcome",
  "ceiling",
] as const;

/** Every `TickActionKind`. */
export const TICK_ACTION_KINDS = [
  "enqueued",
  "closed",
  "answered",
  "spawned",
  "recipe-run",
  "recipe-held",
  "artifact-published",
  "state-amended",
  "rearmed",
] as const;
