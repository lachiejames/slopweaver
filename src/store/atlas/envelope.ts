/**
 * Projecting one kind file's ENVELOPE — line 1, and the three tables that hang off it.
 *
 * Split from `./project.ts` along the seam the FORMAT already draws: line 1 of a kind file is a bounded
 * document describing the whole kind (its coverage cells, its gaps, its schema version) and every line
 * after it is one entity. The two halves share no helper that matters and no caller reads both at once —
 * `./read.ts` calls {@link projectEnvelope} exactly once per file and `projectEntity` once per line.
 *
 * ## What it refuses, and what it folds
 *
 * A malformed envelope refuses the whole KIND, because nothing after line 1 can be attributed without it
 * (`./errors.ts` carries why that is a different variant from a malformed entity). What it does not refuse
 * is a duplicate: a real estate holds tens of thousands of gap records that repeat a `(kind, id)` already in the same
 * array, every colliding group byte-identical, so {@link collapseGaps} folds them and REPORTS the count.
 * A silent fold would hide a defect in whatever writes `gaps[]` that nothing has ever counted.
 *
 * ## Nullability here is MEASURED
 *
 * `surface`, `role` and `visibilityScope` are optional on a coverage cell and `fields`/`surfaces` on a
 * gap, because hundreds of a real estate's cells and gap records omit one of them. Everything
 * else is required and refused when absent, since it is present on every record on disk —
 * `../schema/atlas.ts`'s § "Nullability here is MEASURED" carries the per-platform counts.
 */
