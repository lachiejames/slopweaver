/**
 * Reading a prune plan — the pure half of `slopweaver knowledge prune`. No I/O, no clock.
 *
 * A hygiene pass the owner has approved judges every claim in the register and lands as ONE plan file: a line
 * per claim to RETIRE (its every recording leaves the table, archived first) and a line per claim to REPLACE
 * (a rewritten recording is written and the old claim retired). The whole pass is one plan — 1,009 deletes,
 * 338 merges into a keeper and 147 rewrites — which no append-only verb could express.
 *
 * Retiring is the one delete the register has, so the plan is validated whole before anything is read: a
 * single malformed line refuses the plan, because a half-applied hygiene pass is a register nobody can
 * reason about.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { InstallKnowledgeDomains } from "./domainVocabulary.js";
import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { MEMORY_FIELD_MAX, MEMORY_KINDS, type MemoryKind, type MemoryRecording, TRACE_OUTCOMES } from "./memory.js";
import { memoryId } from "./memoryRow.js";
import { requireKnowledgeDomain, requireText } from "./row.js";
import {
  LESSON_CLAIM_MAX,
  LESSON_SURFACES,
  LESSON_TIERS,
  LESSON_VERDICTS,
  type LessonSurface,
  type LessonTier,
  type LessonVerdict,
} from "./types.js";

/**
 * One replacement: the rewritten recording, minus the two identities a writer mints at apply time.
 *
 * @internal
 */
export type ReplacementDraft = Omit<MemoryRecording, "recordingId" | "recordedAt" | "createdAt" | "seq">;

/**
 * One validated plan line.
 *
 * @internal
 */
export type PruneStep =
  | { readonly op: "retire"; readonly id: string; readonly reason: string }
  | { readonly op: "replace"; readonly replaces: string; readonly reason: string; readonly draft: ReplacementDraft };

/** A whole validated plan. */
export interface PrunePlan {
  /** Every step, in file order. */
  readonly steps: readonly PruneStep[];
  /**
   * Every claim id whose recordings leave the table: each retire, and each replaced id whose rewrite landed
   * under a DIFFERENT id. A rewrite that kept its claim text keeps its id and its history, and is not here.
   */
  readonly retiredIds: readonly string[];
}

/** Whether an unknown value is one of the memory kinds. */
function isKind(value: unknown): value is MemoryKind {
  return MEMORY_KINDS.some((entry) => entry === value);
}

/** Whether an unknown value is one of the verdicts. */
function isVerdict(value: unknown): value is LessonVerdict {
  return LESSON_VERDICTS.some((entry) => entry === value);
}

/** Whether an unknown value is one of the tiers. */
function isTier(value: unknown): value is LessonTier {
  return LESSON_TIERS.some((entry) => entry === value);
}

/** Whether an unknown value is one of the surfaces. */
function isSurface(value: unknown): value is LessonSurface {
  return LESSON_SURFACES.some((entry) => entry === value);
}

/** Whether an unknown value is a plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One text field of a draft object to read, and the longest value it accepts. */
interface DraftTextField {
  readonly row: Record<string, unknown>;
  readonly key: string;
  readonly max: number;
}

/**
 * An optional text field: a non-empty string trimmed, or null for null, absent or blank.
 *
 * @returns the text or null, or why the field is malformed
 */
function optionalText({ row, key, max }: DraftTextField): Result<string | null, KnowledgeError> {
  if (!(key in row) || row[key] === null) {
    return ok(null);
  }
  const value = row[key];
  if (typeof value !== "string") {
    return err(KnowledgeErrors.invalidField({ field: key, why: "must be a string or null" }));
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ok(null);
  }
  if (trimmed.length > max) {
    return err(KnowledgeErrors.invalidField({ field: key, why: `is longer than ${String(max)} characters` }));
  }
  return ok(trimmed);
}

/**
 * A required text field, trimmed and bounded — the same bound `./memoryRow.ts` holds a fresh write to.
 *
 * @returns the text, or why it is missing or malformed
 */
function requiredText({ row, key, max }: DraftTextField): Result<string, KnowledgeError> {
  const value = row[key];
  if (typeof value !== "string") {
    return err(KnowledgeErrors.invalidField({ field: key, why: "is required" }));
  }
  return requireText({ field: key, max, value });
}

