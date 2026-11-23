/**
 * Running an atlas probe: the thin effectful shell over {@link ./probe}'s statements and folds.
 *
 * Everything that decides anything is pure and lives there. What is here is the per-keyword loop, the
 * instant-shaped column the driver hands back as a `Date`, and the mapping of a driver throw into the
 * store's own typed error.
 *
 * It takes a {@link StoreReader} rather than opening a connection, for the same reason `../probe/run.ts`
 * does: `slopweaver store detect` already has one open when it reaches this, and a second pool for a
 * two-second probe is a second thing that can fail.
 */
import type { SQL } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreReader } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { numberOf, optionalText, requireText } from "../probe/rows.js";

import {
  type AtlasProbeCell,
  type AtlasProbeHolding,
  type AtlasProbeReport,
  type AtlasProbeRow,
  atlasCellsStatement,
  atlasHoldingsStatement,
  atlasPlatformNamesStatement,
  atlasTotalStatement,
} from "./probe.js";

/** What one atlas probe invocation was asked for. */
export interface AtlasProbePlan {
  /** The question's keywords, exactly as the caller typed them. */
  readonly terms: readonly string[];
  /** Restrict to one platform, or the whole estate. */
  readonly platform: string | null;
  /** How many `(platform, kind)` cells to keep per keyword. */
  readonly cells: number;
}

/**
 * What a probe needs from the store: one statement in, its rows out.
 *
 * A named seam rather than the whole {@link StoreReader} because it is what makes this module TESTABLE at
 * all — `StoreReader.db` is a full drizzle `PgDatabase`, which a unit test can only supply by casting, and
 * this repository's testing rule says to inject a plain function instead of reaching for a mock. The two
 * real callers both build one with {@link readerExecute}; a test passes its own.
 */
export type AtlasProbeExecute = (statement: SQL) => Promise<Iterable<Record<string, unknown>>>;

/**
 * The seam a live connection satisfies.
 *
 * @param reader the open store connection
 * @returns a function running one statement against it
 */
export function readerExecute({ reader }: { reader: StoreReader }): AtlasProbeExecute {
  return async (statement) => reader.db.execute(statement);
}

/**
 * Read an instant column back, whatever shape the driver handed it in.
 *
 * `timestamp with time zone` arrives as a `Date` under drizzle's `mode: "date"` and as a string through a
 * raw `execute`, and this statement is raw. Both are answered rather than one being assumed, because the
 * failure of assuming is a `lastSuccessAtIso` that reads `null` on every row while the column is full —
 * a staleness warning that silently never fires, which is worse than not carrying one.
 *
 * @param row one row as the driver returned it
 * @param key which column
 * @returns the instant as ISO-8601, or nothing when the column is null
 */
function instantOf({ row, key }: { row: Record<string, unknown>; key: string }): string | null {
  const value = row[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  const text = optionalText({ key, row });
  if (text === null) {
    return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

/**
 * Count one keyword's cells and the platforms its own name reaches.
 *
 * @param execute what runs a statement against the store
 * @param term the keyword
 * @param platform restrict to one platform, or the whole estate
 * @param cells how many cells to keep
 * @returns the keyword's row
 */
async function probeTerm({
  execute,
  term,
  platform,
  cells,
}: {
  execute: AtlasProbeExecute;
  term: string;
  platform: string | null;
  cells: number;
}): Promise<AtlasProbeRow> {
  const startedMs = Date.now();
  const cellRows = await execute(atlasCellsStatement({ limit: cells, platform, term }));
  const nameRows = await execute(atlasPlatformNamesStatement({ term }));
  const found: AtlasProbeCell[] = [...cellRows].map((row) => ({
    byDetail: numberOf({ key: "byDetail", row }),
    byName: numberOf({ key: "byName", row }),
    entities: numberOf({ key: "entities", row }),
    kind: requireText({ key: "kind", row }),
    lastAttemptOutcome: optionalText({ key: "lastAttemptOutcome", row }),
    lastSuccessAtIso: instantOf({ key: "lastSuccessAt", row }),
    platform: requireText({ key: "platform", row }),
  }));
  return {
    cells: found,
    elapsedMs: Date.now() - startedMs,
    platformNames: [...nameRows].map((row) => requireText({ key: "platform", row })),
    subject: term,
  };
}

/**
 * What each platform holds, for the keyword-less SCOPE read.
 *
 * It carries `plan.platform` through for the reason review pass r1 found: the report's header is built
 * from that field, so a scope read that ignored it printed one atlas's name above the whole estate.
 *
 * @param execute what runs a statement against the store
 * @param platform restrict to one platform, or the whole estate
 * @returns one entry per platform the store holds entity rows for, widest first
 */
async function probeHoldings({
  execute,
  platform,
}: {
  execute: AtlasProbeExecute;
  platform: string | null;
}): Promise<readonly AtlasProbeHolding[]> {
  const rows = await execute(atlasHoldingsStatement({ platform }));
  return [...rows].map((row) => ({
    entities: numberOf({ key: "entities", row }),
    kinds: numberOf({ key: "kinds", row }),
    lastSuccessAtIso: instantOf({ key: "lastSuccessAt", row }),
    platform: requireText({ key: "platform", row }),
  }));
}

/**
 * Probe the atlas tables for a question's keywords.
 *
 * @param execute what runs a statement against the store
 * @param plan the keywords, the platform restriction and the cell cap
 * @returns the report, or the store's own typed failure
 */
export async function runAtlasProbe({
  execute,
  plan,
}: {
  execute: AtlasProbeExecute;
  plan: AtlasProbePlan;
}): Promise<Result<AtlasProbeReport, StoreError>> {
  const startedMs = Date.now();
  try {
    const totalRows = await execute(atlasTotalStatement());
    const first = [...totalRows][0];
    const atlasEntities = first === undefined ? 0 : numberOf({ key: "rows", row: first });
    // The keyword-less SCOPE read and the keyword read are exclusive rather than additive: a keyword probe
    // never pays for the grouped count, and a scope read has no keyword to fan. See `./probe.ts`'s
    // `AtlasProbeReport.holdings` for why that is the split rather than always filling both.
    const holdings = plan.terms.length === 0 ? await probeHoldings({ execute, platform: plan.platform }) : [];
    const rows: AtlasProbeRow[] = [];
    for (const term of plan.terms) {
      rows.push(await probeTerm({ cells: plan.cells, execute, platform: plan.platform, term }));
    }
    return ok({
      atlasEntities,
      elapsedMs: Date.now() - startedMs,
      holdings,
      platform: plan.platform,
      rows,
    });
  } catch (cause: unknown) {
    return err(StoreErrors.queryFailed({ cause, what: "atlas probe" }));
  }
}