import {
  ATLAS_COVERAGE_STATES,
  ATLAS_EVIDENCE_ROLES,
  type AtlasCoverageState,
  type AtlasEvidenceRole,
} from "../../atlas/kit/contract.js";
import { isOneOf, isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { NewAtlasCoverageRow, NewAtlasGapRow } from "../schema.js";

import { type AtlasImportError, AtlasImportErrors } from "./errors.js";
import { instant, numberField, optionalInstant, stringArrayField, stringField } from "./fields.js";

/** One kind file's envelope, projected into the rows three tables take. */
export interface ProjectedEnvelope {
  /**
   * The kind every entity after line 1 belongs to. Read from the envelope, never from the file name — the
   * file is `browser-pages.jsonl` and the kind is `browser-page`.
   */
  readonly kind: string;
  /** The envelope's `updatedAt` — which generation these rows came from. */
  readonly generationAt: Date;
  readonly schemaVersion: number | null;
  readonly readEpoch: string | null;
  readonly coverage: readonly NewAtlasCoverageRow[];
  readonly gaps: readonly NewAtlasGapRow[];
  /** How many gap records collapsed onto one already projected. See this module's header. */
  readonly gapsCollapsed: number;
}

/**
 * Collapse gap records that repeat a `(kind, id)` already seen, and say how many collapsed.
 *
 * MEASURED: a real estate's hundreds of envelopes carry tens of thousands of gap records of which
 * under a tenth are distinct under this key — one directory atlas's applications file alone repeats a handful
 * of distinct gaps dozens of times. Every colliding group is byte-identical (0 lossy collapses over the whole
 * estate), so the fold loses nothing; the COUNT
 * is what makes the writer's defect visible instead of absorbed.
 *
 * @param rows the gap rows one envelope projected, in document order
 * @returns the first row of each key, and how many were folded onto one
 */
export function collapseGaps({ rows }: { rows: readonly NewAtlasGapRow[] }): {
  rows: readonly NewAtlasGapRow[];
  collapsed: number;
} {
  const kept = new Map<string, NewAtlasGapRow>();
  let collapsed = 0;
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.gapId}`;
    if (kept.has(key)) {
      collapsed += 1;
      continue;
    }
    kept.set(key, row);
  }
  return { collapsed, rows: [...kept.values()] };
}

/**
 * Project one kind file's envelope.
 *
 * `platform` comes from the DIRECTORY, not from the envelope: a few of the several hundred envelopes carry no
 * `platform` field at all. Where one IS carried it is checked rather than read — it disagreed with the directory
 * on none of those that have it, and a disagreement would mean a generation was published into the wrong tree.
 *
 * @param envelope the parsed line 1
 * @param platform the directory this file was read from
 * @param path the file, for a refusal
 * @returns the kind, the generation instant and the coverage and gap rows, or why line 1 is unusable
 */
export function projectEnvelope({
  envelope,
  platform,
  path,
}: {
  envelope: unknown;
  platform: string;
  path: string;
}): Result<ProjectedEnvelope, AtlasImportError> {
  if (!isRecord(envelope)) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "it is not a JSON object", path }));
  }
  const kind = stringField({ from: envelope, key: "kind" });
  if (kind === null) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "it names no kind", path }));
  }
  const declared = stringField({ from: envelope, key: "platform" });
  if (declared !== null && declared !== platform) {
    return err(AtlasImportErrors.platformMismatch({ declared, directory: platform, path }));
  }
  const generationAt = instant({ field: "updatedAt", lineNumber: 1, path, value: envelope["updatedAt"] });
  if (generationAt.isErr()) {
    return err(generationAt.error);
  }

  const coverage = projectCoverageCells({ envelope, kind, path, platform });
  if (coverage.isErr()) {
    return err(coverage.error);
  }
  const gaps = projectGaps({ envelope, kind, path, platform });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  const folded = collapseGaps({ rows: gaps.value });

  return ok({
    coverage: coverage.value,
    gaps: folded.rows,
    gapsCollapsed: folded.collapsed,
    generationAt: generationAt.value,
    kind,
    readEpoch: stringField({ from: envelope, key: "readEpoch" }),
    schemaVersion: numberField({ from: envelope, key: "schemaVersion" }),
  });
}

/**
 * Project every coverage cell an envelope carries.
 *
 * @param envelope the parsed line 1
 * @param platform the directory this file was read from
 * @param kind the envelope's kind
 * @param path the file, for a refusal
 * @returns every cell's row, or the first refusal
 */
function projectCoverageCells({
  envelope,
  platform,
  kind,
  path,
}: {
  envelope: Record<string, unknown>;
  platform: string;
  kind: string;
  path: string;
}): Result<readonly NewAtlasCoverageRow[], AtlasImportError> {
  const cells = envelope["coverage"];
  const rows: NewAtlasCoverageRow[] = [];
  for (const cell of Array.isArray(cells) ? cells : []) {
    const row = projectCoverage({ cell, kind, path, platform });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  return ok(rows);
}

/**
 * Project every gap an envelope carries, before the duplicate fold.
 *
 * @param envelope the parsed line 1
 * @param platform the directory this file was read from
 * @param kind the envelope's kind
 * @param path the file, for a refusal
 * @returns every gap's row in document order, or the first refusal
 */
function projectGaps({
  envelope,
  platform,
  kind,
  path,
}: {
  envelope: Record<string, unknown>;
  platform: string;
  kind: string;
  path: string;
}): Result<readonly NewAtlasGapRow[], AtlasImportError> {
  const found = envelope["gaps"];
  const rows: NewAtlasGapRow[] = [];
  for (const gap of Array.isArray(found) ? found : []) {
    const row = projectGap({ gap, kind, path, platform });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  return ok(rows);
}

/**
 * Project one coverage cell.
 *
 * `surface`, `role` and `visibilityScope` are read as optional because hundreds of a real estate's cells omit
 * one of them — see `../schema/atlas.ts`'s § Nullability. `state` is not: a cell whose readability cannot
 * be read is the one thing coverage exists to say.
 *
 * @param cell the parsed cell
 * @param platform the directory
 * @param kind the envelope's kind
 * @param path the file, for a refusal
 * @returns the coverage row, or why it could not be read
 */
function projectCoverage({
  cell,
  platform,
  kind,
  path,
}: {
  cell: unknown;
  platform: string;
  kind: string;
  path: string;
}): Result<NewAtlasCoverageRow, AtlasImportError> {
  if (!isRecord(cell)) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "a coverage cell is not an object", path }));
  }
  const state = stringField({ from: cell, key: "state" });
  if (state === null) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "a coverage cell names no state", path }));
  }
  const scope = stringField({ from: cell, key: "scope" });
  if (scope === null) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "a coverage cell names no scope", path }));
  }
  // Present on every coverage cell in the estate, and it is the field that says WHY a
  // scope reads as it does — a cell without one is an unfalsifiable claim, so it is refused, not blanked.
  const reason = stringField({ from: cell, key: "reason" });
  if (reason === null) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "a coverage cell names no reason", path }));
  }
  const lastSuccessAt = optionalInstant({ field: "lastSuccessAt", lineNumber: 1, path, value: cell["lastSuccessAt"] });
  if (lastSuccessAt.isErr()) {
    return err(lastSuccessAt.error);
  }
  return ok({
    artifacts: Array.isArray(cell["artifacts"]) ? cell["artifacts"] : [],
    kind,
    lastSuccessAt: lastSuccessAt.value,
    latestAttemptFailed: cell["latestAttemptFailed"] === true,
    platform,
    reason,
    role: asEvidenceRole({ value: cell["role"] }),
    scope,
    state: asCoverageState({ value: state }),
    surface: stringField({ from: cell, key: "surface" }),
    unblockedBy: stringField({ from: cell, key: "unblockedBy" }),
    visibilityScope: stringField({ from: cell, key: "visibilityScope" }),
  });
}

/**
 * Project one gap record.
 *
 * @param gap the parsed record
 * @param platform the directory
 * @param kind the envelope's kind — the gap's own `kind` field is nullable and says which kind it is
 *   ABOUT, which is not always the file it was written in
 * @param path the file, for a refusal
 * @returns the gap row, or why it could not be read
 */
function projectGap({
  gap,
  platform,
  kind,
  path,
}: {
  gap: unknown;
  platform: string;
  kind: string;
  path: string;
}): Result<NewAtlasGapRow, AtlasImportError> {
  if (!isRecord(gap)) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "a gap is not an object", path }));
  }
  const gapId = stringField({ from: gap, key: "id" });
  if (gapId === null) {
    return err(AtlasImportErrors.unusableEnvelope({ field: "a gap names no id", path }));
  }
  const firstDetectedAt = instant({ field: "firstDetectedAt", lineNumber: 1, path, value: gap["firstDetectedAt"] });
  if (firstDetectedAt.isErr()) {
    return err(firstDetectedAt.error);
  }
  const lastDetectedAt = instant({ field: "lastDetectedAt", lineNumber: 1, path, value: gap["lastDetectedAt"] });
  if (lastDetectedAt.isErr()) {
    return err(lastDetectedAt.error);
  }
  const lastCheckedAt = optionalInstant({ field: "lastCheckedAt", lineNumber: 1, path, value: gap["lastCheckedAt"] });
  if (lastCheckedAt.isErr()) {
    return err(lastCheckedAt.error);
  }
  // `fields` and `surfaces` are the ONLY gap fields the estate omits (on a few platforms, datadog most)
  // and they are lists, where absent and empty say the same thing. Every other field below is present on
  // every record on disk, so an absent one is a shape nobody publishes — refused
  // rather than filled with an invented "open" or an empty reason that would read as a real one.
  const required = requiredGapFields({ gap, path });
  if (required.isErr()) {
    return err(required.error);
  }
  return ok({
    condition: required.value.condition,
    fields: stringArrayField({ from: gap, key: "fields" }),
    firstDetectedAt: firstDetectedAt.value,
    gapId,
    kind,
    lastCheckedAt: lastCheckedAt.value,
    lastDetectedAt: lastDetectedAt.value,
    platform,
    reason: required.value.reason,
    scope: required.value.scope,
    status: required.value.status,
    surfaces: stringArrayField({ from: gap, key: "surfaces" }),
  });
}

/**
 * The four gap fields that are `notNull` in the table and present on every record in the estate.
 *
 * Gathered in one function so {@link projectGap} reads as one decision rather than four, and so the
 * refusal names which of them was missing.
 *
 * @param gap the parsed record
 * @param path the file, for a refusal
 * @returns the four values, or which one was absent
 */
function requiredGapFields({
  gap,
  path,
}: {
  gap: Record<string, unknown>;
  path: string;
}): Result<{ condition: string; reason: string; scope: string; status: string }, AtlasImportError> {
  const found: Record<string, string> = {};
  for (const key of ["condition", "reason", "scope", "status"]) {
    const value = stringField({ from: gap, key });
    if (value === null) {
      return err(AtlasImportErrors.unusableEnvelope({ field: `a gap names no ${key}`, path }));
    }
    found[key] = value;
  }
  return ok({
    condition: found["condition"]!,
    reason: found["reason"]!,
    scope: found["scope"]!,
    status: found["status"]!,
  });
}

/**
 * Narrow a coverage state to the enum the column declares.
 *
 * The kit's {@link ATLAS_COVERAGE_STATES} is the vocabulary and `../schema/atlas.ts` generates the Postgres
 * enum from the same tuple, so an unknown label can only mean the atlas moved and this build did not. It is
 * mapped to `unreadable` rather than refused, because the CELL is still real — what the import cannot do is
 * invent an enum label the database has never heard of.
 *
 * @param value the label the document carried
 * @returns a label the column accepts
 */
function asCoverageState({ value }: { value: string }): AtlasCoverageState {
  return isOneOf(value, ATLAS_COVERAGE_STATES) ? value : "unreadable";
}

/**
 * Narrow an evidence role to the enum the column declares, treating an absent one as absent.
 *
 * @param value the label the document carried, when it carried one
 * @returns a label the column accepts, or `null`
 */
function asEvidenceRole({ value }: { value: unknown }): AtlasEvidenceRole | null {
  return typeof value === "string" && isOneOf(value, ATLAS_EVIDENCE_ROLES) ? value : null;
}
