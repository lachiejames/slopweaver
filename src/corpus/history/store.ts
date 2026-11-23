/**
 * The history-store persistence edge: **null-strip → redact → canonicalise → sort → identity-dedup → append
 * JSONL**, one file per source (`history/<source>.jsonl`).
 *
 * Mirrors the member/structure discipline, with two deliberate differences:
 *
 *  - **Dedup is by IDENTITY, not by content fingerprint.** An event is immutable, so `(source, stream,
 *    subjectId, eventId)` fully determines it. That makes a retried or overlapping refresh idempotent without
 *    canonically re-serialising ~192,000 rows on every write.
 *  - **Rows are SORTED before they are written**, by `(tsIso, eventId)`. Linear returns history in descending
 *    `createdAt` and `orderBy` exists but its direction is not selectable, so arrival order is incidental and
 *    must not be trusted; sorting here means the file on disk has one canonical order whatever order the crawl
 *    happened to see. `eventId` breaks a same-instant tie so the order is TOTAL — otherwise two events sharing
 *    a timestamp could swap places between runs over identical data.
 *
 * Every filesystem call goes through a `safe*` wrapper (typed {@link ../../lib/ingestError.IngestError}).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { slopweaverHome } from "../../config.js";
import { CORPUS_SOURCES } from "../../integrations/corpusSources.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { appendAll } from "../../lib/arrays.js";
import { parseJsonObject } from "../../lib/jsonParse.js";
import { isOneOf, isRecord } from "../../lib/parsers.js";
import { containmentRefusal } from "../../lib/pathContainment.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { historyDir, historyFile } from "../corpusPaths.js";
import { readJsonlRows } from "../corpusStore.js";
import { escapeLineTerminators } from "../recordSerialisation.js";
import { redactSecrets } from "../redact.js";
import { optStr as reqStr } from "../slack/shape.js";
import { type CorpusSource } from "../types.js";
import { HISTORY_STREAMS, type HistoryEventRow, type HistoryStream } from "./types.js";

/**
 * Recursively drop `null` and `undefined` — from object values AND array entries — and key-sort what remains.
 *
 * This is the 3.5× reduction. Linear's `IssueHistory` has an 80-field `from*`/`to*` shape and returns an
 * explicit `null` for every field an event did not touch, so 71.2% of the measured payload bytes were nulls:
 * ~98 MB raw against ~27.9 MB stripped, over one workspace's ~192,000 events.
 *
 * Key-sorting is not cosmetic. It makes the serialisation canonical, so the same event captured twice produces
 * byte-identical output whatever order the API happened to emit its fields in. Pure.
 *
 * @param value any JSON value
 * @returns the same value with null/undefined removed and object keys sorted
 */
export function stripNulls({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map((item) => stripNulls({ value: item }));
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    const inner = value[key];
    if (inner === null || inner === undefined) {
      continue;
    }
    out[key] = stripNulls({ value: inner });
  }
  return out;
}

/** Recursively scrub secret classes from every string leaf, preserving structure + keys. Pure. */
function redactValue({ value }: { value: unknown }): unknown {
  if (typeof value === "string") {
    return redactSecrets({ text: value }).text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue({ value: item }));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = redactValue({ value: inner });
    }
    return out;
  }
  return value;
}

/**
 * Scrub one event before it is written. The org's own identifiers — teammate display names, team keys, project
 * names — ARE the capture and are kept verbatim: this store lives off-repo under `$SLOPWEAVER_HOME`, and the
 * public leak gate scans the repository, not the home. What is scrubbed is the secret CLASSES (tokens, long
 * digit runs) that can hide in a payload's string leaves. Pure.
 *
 * @param row the event row
 * @returns the row with secret classes removed from its payload
 */
export function redactHistoryRow({ row }: { row: HistoryEventRow }): HistoryEventRow {
  const changes = redactValue({ value: row.changes });
  return { ...row, changes: isRecord(changes) ? changes : {} };
}

