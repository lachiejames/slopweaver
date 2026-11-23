/**
 * `slopweaver store edges` — derive every row's parent key, then point it at the row it names.
 *
 * A verb rather than a step inside `store push`, and the split is the design. A migration's job is the
 * SHAPE — `ALTER TABLE … ADD COLUMN` is a catalog change that finishes instantly on a table of any size —
 * while writing 796,261 edges is a data pass measured in minutes that must be safe to interrupt and safe
 * to run again. Folding the second into the first would make every future `store push` on any checkout
 * pay for it, and a `push` that half-applied would leave a database nobody could classify.
 *
 * Both halves are idempotent ({@link ../../../store/resolveEdges}), so the operator instruction is the
 * short one: run it again.
 */

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { connectStore } from "../../../store/client.js";
import { type EdgeReport, resolveEdges } from "../../../store/resolveEdges.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";

/** The paging flag's name, read by both the spec and its refusal so the two cannot drift apart. */
const BATCH_FLAG = "batch";

/** What `store edges` accepts: which store, how big a batch, and whether to stop after the keys. */
const EDGES_FLAGS: FlagSpec = { boolean: ["json", "keys-only"], string: ["home", BATCH_FLAG] };

/** The flags `store edges` advertises, for the help-truth ratchet. */
export const STORE_EDGES_FLAG_NAMES: readonly string[] = ["--batch", "--home", "--json", "--keys-only"];

/** The one usage line, shared with the manifest entry that describes this verb. */
export const EDGES_USAGE = "usage: slopweaver store edges [--keys-only] [--batch <n>] [--home <dir>] [--json]";

/**
 * What a completed pass looks like as lines a person reads.
 *
 * Pure, so the interesting property — that a pass which resolved nothing still says what it scanned, and
 * that dangling edges are reported as a re-resolvable REMAINDER rather than as a failure — is checkable
 * with no database.
 *
 * @param report what the pass did
 * @returns the report, one line each
 */
export function edgeLines({ report }: { report: EdgeReport }): readonly string[] {
  const resolvedTotal = report.totalEdges - report.dangling;
  return [
    `scanned ${report.rowsScanned} row(s); wrote ${report.keysWritten} parent key(s)`,
    `resolved ${report.edgesResolved} edge(s) this pass`,
    `store now holds ${report.totalEdges} edge(s): ${resolvedTotal} pointing at a row, ${report.dangling} naming a parent this store does not hold yet`,
    report.dangling === 0
      ? "nothing outstanding"
      : "a dangling edge is not a failure — it keeps its parent's natural key, so the next ingest of that parent resolves it here",
  ];
}

/** A parsed `store edges` invocation: which store, how big a batch, and where to stop. */
export interface StoreEdgesArgs {
  readonly json: boolean;
  readonly keysOnly: boolean;
  readonly batch?: number;
  readonly home?: string;
}

/**
 * Parse an edges invocation, refusing a batch size that is not a positive whole number.
 *
 * Pure and exported so the help-truth ratchet can probe every flag this verb advertises without a
 * database. Each absent flag is OMITTED rather than set to `undefined`, which `exactOptionalPropertyTypes`
 * makes a different thing from a supplied one.
 *
 * @param rest the flag tail
 * @returns what the pass should do, or every reason the invocation was refused
 */
export function parseStoreEdgesArgs({ rest }: { rest: readonly string[] }): Result<StoreEdgesArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: EDGES_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const rawBatch = values[BATCH_FLAG];
  const rawHome = values["home"];
  const base = {
    json: values["json"] === true,
    keysOnly: values["keys-only"] === true,
    ...(typeof rawHome === "string" ? { home: rawHome } : {}),
  };
  if (typeof rawBatch !== "string") {
    return ok(base);
  }
  const batch = Number(rawBatch);
  if (!Number.isInteger(batch) || batch < 1) {
    return err(StoreCommandErrors.batchInvalid({ flag: BATCH_FLAG, got: rawBatch, usage: EDGES_USAGE }));
  }
  return ok({ ...base, batch });
}

/**
 * Derive and resolve every thread edge in the store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreEdges(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "edges" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: EDGES_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreEdgesArgs({ rest });
  if (args.isErr()) {
    storeCommandErrorLines({ error: args.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_USAGE;
  }
  const { batch, home, json, keysOnly } = args.value;
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  try {
    const report = await resolveEdges({ client: opened.value, keysOnly, ...(batch === undefined ? {} : { batch }) });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    if (json) {
      logger.out({ line: safeJsonStringify({ label: "store edges", value: report.value }) });
      return EXIT_OK;
    }
    edgeLines({ report: report.value }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await opened.value.close();
  }
}

export const storeEdgesCommand = defineCommand({ run: runStoreEdges });
