/**
 * Building one memory recording from what a caller supplied — the pure half of the retrieved register.
 *
 * No filesystem, no clock, no network: `recordingId` and `recordedAt` are passed in, exactly as
 * `./row.ts` does, so every check here is testable without a seam.
 *
 * ## Two identities, and why both are derived here
 *
 * `recordingId` is THIS physical recording and is unique. `id` is the CLAIM and is deliberately not:
 * {@link memoryId} hashes the domain and the normalised claim and nothing else, so two sessions that learn
 * the same thing produce the same id and the repeat becomes countable. That count is the owner's
 * consolidation trigger (`./types.ts`'s overview), and a builder that folded the two identities together
 * would delete the feature while every query still worked.
 *
 * ## The placement check is the one gate on the way in
 *
 * {@link buildMemoryRecording} refuses any declared placement but `retrieved`, and names where that
 * content actually belongs. What it cannot do is judge whether the answer is honest — see `./memory.ts`.
 * So the two placement FIELDS are required instead: `behaviourChange` says what the next agent does
 * differently, `retrievalCue` says the words a task would have to mention. Both are reviewable claims a
 * human can read and disagree with, which is the most a write-time gate can truthfully offer.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../lib/result.js";

import type { InstallKnowledgeDomains } from "./domainVocabulary.js";
import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import {
  MEMORY_FIELD_MAX,
  MEMORY_ID_PREFIXES,
  MEMORY_PLACEMENT_DESTINATIONS,
  type MemoryKind,
  type MemoryPlacement,
  type MemoryRecording,
  RETAINED_PLACEMENT,
  type TraceOutcome,
} from "./memory.js";
import { normaliseClaim, requireKnowledgeDomain, requireSupersedes, requireText } from "./row.js";
import { LESSON_CLAIM_MAX, type LessonSurface, type LessonTier, type LessonVerdict } from "./types.js";

/** How many hex characters of the claim digest an id keeps. The same width `./row.ts`'s `lessonId` uses. */
const ID_LENGTH = 16;

/** What both kinds carry. Split out so the discriminated union below states only what actually differs. */
interface MemoryCommonInput {
  /** Which system or area this is about. A validated slug, never free text. */
  readonly domain: string;
  /** The memory itself, in one sentence. */
  readonly claim: string;
  /** What was observed, for a lesson; what the owner said, and when, for a preference. */
  readonly evidence: string;
  /** Who learned it — the fleet, or the owner. One field, not one per kind. */
  readonly learner: string;
  /** What is currently believed about the claim. */
  readonly verdict: LessonVerdict;
  /** What the next agent does differently for having read this. */
  readonly behaviourChange: string;
  /** The words a task would have to mention for this to be worth recalling. */
  readonly retrievalCue: string;
  /** The board row this was learned on, or `ad-hoc`. */
  readonly run: string;
  /** Which of the three destinations the writer declared. Only `retrieved` is accepted here. */
  readonly placement: MemoryPlacement;
  /** What the evidence does NOT establish. Absent when there is nothing to say, never `"none"`. */
  readonly caveat?: string;
  /** The claim id this memory retires, when it replaces one. A lesson or a preference only — never a trace. */
  readonly supersedes?: string;
}

/**
 * One memory, as a caller supplies it.
 *
 * A lesson carries the facets that describe a failure; a preference carries none of them, because nothing
 * measured it and there is no harm ladder for a way of working. The union is what makes passing a `tier`
 * with a preference a compile error rather than a database refusal — the CHECK constraint in
 * `../store/schema/memories.ts` is the backstop for a writer that is not this module.
 */
export type MemoryInput =
  | (MemoryCommonInput & {
      readonly kind: "lesson";
      readonly tier: LessonTier;
      readonly surface: LessonSurface;
      readonly repro?: string;
    })
  | (MemoryCommonInput & { readonly kind: "preference" })
  | (MemoryCommonInput & {
      readonly kind: "trace";
      /** The question the probe was run for. */
      readonly question: string;
      /** The exact probe, stored in `repro` because it IS the command that settles the trace again. */
      readonly repro: string;
      readonly outcome: TraceOutcome;
    });

/**
 * The stable id for a claim. Two recordings of the same claim in the same domain share it.
 *
 * The two halves are joined by an escaped NUL rather than any printable character, so no domain-and-claim
 * pair can collide with a different pair that happens to contain the separator. Written as the escape
 * sequence rather than a raw NUL byte, which makes git render the whole file as `Binary files differ`.
 *
 * @param kind which prefix the id carries, so a claim id says which contract produced it
 * @param domain the domain slug
 * @param claim the claim as written; normalised before hashing
 * @returns a kind-prefixed short hex id
 */
export function memoryId({ kind, domain, claim }: { kind: MemoryKind; domain: string; claim: string }): string {
  const digest = createHash("sha256")
    .update(`${domain}\u0000${normaliseClaim({ claim })}`)
    .digest("hex")
    .slice(0, ID_LENGTH);
  return `${MEMORY_ID_PREFIXES[kind]}${digest}`;
}

/** One required text field's name. */
type TextField = "claim" | "evidence" | "learner" | "behaviour-change" | "retrieval-cue" | "run";

/**
 * The required text fields, in the order a writer should be told about them.
 *
 * A plain `readonly TextField[]` rather than an `as const` tuple, matching `./types.ts`'s vocabularies —
 * `../store/schema/memories.ts` carries the measured reason a tuple is avoided in this tree.
 */
