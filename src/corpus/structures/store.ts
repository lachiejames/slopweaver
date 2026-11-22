/**
 * The structure-bronze persistence edge: **redact → fingerprint-dedup → append JSONL**, one file per source
 * (`structures/<source>.jsonl`). Mirrors the member-bronze discipline: redaction runs first so no secret hits
 * disk, and dedup keys on a fingerprint computed over everything EXCEPT `fetchedAtIso`, so re-hydrating an
 * unchanged entity writes nothing (idempotent) while a genuine change (a renamed channel, a new team member)
 * appends a new row. Every filesystem call goes through a `safe*` wrapper (typed {@link ../../lib/ingestError.IngestError}).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { slopweaverHome } from "../../config.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { appendAll } from "../../lib/arrays.js";
import { parseJsonObject } from "../../lib/jsonParse.js";
import { isOneOf } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stableStringify } from "../../lib/stableStringify.js";
import { IDENTITY_SOURCES, type IdentitySource } from "../../silver/identity.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { preflightCorpusAccesses } from "../corpusAccessGuard.js";
import { structureFile } from "../corpusPaths.js";
import { readJsonlRows } from "../corpusStore.js";
import { optStr as structureStr } from "../slack/shape.js";
import { readAttrs, readRelations, readStrArray, readStructureIdentity, STRUCTURE_KINDS } from "./read.js";
import { redactStructureRow } from "./redact.js";
import type { StructureBronzeRow, StructureKind } from "./types.js";

/**
 * The canonical JSONL serialisation of a structure row (stable key order). Pure.
 *
 * @param row the row to serialise
 * @returns one JSONL line with the TOP-LEVEL keys in a fixed order. Nested values (`attrs`, `identity`, `relations` and `raw`) keep
 *   whatever key order they arrived with, so two rows carrying equal data are NOT guaranteed identical
 *   bytes — which is exactly why the fingerprint below uses a separate recursive canonicaliser rather than
 *   this function
 */
function serialiseStructureRow({ row }: { row: StructureBronzeRow }): string {
  return JSON.stringify({
    attrs: row.attrs,
    fetchedAtIso: row.fetchedAtIso,
    identity: row.identity,
    kind: row.kind,
    provenance: row.provenance,
    raw: row.raw,
    relations: row.relations,
    source: row.source,
    sourceId: row.sourceId,
    version: row.version,
    warnings: row.warnings,
  });
}

/**
 * Content fingerprint = a CANONICAL (key-sorted) serialisation with `fetchedAtIso` blanked. Canonical so a
 * row read back off disk still fingerprints identically to the freshly-hydrated row — otherwise a re-hydrate
 * would never dedup. Pure.
 *
 * @param row the row to fingerprint
 * @returns the fingerprint — `fetchedAtIso` is blanked, so re-fetching unchanged data does not look like a change
 */
export function structureFingerprint({ row }: { row: StructureBronzeRow }): string {
  return stableStringify({ value: { ...row, fetchedAtIso: "" } });
}

/**
 * The subset of incoming rows worth writing — a NEW fingerprint versus what's already stored AND versus
 * earlier incoming rows (so a within-batch dup collapses too). Pure.
 *
 * @param incoming the freshly-hydrated rows
 * @param stored the rows already on disk for this source
 * @returns the rows to append, in input order
 */
export function freshStructureRows({
  incoming,
  stored,
}: {
  incoming: readonly StructureBronzeRow[];
  stored: readonly StructureBronzeRow[];
}): readonly StructureBronzeRow[] {
  const seen = new Set(stored.map((row) => structureFingerprint({ row })));
  const fresh: StructureBronzeRow[] = [];
  for (const row of incoming) {
    const fingerprint = structureFingerprint({ row });
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      fresh.push(row);
    }
  }
  return fresh;
}

/**
 * Parse one JSONL line back into a structure row, or the reason it was rejected. Defensive — `version 1`, a
 * known `source` + `kind`, and a non-empty `sourceId` are required; `raw` is kept verbatim. Pure.
 *
 * @param line one JSONL line
 * @returns the decoded row, or a rejection reason
 */