/**
 * The canonical JSONL serialisation of one event row (stable key order). Pure.
 *
 * @param row the event row to serialise
 * @returns one JSONL line with the TOP-LEVEL keys in a fixed order; nested values keep whatever key order
 *   they arrived with, so equal data is not guaranteed identical bytes
 */
export function serialiseHistoryRow({ row }: { row: HistoryEventRow }): string {
  return JSON.stringify({
    actor: row.actor,
    changes: row.changes,
    container: row.container,
    eventId: row.eventId,
    source: row.source,
    stream: row.stream,
    subjectId: row.subjectId,
    tsIso: row.tsIso,
    version: row.version,
  });
}

/**
 * An event's logical identity — the dedup key. Joined by an escaped NUL, which cannot occur in any component,
 * so two different tuples can never collide into one key. Pure.
 *
 * @param row the event row
 * @returns the identity key
 */
export function historyIdentity({ row }: { row: HistoryEventRow }): string {
  return `${row.source}\u0000${row.stream}\u0000${row.subjectId}\u0000${row.eventId}`;
}

/**
 * Sort events into the store's canonical order: ascending `tsIso`, then `eventId` to break a same-instant tie.
 *
 * A TOTAL order, on purpose. Linear's arrival order is descending and not selectable, so it is incidental; and
 * a partial order would let two events sharing a timestamp swap places between two runs over identical data,
 * which would make the file's bytes non-deterministic for no reason. Pure.
 *
 * @param rows the events to order
 * @returns a new array in canonical order
 */
export function sortHistoryRows({ rows }: { rows: readonly HistoryEventRow[] }): readonly HistoryEventRow[] {
  return rows.toSorted((left, right) =>
    left.tsIso === right.tsIso ? left.eventId.localeCompare(right.eventId) : left.tsIso.localeCompare(right.tsIso),
  );
}

/**
 * The subset of incoming events worth writing: a NEW identity versus what is stored AND versus earlier
 * incoming rows (so a within-batch duplicate collapses too), returned in canonical order. Pure.
 *
 * @param incoming the freshly-fetched events
 * @param stored the events already on disk for this source
 * @returns the events to append, in canonical order
 */
export function freshHistoryRows({
  incoming,
  stored,
}: {
  incoming: readonly HistoryEventRow[];
  stored: readonly HistoryEventRow[];
}): readonly HistoryEventRow[] {
  const seen = new Set(stored.map((row) => historyIdentity({ row })));
  const fresh: HistoryEventRow[] = [];
  for (const row of incoming) {
    const key = historyIdentity({ row });
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(row);
    }
  }
  return sortHistoryRows({ rows: fresh });
}

/**
 * Parse one JSONL line back into an event row, or the reason it was rejected. Defensive — `version 1`, a known
 * `source` + `stream`, and non-empty `subjectId`/`eventId` are required. Pure.
 *
 * @param line one JSONL line
 * @returns the decoded row, or a rejection reason
 */
export function parseHistoryRow({ line }: { line: string }): { row: HistoryEventRow } | { error: string } {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return { error: parsed.error.message };
  }
  const value = parsed.value;
  const source = value["source"];
  if (typeof source !== "string" || !isOneOf(source, CORPUS_SOURCES)) {
    return { error: `unknown history source: ${String(source)}` };
  }
  const stream = value["stream"];
  if (typeof stream !== "string" || !isOneOf(stream, HISTORY_STREAMS)) {
    return { error: `unknown history stream: ${String(stream)}` };
  }
  const subjectId = reqStr({ value: value["subjectId"] });
  const eventId = reqStr({ value: value["eventId"] });
  if (value["version"] !== 1 || subjectId === undefined || eventId === undefined) {
    return { error: "missing required history field (version/subjectId/eventId)" };
  }
  return { row: decodeHistoryRow({ eventId, source, stream, subjectId, value }) };
}