/** The facets one kind carries, and nulls for the rest — the CHECK constraint's shape. */
function facetsFor({
  kind,
  row,
}: {
  kind: MemoryKind;
  row: Record<string, unknown>;
}): Result<Pick<ReplacementDraft, "tier" | "surface" | "question" | "outcome">, KnowledgeError> {
  if (kind === "preference") {
    return ok({ outcome: null, question: null, surface: null, tier: null });
  }
  if (kind === "trace") {
    const question = requiredText({ key: "question", max: LESSON_CLAIM_MAX * 4, row });
    if (question.isErr()) {
      return err(question.error);
    }
    const outcome = TRACE_OUTCOMES.find((entry) => entry === row["outcome"]);
    if (outcome === undefined) {
      return err(oneOf({ field: "outcome", kind, members: TRACE_OUTCOMES }));
    }
    return ok({ outcome, question: question.value, surface: null, tier: null });
  }
  const { tier, surface } = row;
  if (!isTier(tier)) {
    return err(oneOf({ field: "tier", kind, members: LESSON_TIERS }));
  }
  if (!isSurface(surface)) {
    return err(oneOf({ field: "surface", kind, members: LESSON_SURFACES }));
  }
  return ok({ outcome: null, question: null, surface, tier });
}

/** A facet outside its closed vocabulary, naming every member it could have been. */
function oneOf({
  field,
  kind,
  members,
}: {
  field: string;
  kind: MemoryKind;
  members: readonly (string | number)[];
}): KnowledgeError {
  return KnowledgeErrors.invalidField({ field, why: `must be one of ${members.join("|")} on a ${kind}` });
}

/** The texts every kind shares, validated in one pass. */
function textsFor({
  row,
}: {
  row: Record<string, unknown>;
}): Result<
  Pick<
    ReplacementDraft,
    "claim" | "evidence" | "run" | "repro" | "caveat" | "learner" | "behaviourChange" | "retrievalCue"
  >,
  KnowledgeError
> {
  const required: Record<string, string> = {};
  for (const [key, max] of REQUIRED_TEXTS) {
    const text = requiredText({ key, max, row });
    if (text.isErr()) {
      return err(text.error);
    }
    required[key] = text.value;
  }
  const optional: Record<string, string | null> = {};
  for (const [key, max] of OPTIONAL_TEXTS) {
    const text = optionalText({ key, max, row });
    if (text.isErr()) {
      return err(text.error);
    }
    optional[key] = text.value;
  }
  return ok({
    behaviourChange: optional["behaviourChange"]!,
    caveat: optional["caveat"]!,
    claim: required["claim"]!,
    evidence: required["evidence"]!,
    learner: optional["learner"]!,
    repro: optional["repro"]!,
    retrievalCue: optional["retrievalCue"]!,
    run: required["run"]!,
  });
}

/** The texts every replacement must carry, each with the bound a fresh write is held to. */
const REQUIRED_TEXTS: readonly (readonly [string, number])[] = [
  ["claim", LESSON_CLAIM_MAX],
  ["evidence", LESSON_CLAIM_MAX * 4],
  ["run", MEMORY_FIELD_MAX],
];

/** The texts a replacement may leave null — what a row recorded before its field existed also leaves null. */
const OPTIONAL_TEXTS: readonly (readonly [string, number])[] = [
  ["repro", LESSON_CLAIM_MAX * 4],
  ["caveat", LESSON_CLAIM_MAX * 4],
  ["learner", MEMORY_FIELD_MAX],
  ["behaviourChange", MEMORY_FIELD_MAX],
  ["retrievalCue", MEMORY_FIELD_MAX],
];

/**
 * Validate one replacement row and derive its claim id, exactly as a fresh write would.
 *
 * @param row the `row` object of a replace line
 * @param installDomains this install's own domains, which the replacement's domain is checked against
 * @returns the draft, or why it cannot be written
 */
function replacementDraft({
  row,
  installDomains,
}: {
  row: unknown;
  installDomains: InstallKnowledgeDomains;
}): Result<ReplacementDraft, KnowledgeError> {
  if (!isObject(row)) {
    return err(KnowledgeErrors.invalidField({ field: "row", why: "must be an object" }));
  }
  const { kind, domain, verdict } = row;
  if (!isKind(kind)) {
    return err(KnowledgeErrors.invalidField({ field: "kind", why: `must be one of ${MEMORY_KINDS.join("|")}` }));
  }
  if (typeof domain !== "string") {
    return err(KnowledgeErrors.invalidDomain({ domain: String(domain) }));
  }
  // A replacement is a fresh write, so it is held to the closed vocabulary exactly as `record` is.
  const canonical = requireKnowledgeDomain({ domain: domain.trim(), installDomains });
  if (canonical.isErr()) {
    return err(canonical.error);
  }
  if (!isVerdict(verdict)) {
    return err(KnowledgeErrors.invalidField({ field: "verdict", why: `must be one of ${LESSON_VERDICTS.join("|")}` }));
  }
  const facets = facetsFor({ kind, row });
  if (facets.isErr()) {
    return err(facets.error);
  }
  const texts = textsFor({ row });
  if (texts.isErr()) {
    return err(texts.error);
  }
  return ok({
    ...facets.value,
    ...texts.value,
    domain: canonical.value,
    id: memoryId({ claim: texts.value.claim, domain: canonical.value, kind }),
    importKey: null,
    kind,
    // A prune removes the claim it replaces outright, so the rewrite has nothing left to retire.
    supersedes: null,
    verdict,
  });
}

