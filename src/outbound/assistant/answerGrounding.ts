/**
 * How an `answer` was actually produced — the three `grounding` arms (`conversation`, `verb`, `unreachable`)
 * and the discriminated union `./answerArm.ts`'s `answerArmSchema` nests under its `grounding` field. Split
 * out of `./answerForm.ts`, which was past its size floor; the arms share `./answerEvidence.ts`'s session-authored
 * `evidence` and `provenance` shapes and nothing of the rest of the form.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { evidenceSchema, executionProvenanceSchema } from "./answerEvidence.js";
import { EVIDENCE_LABEL_VISIBLE_MAX, EXECUTION_LIST_MAX, PARAGRAPH_VISIBLE_MAX } from "./contentLimits.js";

/**
 * An answer grounded in context and judgement alone — no live source matched, and nothing was loaded to
 * check it against. `reason` names why nothing else was needed; `evidence`/`provenance` are the same
 * session-authored shape `verb`/`unreachable` already carry.
 */
const conversationGroundingSchema = strictForm({
  evidence: evidenceSchema,
  kind: z.literal("conversation"),
  provenance: executionProvenanceSchema,
  reason: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
});

/** An answer grounded in a live command or a repository check the turn actually ran. */
const verbGroundingSchema = strictForm({
  capability: strictForm({
    command: z.array(z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX)).min(1).max(EXECUTION_LIST_MAX),
    id: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
    what: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
  }),
  evidence: evidenceSchema,
  kind: z.literal("verb"),
  provenance: executionProvenanceSchema,
  result: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
});

/** An answer for which no reachable surface could establish anything — named, not silently absent. */
const unreachableGroundingSchema = strictForm({
  evidence: evidenceSchema,
  kind: z.literal("unreachable"),
  provenance: executionProvenanceSchema,
  surface: strictForm({
    id: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
    what: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
  }),
  why: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
});

/**
 * How an `answer` was actually produced — see `./answerForm.ts`'s header for why this is nested rather than a
 * fourth top-level arm.
 */
export const answerGroundingSchema = z.discriminatedUnion("kind", [
  conversationGroundingSchema,
  verbGroundingSchema,
  unreachableGroundingSchema,
]);