/** Build a validated {@link HistoryEventRow} from a parsed line's already-checked scalars. Pure. */
function decodeHistoryRow({
  value,
  source,
  stream,
  subjectId,
  eventId,
}: {
  value: Record<string, unknown>;
  source: CorpusSource;
  stream: HistoryStream;
  subjectId: string;
  eventId: string;
}): HistoryEventRow {
  const actor = reqStr({ value: value["actor"] });
  const changes = value["changes"];
  return {
    changes: isRecord(changes) ? changes : {},
    container: typeof value["container"] === "string" ? value["container"] : "",
    eventId,
    source,
    stream,
    subjectId,
    tsIso: typeof value["tsIso"] === "string" ? value["tsIso"] : "",
    version: 1,
    ...(actor !== undefined ? { actor } : {}),
  };
}

/**
 * Read one source's stored events (absent file ⇒ empty, never a throw).
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the rows + per-line warnings
 */
export function readHistoryRows({ source, home = slopweaverHome() }: { source: CorpusSource; home?: string }): {
  rows: readonly HistoryEventRow[];
  warnings: readonly string[];
} {
  const path = historyFile({ home, source });
  const read = readJsonlRows<HistoryEventRow>({ parseLine: parseHistoryRow, path });
  if (read.isErr()) {
    return read.error.code === "ENOENT" ? { rows: [], warnings: [] } : { rows: [], warnings: [read.error.message] };
  }
  return read.value;
}

/**
 * Read every source's stored events.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the rows + per-file warnings
 */
export function readAllHistory({ home = slopweaverHome() }: { home?: string } = {}): {
  rows: readonly HistoryEventRow[];
  warnings: readonly string[];
} {
  const rows: HistoryEventRow[] = [];
  const warnings: string[] = [];
  for (const source of CORPUS_SOURCES) {
    const read = readHistoryRows({ home, source });
    appendAll({ from: read.rows, into: rows });
    appendAll({ from: read.warnings.map((w) => `history/${source}.jsonl: ${w}`), into: warnings });
  }
  return { rows, warnings };
}

/** The history-write outcome (mirrors the member/structure writers' shape). */
export interface HistoryWriteResult {
  readonly written: number;
  readonly deduped: number;
}

/**
 * Redact, identity-dedup against what is stored, and append the fresh events to `history/<source>.jsonl` in
 * canonical order.
 *
 * @param source the corpus source
 * @param rows the freshly-fetched events
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the write stats, or a typed io error
 */
export function writeHistoryRows({
  source,
  rows,
  home = slopweaverHome(),
}: {
  source: CorpusSource;
  rows: readonly HistoryEventRow[];
  home?: string;
}): Result<HistoryWriteResult> {
  const redacted = rows.map((row) => redactHistoryRow({ row }));
  const stored = readHistoryRows({ home, source }).rows;
  const fresh = freshHistoryRows({ incoming: redacted, stored });
  if (fresh.length === 0) {
    return ok({ deduped: rows.length, written: 0 });
  }
  const path = historyFile({ home, source });
  // The store's separation from bronze is lexical, so it holds for the path we COMPUTE and not for the path the
  // filesystem RESOLVES. A symlink here would put activity events under `bronze/`, where the record reader
  // would pick them up — the exact outcome the sibling store exists to prevent. Refuse rather than write.
  const refusal = containmentRefusal({ path, root: historyDir({ home }) });
  if (refusal !== undefined) {
    return err([refusal]);
  }
  const wrote = safeFs({
    execute: () => {
      mkdirSync(dirname(path), { recursive: true });
      appendLines({
        path,
        text: `${fresh.map((row) => escapeLineTerminators({ json: serialiseHistoryRow({ row }) })).join("\n")}\n`,
      });
    },
    operation: "writeHistoryRows",
    path,
  });
  return wrote.isErr()
    ? err([wrote.error.message])
    : ok({ deduped: rows.length - fresh.length, written: fresh.length });
}