/**
 * Decode one plan line.
 *
 * @param line the raw line
 * @param lineNumber its one-based position, which every refusal names
 * @param installDomains this install's own domains, for a replacement row
 * @returns the step, or why the line is refused
 */
function stepOf({
  line,
  lineNumber,
  installDomains,
}: {
  line: string;
  lineNumber: number;
  installDomains: InstallKnowledgeDomains;
}): Result<PruneStep, KnowledgeError> {
  const refused = ({ why }: { why: string }): Result<PruneStep, KnowledgeError> =>
    err(KnowledgeErrors.planLineRefused({ lineNumber, why }));
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return refused({ why: "not JSON" });
  }
  if (!isObject(decoded)) {
    return refused({ why: "not an object" });
  }
  const { op, reason } = decoded;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return refused({ why: "reason is required — a retired claim says why it left" });
  }
  if (op === "retire") {
    const { id } = decoded;
    return typeof id === "string" && id.length > 0
      ? ok({ id, op, reason: reason.trim() })
      : refused({ why: "retire needs an id" });
  }
  if (op === "replace") {
    const { replaces } = decoded;
    if (typeof replaces !== "string" || replaces.length === 0) {
      return refused({ why: "replace needs the claim id it replaces" });
    }
    const draft = replacementDraft({ installDomains, row: decoded["row"] });
    return draft.isErr()
      ? refused({ why: draft.error.message })
      : ok({ draft: draft.value, op, reason: reason.trim(), replaces });
  }
  return refused({ why: 'op must be "retire" or "replace"' });
}

/**
 * Validate a whole plan. Every refused line is reported, and one refusal refuses the plan.
 *
 * A claim id named by two steps is refused too: retiring and rewriting the same claim, or rewriting it
 * twice, is a plan that contradicts itself, and applying either half silently would pick for the writer. So
 * is a rewrite whose new claim id is one the same plan retires.
 *
 * @param lines the plan file's lines, blank lines included
 * @param installDomains this install's own domains, which every replacement row is checked against
 * @returns the plan, or one refusal per refused line
 */
export function parsePrunePlan({
  lines,
  installDomains,
}: {
  lines: readonly string[];
  installDomains: InstallKnowledgeDomains;
}): Result<PrunePlan, readonly KnowledgeError[]> {
  const problems: KnowledgeError[] = [];
  const steps: PruneStep[] = [];
  const named = new Map<string, number>();
  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    const lineNumber = index + 1;
    const step = stepOf({ installDomains, line, lineNumber });
    if (step.isErr()) {
      problems.push(step.error);
      return;
    }
    const subject = step.value.op === "retire" ? step.value.id : step.value.replaces;
    const earlier = named.get(subject);
    if (earlier !== undefined) {
      const why = `${subject} is already named on line ${String(earlier)}`;
      problems.push(KnowledgeErrors.planLineRefused({ lineNumber, why }));
      return;
    }
    named.set(subject, lineNumber);
    steps.push(step.value);
  });
  if (problems.length > 0) {
    return err(problems);
  }
  const retiredIds = steps.flatMap((step) => {
    if (step.op === "retire") {
      return [step.id];
    }
    return step.draft.id === step.replaces ? [] : [step.replaces];
  });
  const retiring = new Set(retiredIds);
  const landsOnRetired = steps.flatMap((step) =>
    step.op === "replace" && retiring.has(step.draft.id)
      ? [
          KnowledgeErrors.planLineRefused({
            lineNumber: named.get(step.replaces)!,
            why: `the rewrite of ${step.replaces} lands on ${step.draft.id}, which this plan retires`,
          }),
        ]
      : [],
  );
  if (landsOnRetired.length > 0) {
    return err(landsOnRetired);
  }
  return ok({ retiredIds, steps });
}