export function parseStructureRow({ line }: { line: string }): { row: StructureBronzeRow } | { error: string } {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return { error: parsed.error.message };
  }
  const value = parsed.value;
  const source = value["source"];
  if (typeof source !== "string" || !isOneOf(source, IDENTITY_SOURCES)) {
    return { error: `unknown structure source: ${String(source)}` };
  }
  const kind = value["kind"];
  if (typeof kind !== "string" || !isOneOf(kind, STRUCTURE_KINDS)) {
    return { error: `unknown structure kind: ${String(kind)}` };
  }
  const sourceId = structureStr({ value: value["sourceId"] });
  if (value["version"] !== 1 || sourceId === undefined) {
    return { error: "missing required structure field (version/sourceId)" };
  }
  return { row: decodeStructureRow({ kind, source, sourceId, value }) };
}

/** Build a validated {@link StructureBronzeRow} from a parsed line's already-checked scalars. Pure. */
function decodeStructureRow({
  value,
  source,
  kind,
  sourceId,
}: {
  value: Record<string, unknown>;
  source: IdentitySource;
  kind: StructureKind;
  sourceId: string;
}): StructureBronzeRow {
  return {
    attrs: readAttrs({ value: value["attrs"] }),
    fetchedAtIso: typeof value["fetchedAtIso"] === "string" ? value["fetchedAtIso"] : "",
    identity: readStructureIdentity({ value: value["identity"] }),
    kind,
    provenance: readStrArray({ value: value["provenance"] }),
    raw: value["raw"],
    relations: readRelations({ value: value["relations"] }),
    source,
    sourceId,
    version: 1,
    warnings: readStrArray({ value: value["warnings"] }),
  };
}

/**
 * Read a source's stored structure rows (absent file ⇒ empty, never a throw).
 *
 * @param source which source's rows to read
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the rows and their parse warnings; a file that does not exist yields empty rather than throwing
 */
export function readStructureRows({ source, home = slopweaverHome() }: { source: IdentitySource; home?: string }): {
  rows: readonly StructureBronzeRow[];
  warnings: readonly string[];
} {
  const path = structureFile({ home, source });
  const read = readJsonlRows<StructureBronzeRow>({ parseLine: parseStructureRow, path });
  if (read.isErr()) {
    return read.error.code === "ENOENT" ? { rows: [], warnings: [] } : { rows: [], warnings: [read.error.message] };
  }
  return read.value;
}

/**
 * Read every source's stored structure rows (for derive — feeds the silver directory/graph).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns every source's rows concatenated, plus every source's parse warnings
 */
export function readAllStructures({ home = slopweaverHome() }: { home?: string } = {}): {
  rows: readonly StructureBronzeRow[];
  warnings: readonly string[];
} {
  const rows: StructureBronzeRow[] = [];
  const warnings: string[] = [];
  for (const source of IDENTITY_SOURCES) {
    const read = readStructureRows({ home, source });
    appendAll({ from: read.rows, into: rows });
    appendAll({ from: read.warnings.map((w) => `structures/${source}.jsonl: ${w}`), into: warnings });
  }
  return { rows, warnings };
}

/** The structure-write outcome (mirrors the member writer's shape). */
export interface StructureWriteResult {
  readonly written: number;
  readonly deduped: number;
}

/**
 * Redact, dedup against what's stored, and append the fresh rows to `structures/<source>.jsonl`.
 *
 * @param source the identity source
 * @param rows the freshly-hydrated rows
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the write stats, the protect list's refusal (judged before the stored rows are read), or a typed io error
 */
export function writeStructureRows({
  source,
  rows,
  home = slopweaverHome(),
  protection,
}: {
  source: IdentitySource;
  rows: readonly StructureBronzeRow[];
  home?: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<StructureWriteResult> {
  const path = structureFile({ home, source });
  // Judged before the dedup read, which reads the very file this appends to.
  const judged = preflightCorpusAccesses({
    accesses: [{ access: "write", path }],
    home,
    operation: { target: `structures/${source}.jsonl`, verb: "write" },
    protection,
  });
  if (judged.isErr()) {
    return err(judged.error);
  }
  const redacted = rows.map((row) => redactStructureRow({ row }));
  const stored = readStructureRows({ home, source }).rows;
  const fresh = freshStructureRows({ incoming: redacted, stored });
  if (fresh.length === 0) {
    return ok({ deduped: rows.length, written: 0 });
  }
  const wrote = safeFs({
    execute: () => {
      mkdirSync(dirname(path), { recursive: true });
      appendLines({ path, text: `${fresh.map((row) => serialiseStructureRow({ row })).join("\n")}\n` });
    },
    operation: "writeStructureRows",
    path,
  });
  return wrote.isErr()
    ? err([wrote.error.message])
    : ok({ deduped: rows.length - fresh.length, written: fresh.length });
}
