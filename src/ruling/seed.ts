/**
 * `ruling seed`'s pure half: give each ruling read from the state documents a stable key, read the seeding session's
 * decisions about them, and plan the rows to append.
 *
 * ## A key that survives an archive move
 *
 * A candidate's key is a digest of its date, anchor, context and exact words — never its file or line — so a block
 * folded from the state document into an archive is the same ruling, and a re-run of the seed appends nothing it
 * already appended. The same ruling copied forward into a later block collapses to one; so would a ruling the owner
 * genuinely gave twice in identical words on the same day, which is the stated price of that property.
 *
 * ## A category is not enough
 *
 * The documents hold rulings that replaced earlier ones. Seeded with only a category each, both would read current.
 * So every candidate gets a DECISION: its category, the ids it replaces, and whether it stands alongside the other
 * current rulings in its category. The seed plans candidates oldest first against the register as each lands, with
 * the same {@link planRulingRecord} a recorded ruling goes through, so a seeded ruling is held to the same rules.
 */
import { z } from "zod";

import { sha256Hex } from "#lib/hash.js";
import { parseJsonLine } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { type RulingError, RulingErrors } from "./errors.js";
import {
  planRulingRecord,
  RULING_CATEGORY,
  RULING_ID,
  type RulingProjection,
  type RulingRecord,
  withRuling,
} from "./registry.js";
import type { RulingSeedCandidate, RulingSeedScan } from "./sourceRows.js";

/** A candidate with the key and id it seeds under. */
export interface KeyedSeedCandidate extends RulingSeedCandidate {
  readonly seedKey: string;
  readonly id: string;
}

/** A candidate that repeats one already read, and where. */
export interface SeedDuplicate {
  readonly seedKey: string;
  readonly file: string;
  readonly line: number;
}

/** One seeding decision about one candidate. */
export interface RulingSeedDecision {
  readonly seedKey: string;
  readonly category: string;
  readonly replaces: readonly string[];
  readonly alongside: boolean;
}

/**
 * A candidate's stable key.
 *
 * @param candidate the ruling as read
 * @returns `seed-v1:` and the hex digest of its date, anchor, context and words
 */
export function seedKeyOf({ candidate }: { candidate: RulingSeedCandidate }): string {
  // An absent date, anchor or context keys as an empty field, so each part keeps its position in the digest.
  const parts = [candidate.decidedOn, candidate.anchor, candidate.context, candidate.words].map((part = "") => part);
  return `seed-v1:${sha256Hex({ bytes: parts.join("\u0000") })}`;
}

/**
 * The id a seeded ruling is filed under, derived from its key so a re-plan names the same id.
 *
 * @param seedKey the candidate's key
 * @returns `ruling-` and the key digest's first twelve hex digits
 */
export function seedIdOf({ seedKey }: { seedKey: string }): string {
  return `ruling-${seedKey.slice("seed-v1:".length, "seed-v1:".length + 12)}`;
}

/**
 * Every candidate across the scans, each once, oldest decision first and document order within a day.
 *
 * @param scans the documents read, in the order they were named
 * @returns the unique candidates, keyed, and every repeat that collapsed into one of them
 */
export function uniqueSeedCandidates({ scans }: { scans: readonly RulingSeedScan[] }): {
  readonly candidates: readonly KeyedSeedCandidate[];
  readonly duplicates: readonly SeedDuplicate[];
} {
  const byKey = new Map<string, KeyedSeedCandidate>();
  const duplicates: SeedDuplicate[] = [];
  for (const candidate of scans.flatMap((scan) => scan.candidates)) {
    const seedKey = seedKeyOf({ candidate });
    if (byKey.has(seedKey)) {
      duplicates.push({ file: candidate.file, line: candidate.line, seedKey });
    } else {
      byKey.set(seedKey, { ...candidate, id: seedIdOf({ seedKey }), seedKey });
    }
  }
  const candidates = [...byKey.values()].toSorted((a, b) => a.decidedOn.localeCompare(b.decidedOn));
  return { candidates, duplicates };
}

const DECISION_SCHEMA = z
  .object({
    alongside: z.boolean(),
    category: z.string().regex(RULING_CATEGORY),
    replaces: z.array(z.string().regex(RULING_ID)),
    seedKey: z.string().regex(/^seed-v1:[0-9a-f]{64}$/u),
  })
  .strict();

/**
 * Parse one line of a decisions file.
 *
 * @param line the line's text
 * @param lineNumber its 1-based position, named in an error
 * @returns the decision, or why the line is not one
 */
export function parseSeedDecisionLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<RulingSeedDecision, RulingError> {
  const json = parseJsonLine({ line });
  if (json.isErr()) {
    return err(RulingErrors.seedDecisionsInvalid({ why: `line ${String(lineNumber)}: ${json.error.message}` }));
  }
  const parsed = DECISION_SCHEMA.safeParse(json.value);
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(RulingErrors.seedDecisionsInvalid({ why: `line ${String(lineNumber)}: ${why}` }));
  }
  return ok(parsed.data);
}

