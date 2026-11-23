/**
 * Knowledge redaction — the codebase's own redaction tooling applied to register rows, as an opt-in. Pure: no
 * I/O, no clock. `./redactionStore.ts` is the effectful half for rows already stored; every `--redact` flag runs
 * the same plan over the rows it is about to insert.
 *
 * ## What one value goes through
 *
 * 1. The install's ordered replacement map (`../hygiene/replacementMap.ts`), which knows what a name BECOMES.
 * 2. The committed forbidden-identifier rules (`../hygiene/forbiddenIdentifiers.ts`), which are hashes and so can
 *    only say THAT a span is a name: every span they still find is masked — a provider location's workspace label
 *    with {@link LOCATION_MASK}, which every location rule allows, so the provider's host stays readable; anything
 *    else with {@link REDACTION_MASK}. Masking repeats until a scan finds nothing, and a pass that changes nothing
 *    while a span remains is a refusal, never a row reported clean.
 *
 * A row about a provider in general passes untouched, because the committed rules only refuse what names one
 * organisation: that judgement is theirs and is not re-derived here.
 *
 * ## What a redaction may and may not rewrite
 *
 * Prose columns are rewritten. A claim's `id` is DERIVED from its domain and claim (`./memoryRow.ts`'s
 * `memoryId`), so it is recomputed from the redacted latest recording of each claim and carried into every
 * `supersedes` and recall `memory_id` naming it — the same coordinated move `./domainMigration.ts` makes for a
 * domain fold. An `import_key` is a source digest the importer re-derives to stay idempotent, so a hit there is a
 * refusal rather than a rewrite. Physical identity and order are never touched (`./redactionFields.ts`).
 *
 * Nothing here returns or renders matched text, an excerpt or a row id; the scan that proves a plan clean is
 * `./redactionScan.ts`'s, and it is counts by kind and by field.
 */
import type { IdentifierScanner, IdentifierSpan } from "../hygiene/identifierScan.js";
import { applyReplacementMap, type ReplacementRule } from "../hygiene/replacementMap.js";
import { err, ok, type Result } from "../lib/result.js";

import { memoryId } from "./memoryRow.js";
import { type KnowledgeRedactionError, KnowledgeRedactionErrors } from "./redactionErrors.js";
import { KNOWLEDGE_REFERENCE_FIELDS, type KnowledgeReferenceField } from "./redactionFields.js";
import { type RedactableMemory, type RedactableRecall, scanKnowledgeRows } from "./redactionScan.js";

/** What a forbidden span becomes when the replacement map did not already rewrite it. */
const REDACTION_MASK = "redacted";

/**
 * What a provider location's workspace LABEL becomes. Every committed location rule allows it, which
 * `src/__tests__/unit/knowledge/redaction.test.ts` pins, so a masked location no longer matches its own rule.
 */
export const LOCATION_MASK = "example";

/** The most masking passes one value gets before the redactor refuses rather than loop. */
const MAX_MASK_PASSES = 4;

/**
 * Pure: mask every span in one text, right to left, merging spans that overlap or touch into one mask.
 *
 * @param text the value the spans were found in
 * @param spans the scanner's spans over exactly that value
 * @returns the masked value — a merged run of provider-location labels alone takes {@link LOCATION_MASK}
 */
export function maskIdentifierSpans({ text, spans }: { text: string; spans: readonly IdentifierSpan[] }): string {
  const merged: { start: number; end: number; locationOnly: boolean }[] = [];
  for (const span of spans.toSorted((a, b) => a.offset - b.offset)) {
    const end = span.offset + span.length;
    const location = span.kind === "forbidden-provider-location";
    const last = merged.at(-1);
    if (last !== undefined && span.offset <= last.end) {
      last.end = Math.max(last.end, end);
      last.locationOnly = last.locationOnly && location;
      continue;
    }
    merged.push({ end, locationOnly: location, start: span.offset });
  }
  return merged.reduceRight(
    (current, { start, end, locationOnly }) =>
      current.slice(0, start) + (locationOnly ? LOCATION_MASK : REDACTION_MASK) + current.slice(end),
    text,
  );
}

/**
 * Pure: one value through the replacement map, then masked until the committed rules find nothing.
 *
 * @param text the value to redact
 * @param map the install's ordered rules — empty when it has none
 * @param scanner a scanner bound to the committed rules
 * @returns the redacted value, or `undefined` when masking stopped making progress with a span still standing
 */
export function redactText({
  text,
  map,
  scanner,
}: {
  text: string;
  map: readonly ReplacementRule[];
  scanner: IdentifierScanner;
}): string | undefined {
  let current = applyReplacementMap({ rules: map, text });
  for (let pass = 0; pass < MAX_MASK_PASSES; pass++) {
    const spans = scanner.spans({ content: current });
    if (spans.length === 0) {
      return current;
    }
    const masked = maskIdentifierSpans({ spans, text: current });
    if (masked === current) {
      return undefined;
    }
    current = masked;
  }
  return scanner.spans({ content: current }).length === 0 ? current : undefined;
}

