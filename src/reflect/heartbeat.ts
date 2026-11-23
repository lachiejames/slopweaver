/**
 * THE HEARTBEAT — one frozen-schema row per run of the reflection loop, whether or not it found anything.
 *
 * `$SLOPWEAVER_HOME/ledgers/reflect/heartbeat.jsonl`, append-only, same pure-line / effectful-append split
 * as `./seen.ts`.
 *
 * ## Why the schema is frozen and the freeze is a test
 *
 * The previous attempt at this loop wrote a free-form heartbeat. It drifted to 180+ distinct keys across
 * 125 rows, at which point no program could read it and the only thing anybody could do with a year of
 * self-observation was grep it. So the shape is a Zod schema, {@link HEARTBEAT_KEYS} names every key it may
 * carry, and a unit test asserts the two agree. Adding a field is then a deliberate edit in two places
 * rather than something a run can do by writing one.
 *
 * ## Why a run that found nothing still writes one
 *
 * "No confirmable friction this window, nothing to propose" is a good pass, and silence is never evidence
 * of correctness. A row per run is what separates a quiet day from a day the loop did not run, and those
 * two are indistinguishable in every ledger that only records findings.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import type { ReflectBrief } from "./brief.js";
import { REFLECT_SOURCES } from "./finding.js";
import { reflectLedgerDir } from "./seen.js";

/**
 * Every key a heartbeat row may carry, frozen.
 *
 * The list a test compares the Zod schema against. It is exported rather than internal so the test reads
 * the contract instead of a copy of it.
 */
export const HEARTBEAT_KEYS = [
  "schemaVersion",
  "tsIso",
  "windowFromIso",
  "windowToIso",
  "sources",
  "candidates",
  "surfaced",
  "backlogged",
  "suppressed",
  "couldNotVerify",
] as const;

/**
 * One source's contribution to a run, so a collector that stopped producing is visible as a zero.
 *
 * @internal
 */
export const heartbeatSourceSchema = z.object({
  findings: z.number().int().nonnegative(),
  rowsRead: z.number().int().nonnegative(),
  source: z.enum(REFLECT_SOURCES),
});

/** The frozen row shape. `strict` so an extra key is a parse failure rather than silent drift. */
export const heartbeatSchema = z
  .object({
    backlogged: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
    couldNotVerify: z.array(z.string()),
    schemaVersion: z.literal(1),
    sources: z.array(heartbeatSourceSchema),
    suppressed: z.number().int().nonnegative(),
    surfaced: z.number().int().nonnegative(),
    tsIso: z.string(),
    windowFromIso: z.string(),
    windowToIso: z.string(),
  })
  .strict();

/** One heartbeat row, as the loop builds it before rendering. */
export type HeartbeatRow = z.infer<typeof heartbeatSchema>;

/**
 * Build the heartbeat row for a brief. One row per run, whatever the run found.
 *
 * @param brief the run's brief
 * @returns the frozen-schema row to append
 */
export function heartbeatFor({ brief }: { brief: ReflectBrief }): HeartbeatRow {
  return {
    backlogged: brief.backlog.length,
    candidates: brief.surfaced.length + brief.backlog.length,
    couldNotVerify: [...brief.couldNotVerify],
    schemaVersion: 1,
    sources: brief.sources.map((source) => ({
      findings: source.findings,
      rowsRead: source.rowsRead,
      source: source.source,
    })),
    suppressed: brief.suppressed,
    surfaced: brief.surfaced.length,
    tsIso: brief.tsIso,
    windowFromIso: brief.window.fromIso,
    windowToIso: brief.window.toIso,
  };
}

/**
 * Render one heartbeat row as its JSONL line, refusing a row the frozen schema does not accept.
 *
 * Validating on the way OUT rather than only on the way in is the whole mechanism: a row that drifts never
 * reaches the file, so the ledger cannot acquire a key the schema does not know about.
 *
 * @param row the row to render
 * @returns the JSON line with no trailing newline, or every reason the row was refused
 */
export function heartbeatLine({ row }: { row: HeartbeatRow }): Result<string> {
  const parsed = heartbeatSchema.safeParse(row);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `heartbeat ${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(JSON.stringify(parsed.data));
}

/**
 * Append one heartbeat row, creating the ledger directory if needed. The effectful edge over
 * {@link heartbeatLine}, and it fails loudly for the same reason `recordSeen` does — a run with no
 * heartbeat is indistinguishable from a run that never happened.
 *
 * @param row the row to append
 * @param home the state home (defaults to the resolved home)
 * @returns nothing on success, or every reason the row was not written
 */
export function recordHeartbeat({ row, home }: { row: HeartbeatRow; home?: string }): Result<string> {
  const line = heartbeatLine({ row });
  if (line.isErr()) {
    return line;
  }
  const dir = reflectLedgerDir(home !== undefined ? { home } : {});
  const written = safeFs({
    execute: (): string => {
      mkdirSync(dir, { recursive: true });
      appendLines({ path: join(dir, "heartbeat.jsonl"), text: `${line.value}\n` });
      return line.value;
    },
    operation: "append reflect heartbeat",
    path: dir,
  });
  return written.isOk() ? ok(written.value) : err([written.error.message]);
}
