/**
 * The sync-run ledger's rows — what one `slopweaver refresh` run of one corpus source started on, how far it has
 * got, what each bronze commit wrote per container, and how it finished.
 *
 * It exists because nothing else on disk can answer "what did this sync find". The supervisor stream carries one
 * source-level `written` per run, AFTER the run; a connector's progress heartbeats reach only the terminal; and
 * bronze cannot be read back for it, because a window file is addressed by date range, receives many runs'
 * appends, and is later folded into `compact.jsonl`. So a run that should say "found 120 new messages in
 * #incidents" has to write that down at the moment its commit returns — which is what `committed` is.
 *
 * One file per run (`./store.ts`), so a reader lists a directory and reads only the newest few runs rather than
 * scanning a register that grows for as long as the install runs.
 */
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";

/** The row format's version. A reader drops a row carrying any other. */
export const SYNC_RUN_SCHEMA_VERSION = 1;

/** One record kind's tally inside one commit: how many records were offered to bronze, and how many were new. */
export interface SyncKindCount {
  /** Offered to the bronze committer after the sync denylist — new plus already held. */
  readonly offered: number;
  /** New to bronze: appended by this commit. */
  readonly written: number;
}

/** The run began: which source, which process, and the window it was asked to read. */
export interface SyncRunStarted {
  readonly v: typeof SYNC_RUN_SCHEMA_VERSION;
  readonly type: "started";
  readonly runId: string;
  readonly source: string;
  readonly pid: number;
  readonly atIso: string;
  /** The window's first day, `YYYY-MM-DD`, exactly as the refresh planned it. */
  readonly since: string;
  /** The window's end day, `YYYY-MM-DD`, exclusive, exactly as the refresh planned it. */
  readonly until: string;
}

/**
 * One progress checkpoint, copied from the connector's own heartbeat — never computed here.
 *
 * `done`/`total` are absent when the connector did not report them, which is a different claim from zero.
 */
export interface SyncRunProgress {
  readonly v: typeof SYNC_RUN_SCHEMA_VERSION;
  readonly type: "progress";
  readonly runId: string;
  readonly atIso: string;
  /** The connector's sub-phase — `channel`, `repos`, `issues`, … */
  readonly phase: string;
  readonly done?: number;
  readonly total?: number;
  /** The container the connector named as being read at this checkpoint, when it named one. */
  readonly item?: string;
  /** The connector's cheap running counters at this checkpoint, verbatim. */
  readonly metrics: Readonly<Record<string, number>>;
}

/** One bronze commit's yield for one container, by record kind. */
interface SyncRunCommitted {
  readonly v: typeof SYNC_RUN_SCHEMA_VERSION;
  readonly type: "committed";
  readonly runId: string;
  readonly atIso: string;
  /** The record's own `container` — `slack/C0123`, a repository, a team. */
  readonly container: string;
  /** What a person calls it — the channel name a record carries, else the container. */
  readonly label: string;
  readonly kinds: Readonly<Record<string, SyncKindCount>>;
}

/** The run ended, with the totals the refresh itself reported and anything that went wrong. */
export interface SyncRunFinished {
  readonly v: typeof SYNC_RUN_SCHEMA_VERSION;
  readonly type: "finished";
  readonly runId: string;
  readonly atIso: string;
  readonly ok: boolean;
  readonly written: number;
  readonly deduped: number;
  readonly excluded: number;
  /** The refresh's own error lines for this source, verbatim. */
  readonly errors: readonly string[];
  readonly warnings: number;
  /** Coverage gaps the lane reported — non-zero means its cursor was held back. */
  readonly gaps: number;
  /** Ledger rows this run could not write. Non-zero means the record above under-reports this run. */
  readonly ledgerFailures: number;
}

/** Any row of a run file. */
export type SyncRunEvent = SyncRunStarted | SyncRunProgress | SyncRunCommitted | SyncRunFinished;

/**
 * One row as its single line.
 *
 * @param event the row to serialise
 * @returns the JSON line, without its newline
 */
export function syncRunEventLine({ event }: { event: SyncRunEvent }): string {
  return safeJsonStringify({ label: "sync-run event", value: event });
}

/** A field read as a non-negative safe integer, or `undefined` when it is anything else. */
function count({ value }: { value: unknown }): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/** A field read as a string, or `undefined` when it is anything else. */
function text({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A record of numbers, keeping only the entries that are safe non-negative integers. */
function numbers({ value }: { value: unknown }): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const n = count({ value: entry });
    if (n !== undefined) {
      out[key] = n;
    }
  }
  return out;
}