/** A redaction planned over one batch of rows. */
export interface KnowledgeRedactionPlan<M extends RedactableMemory, R extends RedactableRecall> {
  /** Every recording, in input order — a redacted copy where any column changed, the input row itself where none did. */
  readonly memories: readonly M[];
  /** Every recall, in input order, the same way. */
  readonly recalls: readonly R[];
  /** How many recordings changed in any column. */
  readonly changedMemories: number;
  /** How many recalls changed in any column. */
  readonly changedRecalls: number;
  /** Every claim id that changes, old to new. */
  readonly idMap: readonly { readonly from: string; readonly to: string }[];
  /** How many old claims landed on an id another claim already carried — their recordings join one series. */
  readonly merges: number;
}

/** The running tally of fields a pass could not bring to zero, by field. */
type FailureTally = Map<KnowledgeReferenceField, number>;

/** One prose value redacted, its failure tallied rather than thrown, so the plan can name a field and a count. */
function redactProse({
  value,
  field,
  failures,
  map,
  scanner,
}: {
  value: string;
  field: KnowledgeReferenceField;
  failures: FailureTally;
  map: readonly ReplacementRule[];
  scanner: IdentifierScanner;
}): string {
  const redacted = redactText({ map, scanner, text: value });
  if (redacted !== undefined) {
    return redacted;
  }
  const seen = failures.get(field);
  failures.set(field, seen === undefined ? 1 : seen + 1);
  return value;
}

/**
 * Pure: plan a redaction over one batch — every recording and recall it holds, the claim ids that move, and the
 * proof that the result scans to zero.
 *
 * @param memories the recordings, in recorded order: a claim's LAST recording here derives its new id
 * @param recalls the recalls naming those claims
 * @param map the install's ordered replacement rules, empty when it has none
 * @param scanner a scanner bound to the committed rules
 * @returns the plan, or the refusal naming a field and a count
 */
export function planKnowledgeRedaction<M extends RedactableMemory, R extends RedactableRecall>({
  memories,
  recalls,
  map,
  scanner,
}: {
  memories: readonly M[];
  recalls: readonly R[];
  map: readonly ReplacementRule[];
  scanner: IdentifierScanner;
}): Result<KnowledgeRedactionPlan<M, R>, KnowledgeRedactionError> {
  const hit = ({ value }: { value: string | null }): boolean =>
    value !== null && scanner.spans({ content: value }).length > 0;
  const keyHits = memories.filter((row) => hit({ value: row.importKey })).length;
  if (keyHits > 0) {
    return err(KnowledgeRedactionErrors.identityHit({ field: "memories.import_key", rows: keyHits }));
  }
  const failures: FailureTally = new Map();
  const prose = ({ value, field }: { value: string; field: KnowledgeReferenceField }): string =>
    redactProse({ failures, field, map, scanner, value });
  const nullable = ({ value, field }: { value: string | null; field: KnowledgeReferenceField }): string | null =>
    value === null ? null : prose({ field, value });
  const rewritten = memories.map((row): M => ({
    ...row,
    behaviourChange: nullable({ field: "memories.behaviour_change", value: row.behaviourChange }),
    caveat: nullable({ field: "memories.caveat", value: row.caveat }),
    claim: prose({ field: "memories.claim", value: row.claim }),
    domain: prose({ field: "memories.domain", value: row.domain }),
    evidence: prose({ field: "memories.evidence", value: row.evidence }),
    learner: nullable({ field: "memories.learner", value: row.learner }),
    question: nullable({ field: "memories.question", value: row.question }),
    repro: nullable({ field: "memories.repro", value: row.repro }),
    retrievalCue: nullable({ field: "memories.retrieval_cue", value: row.retrievalCue }),
    run: prose({ field: "memories.run", value: row.run }),
  }));
  const { idMap, merges } = mapClaimIds({ after: rewritten, before: memories, hit });
  const moved = remapReferences({ hit, idMap, memories: rewritten, recalls, redactRecall: prose });
  if (moved.isErr()) {
    return err(moved.error);
  }
  const failure = [...failures.entries()][0];
  if (failure !== undefined) {
    return err(KnowledgeRedactionErrors.incomplete({ field: failure[0], rows: failure[1] }));
  }
  const unredacted = scanKnowledgeRows({ memories: moved.value.memories, recalls: moved.value.recalls, scanner });
  const residue = KNOWLEDGE_REFERENCE_FIELDS.find((field) => unredacted.byField[field] > 0);
  if (residue !== undefined) {
    return err(KnowledgeRedactionErrors.incomplete({ field: residue, rows: unredacted.byField[residue] }));
  }
  const finalMemories = moved.value.memories.map((row, index) => keepUnchanged({ input: memories[index]!, row }));
  const finalRecalls = moved.value.recalls.map((row, index) => keepUnchanged({ input: recalls[index]!, row }));
  return ok({
    changedMemories: finalMemories.filter((row, index) => row !== memories[index]).length,
    changedRecalls: finalRecalls.filter((row, index) => row !== recalls[index]).length,
    idMap: [...idMap.entries()].map(([from, to]) => ({ from, to })),
    memories: finalMemories,
    merges,
    recalls: finalRecalls,
  });
}

