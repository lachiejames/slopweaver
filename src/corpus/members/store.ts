/**
 * The member-bronze persistence edge: **redact → fingerprint-dedup → append JSONL**, one file per source
 * (`members/<source>.jsonl`). Mirrors the record-bronze discipline: redaction runs first so no secret hits
 * disk, and dedup keys on a fingerprint computed over everything EXCEPT `fetchedAtIso`, so re-hydrating an
 * unchanged member writes nothing (idempotent) while a genuine profile change appends a new row.
 *
 * Every filesystem call goes through a `safe*` wrapper (typed {@link ../../lib/ingestError.IngestError}).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { slopweaverHome } from "../../config.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { appendAll } from "../../lib/arrays.js";
import { parseJsonObject } from "../../lib/jsonParse.js";
import { isOneOf, isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stableStringify } from "../../lib/stableStringify.js";
import { IDENTITY_SOURCES, type IdentitySource } from "../../silver/identity.js";
import { memberFile } from "../corpusPaths.js";
import { readJsonlRows } from "../corpusStore.js";
import { optStr as memberStr } from "../slack/shape.js";
import { readMemberIdentity, readMemberProfile } from "./read.js";
import { redactMemberRow } from "./redact.js";
import type { MemberBronzeRow } from "./types.js";

/**
 * The canonical JSONL serialisation of a member row (stable key order). Pure.
 *
 * @param row the row to serialise
 * @returns one JSONL line with the TOP-LEVEL keys in a fixed order. Nested values (`identity`, `profile` and `raw`) keep
 *   whatever key order they arrived with, so two rows carrying equal data are NOT guaranteed identical
 *   bytes — which is exactly why the fingerprint below uses a separate recursive canonicaliser rather than
 *   this function
 */
function serialiseMemberRow({ row }: { row: MemberBronzeRow }): string {
  return JSON.stringify({
    fetchedAtIso: row.fetchedAtIso,
    identity: row.identity,
    profile: row.profile,
    provenance: row.provenance,
    raw: row.raw,
    source: row.source,
    sourceId: row.sourceId,
    version: row.version,
    warnings: row.warnings,
  });
}

/**
 * Content fingerprint = a CANONICAL (key-sorted) serialisation with `fetchedAtIso` blanked. Canonical so a
 * row read back off disk (whose curated `identity`/`profile` are reconstructed in a different key order)
 * still fingerprints identically to the freshly-hydrated row — otherwise a re-hydrate would never dedup. Pure.
 *
 * @param row the row to fingerprint
 * @returns the fingerprint — `fetchedAtIso` is blanked, so re-fetching unchanged data does not look like a change
 */
export function memberFingerprint({ row }: { row: MemberBronzeRow }): string {
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
export function freshMemberRows({
  incoming,
  stored,
}: {
  incoming: readonly MemberBronzeRow[];
  stored: readonly MemberBronzeRow[];
}): readonly MemberBronzeRow[] {
  const seen = new Set(stored.map((row) => memberFingerprint({ row })));
  const fresh: MemberBronzeRow[] = [];
  for (const row of incoming) {
    const fingerprint = memberFingerprint({ row });
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      fresh.push(row);
    }
  }
  return fresh;
}

/**
 * Parse one JSONL line back into a member row, or the reason it was rejected. Defensive — `version 1`, a
 * known `source`, and a non-empty `sourceId`/`identity`/`profile` are required; `raw` is kept verbatim. Pure.
 *
 * @param line one JSONL line
 * @returns the decoded row, or a rejection reason
 */
export function parseMemberRow({ line }: { line: string }): { row: MemberBronzeRow } | { error: string } {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return { error: parsed.error.message };
  }
  const value = parsed.value;
  const source = value["source"];
  if (typeof source !== "string" || !isOneOf(source, IDENTITY_SOURCES)) {
    return { error: `unknown member source: ${String(source)}` };
  }
  const sourceId = memberStr({ value: value["sourceId"] });
  if (value["version"] !== 1 || sourceId === undefined || !isRecord(value["identity"]) || !isRecord(value["profile"])) {
    return { error: "missing required member field (version/sourceId/identity/profile)" };
  }
  return {
    row: {
      fetchedAtIso: typeof value["fetchedAtIso"] === "string" ? value["fetchedAtIso"] : "",
      identity: readMemberIdentity({ source, value: value["identity"] }),
      profile: readMemberProfile({ value: value["profile"] }),
      provenance: strArray({ value: value["provenance"] }),
      raw: value["raw"],
      source,
      sourceId,
      version: 1,
      warnings: strArray({ value: value["warnings"] }),
    },
  };
}

/** A string array off a raw field (non-strings dropped), else empty. Pure. */
function strArray({ value }: { value: unknown }): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Read a source's stored member rows (absent file ⇒ empty, never a throw).
 *
 * @param source which source's rows to read
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the rows and their parse warnings; a file that does not exist yields empty rather than throwing
 */
export function readMemberRows({ source, home = slopweaverHome() }: { source: IdentitySource; home?: string }): {
  rows: readonly MemberBronzeRow[];
  warnings: readonly string[];
} {
  const path = memberFile({ home, source });
  const read = readJsonlRows<MemberBronzeRow>({ parseLine: parseMemberRow, path });
  if (read.isErr()) {
    return read.error.code === "ENOENT" ? { rows: [], warnings: [] } : { rows: [], warnings: [read.error.message] };
  }
  return read.value;
}

/**
 * Read every source's stored member rows (for derive/identity — feeds the resolver + dossier).
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns every source's rows concatenated, plus every source's parse warnings
 */
export function readAllMembers({ home = slopweaverHome() }: { home?: string } = {}): {
  rows: readonly MemberBronzeRow[];
  warnings: readonly string[];
} {
  const rows: MemberBronzeRow[] = [];
  const warnings: string[] = [];
  for (const source of IDENTITY_SOURCES) {
    const read = readMemberRows({ home, source });
    appendAll({ from: read.rows, into: rows });
    appendAll({ from: read.warnings.map((w) => `members/${source}.jsonl: ${w}`), into: warnings });
  }
  return { rows, warnings };
}

/** The member-write outcome (mirrors the record writer's shape). */
export interface MemberWriteResult {
  readonly written: number;
  readonly deduped: number;
}

/**
 * Redact, dedup against what's stored, and append the fresh rows to `members/<source>.jsonl`.
 *
 * @param source the identity source
 * @param rows the freshly-hydrated rows
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the write stats, or a typed io error
 */
export function writeMemberRows({
  source,
  rows,
  home = slopweaverHome(),
}: {
  source: IdentitySource;
  rows: readonly MemberBronzeRow[];
  home?: string;
}): Result<MemberWriteResult> {
  const redacted = rows.map((row) => redactMemberRow({ row }));
  const stored = readMemberRows({ home, source }).rows;
  const fresh = freshMemberRows({ incoming: redacted, stored });
  if (fresh.length === 0) {
    return ok({ deduped: rows.length, written: 0 });
  }
  const path = memberFile({ home, source });
  const wrote = safeFs({
    execute: () => {
      mkdirSync(dirname(path), { recursive: true });
      appendLines({ path, text: `${fresh.map((row) => serialiseMemberRow({ row })).join("\n")}\n` });
    },
    operation: "writeMemberRows",
    path,
  });
  return wrote.isErr()
    ? err([wrote.error.message])
    : ok({ deduped: rows.length - fresh.length, written: fresh.length });
}