/** The per-kind tallies of a commit, or `undefined` when any entry is malformed. */
function kindCounts({ value }: { value: unknown }): Record<string, SyncKindCount> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, SyncKindCount> = {};
  for (const [kind, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const offered = count({ value: entry["offered"] });
    const written = count({ value: entry["written"] });
    if (offered === undefined || written === undefined) {
      return undefined;
    }
    out[kind] = { offered, written };
  }
  return out;
}

/** Decode the `started` arm, given the shared fields already validated. */
function startedOf({
  raw,
  runId,
  atIso,
}: {
  raw: Record<string, unknown>;
  runId: string;
  atIso: string;
}): SyncRunEvent | undefined {
  const source = text({ value: raw["source"] });
  const pid = count({ value: raw["pid"] });
  const since = text({ value: raw["since"] });
  const until = text({ value: raw["until"] });
  if (source === undefined || pid === undefined || since === undefined || until === undefined) {
    return undefined;
  }
  return { atIso, pid, runId, since, source, type: "started", until, v: SYNC_RUN_SCHEMA_VERSION };
}

/** Decode the `progress` arm, given the shared fields already validated. */
function progressOf({
  raw,
  runId,
  atIso,
}: {
  raw: Record<string, unknown>;
  runId: string;
  atIso: string;
}): SyncRunEvent | undefined {
  const phase = text({ value: raw["phase"] });
  const metrics = numbers({ value: raw["metrics"] });
  if (phase === undefined || metrics === undefined) {
    return undefined;
  }
  const done = count({ value: raw["done"] });
  const total = count({ value: raw["total"] });
  const item = text({ value: raw["item"] });
  return {
    atIso,
    metrics,
    phase,
    runId,
    type: "progress",
    v: SYNC_RUN_SCHEMA_VERSION,
    ...(done !== undefined ? { done } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(item !== undefined ? { item } : {}),
  };
}

/** Decode the `committed` arm, given the shared fields already validated. */
function committedOf({
  raw,
  runId,
  atIso,
}: {
  raw: Record<string, unknown>;
  runId: string;
  atIso: string;
}): SyncRunEvent | undefined {
  const container = text({ value: raw["container"] });
  const label = text({ value: raw["label"] });
  const kinds = kindCounts({ value: raw["kinds"] });
  if (container === undefined || label === undefined || kinds === undefined) {
    return undefined;
  }
  return { atIso, container, kinds, label, runId, type: "committed", v: SYNC_RUN_SCHEMA_VERSION };
}

/** Decode the `finished` arm, given the shared fields already validated. */
function finishedOf({
  raw,
  runId,
  atIso,
}: {
  raw: Record<string, unknown>;
  runId: string;
  atIso: string;
}): SyncRunEvent | undefined {
  const written = count({ value: raw["written"] });
  const deduped = count({ value: raw["deduped"] });
  const excluded = count({ value: raw["excluded"] });
  const warnings = count({ value: raw["warnings"] });
  const gaps = count({ value: raw["gaps"] });
  const ledgerFailures = count({ value: raw["ledgerFailures"] });
  const errors = raw["errors"];
  const okField = raw["ok"];
  const numbersPresent =
    written !== undefined &&
    deduped !== undefined &&
    excluded !== undefined &&
    warnings !== undefined &&
    gaps !== undefined &&
    ledgerFailures !== undefined;
  if (!numbersPresent || typeof okField !== "boolean" || !Array.isArray(errors)) {
    return undefined;
  }
  if (!errors.every((line): line is string => typeof line === "string")) {
    return undefined;
  }
  return {
    atIso,
    deduped,
    errors,
    excluded,
    gaps,
    ledgerFailures,
    ok: okField,
    runId,
    type: "finished",
    v: SYNC_RUN_SCHEMA_VERSION,
    warnings,
    written,
  };
}

/**
 * Decode one line, or `undefined` when it is not a row this version understands.
 *
 * A malformed line is dropped rather than failing the whole run file, and the reader COUNTS what it dropped, so
 * a damaged ledger shows up on the card as a number rather than as a run that quietly looks smaller.
 *
 * @param line one line of a run file
 * @returns the row, or `undefined`
 */
export function parseSyncRunEvent({ line }: { line: string }): SyncRunEvent | undefined {
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: "sync-run event", text: line });
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || raw["v"] !== SYNC_RUN_SCHEMA_VERSION) {
    return undefined;
  }
  const runId = text({ value: raw["runId"] });
  const atIso = text({ value: raw["atIso"] });
  if (runId === undefined || atIso === undefined) {
    return undefined;
  }
  switch (raw["type"]) {
    case "started":
      return startedOf({ atIso, raw, runId });
    case "progress":
      return progressOf({ atIso, raw, runId });
    case "committed":
      return committedOf({ atIso, raw, runId });
    case "finished":
      return finishedOf({ atIso, raw, runId });
    default:
      return undefined;
  }
}