/** The input row itself when the redacted copy agrees with it in every field, so "unchanged" is identity. */
function keepUnchanged<T extends object>({ input, row }: { input: T; row: T }): T {
  return differs({ a: row, b: input }) ? row : input;
}

/** Whether two rows of one shape disagree in any own field. */
function differs<T extends object>({ a, b }: { a: T; b: T }): boolean {
  const right = new Map<string, unknown>(Object.entries(b));
  return Object.entries(a).some(([key, value]) => right.get(key) !== value);
}

/**
 * Where each claim goes, decided once from its latest recording: a claim whose latest domain or claim text the
 * redaction changed, or whose id itself carries a hit, takes the id its redacted text derives.
 *
 * @param before the recordings as they came in, in recorded order
 * @param after the same recordings with their prose redacted, in the same order
 * @param hit whether a value carries a forbidden identifier
 * @returns every moved claim, old id to new, and how many landed on an id another claim already carried
 */
function mapClaimIds({
  before,
  after,
  hit,
}: {
  before: readonly RedactableMemory[];
  after: readonly RedactableMemory[];
  hit: (args: { value: string | null }) => boolean;
}): { idMap: ReadonlyMap<string, string>; merges: number } {
  const latest = new Map<string, number>();
  before.forEach((row, index) => {
    latest.set(row.id, index);
  });
  const idMap = new Map<string, string>();
  const unmoved = new Set<string>();
  latest.forEach((index, id) => {
    const old = before[index]!;
    const now = after[index]!;
    if (old.domain === now.domain && old.claim === now.claim && !hit({ value: id })) {
      unmoved.add(id);
      return;
    }
    const derived = memoryId({ claim: now.claim, domain: now.domain, kind: now.kind });
    if (derived === id) {
      unmoved.add(id);
      return;
    }
    idMap.set(id, derived);
  });
  const landed = new Set(unmoved);
  let merges = 0;
  idMap.forEach((to) => {
    if (landed.has(to)) {
      merges += 1;
    }
    landed.add(to);
  });
  return { idMap, merges };
}

/**
 * Carry the id map into every column that names a claim, and redact each recall's prose.
 *
 * @param memories the recordings with their prose already redacted
 * @param recalls the recalls as they came in
 * @param idMap every moved claim, old id to new
 * @param hit whether a value carries a forbidden identifier
 * @param redactRecall the prose redactor, tallying its own failures
 * @returns both batches with every reference moved, or the refusal for a reference that carries a hit and is not
 *   in the batch, so cannot be moved
 */
function remapReferences<M extends RedactableMemory, R extends RedactableRecall>({
  memories,
  recalls,
  idMap,
  hit,
  redactRecall,
}: {
  memories: readonly M[];
  recalls: readonly R[];
  idMap: ReadonlyMap<string, string>;
  hit: (args: { value: string | null }) => boolean;
  redactRecall: (args: { value: string; field: KnowledgeReferenceField }) => string;
}): Result<{ memories: readonly M[]; recalls: readonly R[] }, KnowledgeRedactionError> {
  const stranded = ({ value }: { value: string | null }): boolean =>
    value !== null && !idMap.has(value) && hit({ value });
  const strandedTargets = memories.filter((row) => stranded({ value: row.supersedes })).length;
  if (strandedTargets > 0) {
    return err(KnowledgeRedactionErrors.identityHit({ field: "memories.supersedes", rows: strandedTargets }));
  }
  const strandedRecalls = recalls.filter((row) => stranded({ value: row.memoryId })).length;
  if (strandedRecalls > 0) {
    return err(KnowledgeRedactionErrors.identityHit({ field: "memory_recalls.memory_id", rows: strandedRecalls }));
  }
  const moved = ({ id }: { id: string }): string => {
    const to = idMap.get(id);
    if (to === undefined) {
      return id;
    }
    return to;
  };
  return ok({
    memories: memories.map((row): M => {
      const id = moved({ id: row.id });
      const target = row.supersedes === null ? null : moved({ id: row.supersedes });
      return { ...row, id, supersedes: target === id ? null : target };
    }),
    recalls: recalls.map((row): R => ({
      ...row,
      evidence: redactRecall({ field: "memory_recalls.evidence", value: row.evidence }),
      memoryId: moved({ id: row.memoryId }),
      run: redactRecall({ field: "memory_recalls.run", value: row.run }),
    })),
  });
}