const TEXT_FIELDS: readonly TextField[] = ["claim", "evidence", "learner", "behaviour-change", "retrieval-cue", "run"];

/** How long each required text field may be. `evidence` is longest because it carries a measurement. */
const TEXT_FIELD_MAX: Readonly<Record<TextField, number>> = {
  "behaviour-change": MEMORY_FIELD_MAX,
  claim: LESSON_CLAIM_MAX,
  evidence: LESSON_CLAIM_MAX * 4,
  learner: MEMORY_FIELD_MAX,
  "retrieval-cue": MEMORY_FIELD_MAX,
  run: MEMORY_FIELD_MAX,
};

/** Every required text field, checked in one pass so the first failure names the field a writer must fix. */
function requiredTexts({ input }: { input: MemoryInput }): Result<Readonly<Record<TextField, string>>, KnowledgeError> {
  const supplied: Readonly<Record<TextField, string>> = {
    "behaviour-change": input.behaviourChange,
    claim: input.claim,
    evidence: input.evidence,
    learner: input.learner,
    "retrieval-cue": input.retrievalCue,
    run: input.run,
  };
  const resolved: Partial<Record<TextField, string>> = {};
  for (const field of TEXT_FIELDS) {
    const text = requireText({ field, max: TEXT_FIELD_MAX[field], value: supplied[field] });
    if (text.isErr()) {
      return err(text.error);
    }
    resolved[field] = text.value;
  }
  return ok({ ...supplied, ...resolved });
}

/** Each kind's own facets, and nulls for every facet it does not carry — the shape the CHECK constraint enforces. */
function facetsOf({ input }: { input: MemoryInput }): {
  outcome: TraceOutcome | null;
  question: string | null;
  repro: string | null;
  surface: LessonSurface | null;
  tier: LessonTier | null;
} {
  if (input.kind === "preference") {
    return { outcome: null, question: null, repro: null, surface: null, tier: null };
  }
  if (input.kind === "trace") {
    return {
      outcome: input.outcome,
      question: input.question.trim(),
      repro: input.repro.trim(),
      surface: null,
      tier: null,
    };
  }
  const repro = input.repro === undefined || input.repro.trim().length === 0 ? null : input.repro.trim();
  return { outcome: null, question: null, repro, surface: input.surface, tier: input.tier };
}

/**
 * Build a validated recording from what a caller supplied, deriving both identities.
 *
 * The placement check runs FIRST: a writer who has answered "this belongs in a skill" should be told where
 * to put it before being told its claim is four characters too long.
 *
 * @param input the memory as supplied, already narrowed to one of the two kinds
 * @param recordingId this physical recording's uuid, passed in so this stays pure
 * @param recordedAt the instant to stamp, passed in for the same reason
 * @param installDomains this install's own domains and aliases, read once at the verb's edge
 * @returns the row an insert takes, or the first check that failed
 */
export function buildMemoryRecording({
  input,
  installDomains,
  recordingId,
  recordedAt,
}: {
  input: MemoryInput;
  installDomains: InstallKnowledgeDomains;
  recordingId: string;
  recordedAt: Date;
}): Result<MemoryRecording, KnowledgeError> {
  if (input.placement !== RETAINED_PLACEMENT) {
    return err(
      KnowledgeErrors.placementRefused({
        destination: MEMORY_PLACEMENT_DESTINATIONS[input.placement],
        placement: input.placement,
      }),
    );
  }
  const domain = requireKnowledgeDomain({ domain: input.domain.trim(), installDomains });
  if (domain.isErr()) {
    return err(domain.error);
  }
  const texts = requiredTexts({ input });
  if (texts.isErr()) {
    return err(texts.error);
  }
  const claim = texts.value.claim;
  const id = memoryId({ claim, domain: domain.value, kind: input.kind });
  const supersedes = supersedesOf({ id, input });
  if (supersedes.isErr()) {
    return err(supersedes.error);
  }
  const caveat = input.caveat === undefined || input.caveat.trim().length === 0 ? null : input.caveat.trim();
  return ok({
    behaviourChange: texts.value["behaviour-change"],
    importKey: null,
    caveat,
    claim,
    domain: domain.value,
    evidence: texts.value.evidence,
    id,
    kind: input.kind,
    learner: texts.value.learner,
    recordedAt,
    recordingId,
    retrievalCue: texts.value["retrieval-cue"],
    run: texts.value.run,
    supersedes: supersedes.value,
    verdict: input.verdict,
    ...facetsOf({ input }),
  });
}

/**
 * The claim this memory retires, refusing one on a trace.
 *
 * A trace only reports where an investigation looked, so a newer trace is simply recorded beside the old one;
 * letting a trace retire anything would hide a dead end the next investigation still needs to see.
 */
function supersedesOf({ input, id }: { input: MemoryInput; id: string }): Result<string | null, KnowledgeError> {
  if (input.kind === "trace" && input.supersedes !== undefined) {
    return err(
      KnowledgeErrors.supersedesRefused({
        supersedes: input.supersedes,
        why: "a trace only reports, so it never retires another claim — record the new trace beside it",
      }),
    );
  }
  return requireSupersedes({ id, supersedes: input.supersedes });
}
