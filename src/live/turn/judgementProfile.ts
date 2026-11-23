/**
 * The private judgement/voice profile's public shape.
 *
 * Voice and routing are kept as separate mining targets, each carrying its own principles, worked examples,
 * and (routing only) counterexamples — a routing decision has a right and a wrong answer to contrast against;
 * a voice choice does not. Every example is pinned by content hash to its source, not quoted here: this
 * module is the schema Slopweaver ships publicly, while the derived VALUES (the actual prose, the actual
 * routing calls) live only in the private profile file this schema validates, never in this repository.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

/** The judgement-profile version. A stored profile at a different version is refused, not reinterpreted. */
export const JUDGEMENT_PROFILE_SCHEMA_VERSION = 1;

/** The three routing decisions a mined example demonstrates — doing it, asking first, or declining. */
export const JUDGEMENT_ROUTING_DECISIONS = ["act", "ask", "refuse"] as const;

/** One routing decision. */
export type JudgementRoutingDecision = (typeof JUDGEMENT_ROUTING_DECISIONS)[number];

/** One worked example, pinned to its source by content hash rather than quoted inline in this schema. */
interface JudgementExample {
  /** The example's own text, as mined. Lives only in the private profile file this schema validates. */
  readonly text: string;
  /**
   * `sha256:<hex>` over this example's own `text`, not the whole file it was drawn from — identity pinning
   * of the source file is insufficient, since it would not catch a mined snippet edited after the fact.
   * Recomputable from `text` alone, which is what lets `acceptJudgementMiningAnswer` check self-consistency
   * and held-out-case leakage without re-reading original source material.
   */
  readonly sourceHash: string;
}

/**
 * A routing example, labelled with the decision it demonstrates. The label is optional in the SCHEMA so a
 * profile mined before labels existed still parses; `acceptJudgementMiningAnswer` requires it on every
 * routing example a new mining pass writes, and refuses an unbalanced set.
 */
interface RoutingJudgementExample extends JudgementExample {
  readonly decision?: JudgementRoutingDecision | undefined;
}

/** A routing principle labelled with the decision it licenses — the shape that makes "when to act" checkable. */
interface RoutingJudgementPrinciple {
  readonly text: string;
  readonly decision: JudgementRoutingDecision;
}

/** A routing example paired with why it was rejected — the contrast a principle alone cannot carry. */
interface JudgementCounterexample {
  readonly example: RoutingJudgementExample;
  /** The decision that SHOULD have been made — `example.decision` is the wrong one that was made or proposed. */
  readonly expectedDecision?: JudgementRoutingDecision | undefined;
  readonly whyRejected: string;
}

/** One mining target's principles, examples, and (for routing) the counterexamples that bound them. */
interface JudgementSection {
  readonly principles: readonly string[];
  readonly examples: readonly JudgementExample[];
}

/**
 * The routing section additionally carries counterexamples — a voice section does not — and labels its
 * examples and principles with a decision. A bare-string principle is the unlabelled pre-label shape.
 */
export interface RoutingJudgementSection {
  readonly principles: readonly (string | RoutingJudgementPrinciple)[];
  readonly examples: readonly RoutingJudgementExample[];
  readonly counterexamples: readonly JudgementCounterexample[];
}

/** Where a profile came from, so a stale or drifted mining pass is visible rather than silently reused. */
interface JudgementProvenance {
  /** ISO instant the mining pass that produced this profile was accepted. */
  readonly minedAt: string;
  /** The source manifest hash (see `judgement/miningBrief.ts`) this profile was mined under. */
  readonly sourceManifestHash: string;
}

/** The private judgement/voice profile a live turn loads as configuration. */
export interface JudgementProfile {
  readonly schemaVersion: number;
  readonly voice: JudgementSection;
  readonly routing: RoutingJudgementSection;
  readonly provenance: JudgementProvenance;
}

const sourceHashPattern = /^sha256:[0-9a-f]{64}$/;

const judgementExampleSchema = z
  .object({
    sourceHash: z.string().regex(sourceHashPattern, "sourceHash must be sha256:<64 hex chars>"),
    text: z.string().min(1),
  })
  .strict() satisfies z.ZodType<JudgementExample>;

const routingDecisionSchema = z.enum(JUDGEMENT_ROUTING_DECISIONS);

const routingExampleSchema = z
  .object({
    decision: routingDecisionSchema.optional(),
    sourceHash: z.string().regex(sourceHashPattern, "sourceHash must be sha256:<64 hex chars>"),
    text: z.string().min(1),
  })
  .strict() satisfies z.ZodType<RoutingJudgementExample>;

const routingPrincipleSchema = z.union([
  z.string().min(1),
  z.object({ decision: routingDecisionSchema, text: z.string().min(1) }).strict(),
]) satisfies z.ZodType<string | RoutingJudgementPrinciple>;

const judgementSectionSchema = z
  .object({
    examples: z.array(judgementExampleSchema),
    principles: z.array(z.string().min(1)),
  })
  .strict() satisfies z.ZodType<JudgementSection>;

const routingJudgementSectionSchema = z
  .object({
    counterexamples: z.array(
      z
        .object({
          example: routingExampleSchema,
          expectedDecision: routingDecisionSchema.optional(),
          whyRejected: z.string().min(1),
        })
        .strict(),
    ),
    examples: z.array(routingExampleSchema),
    principles: z.array(routingPrincipleSchema),
  })
  .strict() satisfies z.ZodType<RoutingJudgementSection>;

const judgementProvenanceSchema = z
  .object({
    minedAt: z.iso.datetime(),
    sourceManifestHash: z.string().regex(sourceHashPattern, "sourceManifestHash must be sha256:<64 hex chars>"),
  })
  .strict() satisfies z.ZodType<JudgementProvenance>;

/** The strict parse-edge schema for a private judgement profile. */
export const judgementProfileSchema = z
  .object({
    provenance: judgementProvenanceSchema,
    routing: routingJudgementSectionSchema,
    schemaVersion: z.literal(JUDGEMENT_PROFILE_SCHEMA_VERSION),
    voice: judgementSectionSchema,
  })
  .strict() satisfies z.ZodType<JudgementProfile>;

/**
 * Parse an already-decoded private judgement profile.
 *
 * @param value the decoded JSON value
 * @returns the validated profile, or every schema violation
 */
export function parseJudgementProfile({ value }: { value: unknown }): Result<JudgementProfile> {
  const parsed = judgementProfileSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues.map((issue) => issue.message));
}