/** What one apply would append, and what it left out because the register already holds it. */
export interface RulingSeedApplyPlan {
  readonly records: readonly RulingRecord[];
  readonly alreadyFiled: number;
}

/**
 * Plan the rows a seed appends: every candidate not already filed, under its decision, checked oldest first.
 *
 * @param projection the register as read under its lock
 * @param scans the source documents, read before the lock so a slow one never holds it
 * @param decisions the seeding session's decisions
 * @param recordedIso the instant every row is stamped with
 * @returns the rows to append in order, or the first reason the batch may not land — nothing is appended on a refusal
 */
export function planSeedApply({
  projection,
  scans,
  decisions,
  recordedIso,
}: {
  projection: RulingProjection;
  scans: readonly RulingSeedScan[];
  decisions: readonly RulingSeedDecision[];
  recordedIso: string;
}): Result<RulingSeedApplyPlan, RulingError> {
  const blockers = scans.flatMap((scan) => scan.blockers);
  if (blockers.length > 0) {
    const at = blockers.map((blocker) => `${blocker.file}:${String(blocker.line)} (${blocker.why})`).join("; ");
    return err(
      RulingErrors.seedDecisionsInvalid({ why: `${String(blockers.length)} row(s) could not be read: ${at}` }),
    );
  }
  const { candidates } = uniqueSeedCandidates({ scans });
  const byKey = indexDecisions({ candidates, decisions });
  if (byKey.isErr()) {
    return err(byKey.error);
  }
  const filed = new Set(projection.rows.flatMap((row) => (row.origin.kind === "seed" ? [row.origin.seedKey] : [])));
  const records: RulingRecord[] = [];
  let register = projection;
  for (const candidate of candidates.filter((each) => !filed.has(each.seedKey))) {
    const planned = planCandidate({ byKey: byKey.value, candidate, recordedIso, register });
    if (planned.isErr()) {
      return err(planned.error);
    }
    records.push(planned.value);
    register = withRuling({ projection: register, record: planned.value });
  }
  return ok({ alreadyFiled: candidates.length - records.length, records });
}

/** Each decision by its key, refusing two for one candidate or one for no candidate. */
function indexDecisions({
  candidates,
  decisions,
}: {
  candidates: readonly KeyedSeedCandidate[];
  decisions: readonly RulingSeedDecision[];
}): Result<ReadonlyMap<string, RulingSeedDecision>, RulingError> {
  const byKey = new Map<string, RulingSeedDecision>();
  for (const decision of decisions) {
    if (byKey.has(decision.seedKey)) {
      return err(RulingErrors.seedDecisionsInvalid({ why: `two decisions for ${decision.seedKey}` }));
    }
    byKey.set(decision.seedKey, decision);
  }
  const keys = new Set(candidates.map((candidate) => candidate.seedKey));
  const stray = decisions.find((decision) => !keys.has(decision.seedKey));
  if (stray !== undefined) {
    return err(
      RulingErrors.seedDecisionsInvalid({ why: `a decision for ${stray.seedKey}, which no source row holds` }),
    );
  }
  return ok(byKey);
}

/** One candidate planned under its decision against the register as the batch has left it. */
function planCandidate({
  candidate,
  byKey,
  register,
  recordedIso,
}: {
  candidate: KeyedSeedCandidate;
  byKey: ReadonlyMap<string, RulingSeedDecision>;
  register: RulingProjection;
  recordedIso: string;
}): Result<RulingRecord, RulingError> {
  const decision = byKey.get(candidate.seedKey);
  const where = `${candidate.file}:${String(candidate.line)}`;
  if (decision === undefined) {
    return err(RulingErrors.seedDecisionsInvalid({ why: `no decision for ${candidate.seedKey} (${where})` }));
  }
  const planned = planRulingRecord({
    input: {
      alongside: decision.alongside,
      ...(candidate.anchor === undefined ? {} : { anchor: candidate.anchor }),
      category: decision.category,
      ...(candidate.context === undefined ? {} : { context: candidate.context }),
      decidedOn: candidate.decidedOn,
      id: candidate.id,
      newCategory: !register.categories.includes(decision.category),
      origin: { file: candidate.file, kind: "seed", line: candidate.line, seedKey: candidate.seedKey },
      recordedIso,
      replaces: decision.replaces,
      words: candidate.words,
    },
    projection: register,
  });
  if (planned.isErr()) {
    return err(RulingErrors.seedDecisionsInvalid({ why: `${where} (${candidate.id}): ${planned.error.message}` }));
  }
  return ok(planned.value.record);
}
