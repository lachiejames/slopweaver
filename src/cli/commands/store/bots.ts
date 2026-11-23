/**
 * `slopweaver store bots` — derive `content.author_is_bot` for every row the store already holds.
 *
 * A verb rather than a step inside `store push`, for the reason `./edges.ts` gives: the migration that added
 * the column is a catalog change that finishes instantly, while flagging every row an integration posted is
 * a data pass that must be safe to interrupt and safe to run again. New rows never need it — the projection
 * writes the flag on ingest — so this is run once after the column lands, and again after a rule change.
 *
 * The pass is idempotent in both directions ({@link ../../../store/resolveBots}), so the operator
 * instruction is the short one: run it again.
 */

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { connectStore } from "../../../store/client.js";
import { type BotReport, resolveBots } from "../../../store/resolveBots.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";

/** The paging flag's name, read by both the spec and its refusal so the two cannot drift apart. */
const BATCH_FLAG = "batch";

/** What `store bots` accepts: which store, and how big a batch. */
const BOTS_FLAGS: FlagSpec = { boolean: ["json"], string: ["home", BATCH_FLAG] };

/** The flags `store bots` advertises, for the help-truth ratchet. */
export const STORE_BOTS_FLAG_NAMES: readonly string[] = ["--batch", "--home", "--json"];

/** The one usage line, shared with the manifest entry that describes this verb. */
export const BOTS_USAGE = "usage: slopweaver store bots [--batch <n>] [--home <dir>] [--json]";

/**
 * What a completed pass looks like as lines a person reads.
 *
 * Pure, so the property worth asserting — a pass that changed nothing still says what it scanned and what
 * the store holds — is checkable with no database.
 *
 * @param report what the pass did
 * @returns the report, one line each
 */
export function botLines({ report }: { report: BotReport }): readonly string[] {
  const total = report.bySource.reduce((sum, row) => sum + row.rows, 0);
  return [
    `scanned ${String(report.rowsScanned)} row(s); flagged ${String(report.flagged)} as bot-authored, cleared ${String(report.cleared)}`,
    `store now holds ${String(total)} bot-authored row(s)${total === 0 ? "" : ":"}`,
    ...report.bySource.map((row) => `  ${row.source.padEnd(9)} ${String(row.rows)}`),
  ];
}

/** A parsed `store bots` invocation: which store, and how big a batch. */
export interface StoreBotsArgs {
  readonly json: boolean;
  readonly batch?: number;
  readonly home?: string;
}

/**
 * Parse a bots invocation, refusing a batch size that is not a positive whole number.
 *
 * Pure and exported so the help-truth ratchet can probe every flag this verb advertises without a
 * database. Each absent flag is OMITTED rather than set to `undefined`, which `exactOptionalPropertyTypes`
 * makes a different thing from a supplied one.
 *
 * @param rest the flag tail
 * @returns what the pass should do, or every reason the invocation was refused
 */
export function parseStoreBotsArgs({ rest }: { rest: readonly string[] }): Result<StoreBotsArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: BOTS_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const rawBatch = values[BATCH_FLAG];
  const rawHome = values["home"];
  const base = { json: values["json"] === true, ...(typeof rawHome === "string" ? { home: rawHome } : {}) };
  if (typeof rawBatch !== "string") {
    return ok(base);
  }
  const batch = Number(rawBatch);
  if (!Number.isInteger(batch) || batch < 1) {
    return err(StoreCommandErrors.batchInvalid({ flag: BATCH_FLAG, got: rawBatch, usage: BOTS_USAGE }));
  }
  return ok({ ...base, batch });
}

/**
 * Derive the bot flag for every row in the store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreBots(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "bots" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BOTS_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreBotsArgs({ rest });
  if (args.isErr()) {
    storeCommandErrorLines({ error: args.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_USAGE;
  }
  const { batch, home, json } = args.value;
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  try {
    const report = await resolveBots({ client: opened.value, ...(batch === undefined ? {} : { batch }) });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    if (json) {
      logger.out({ line: safeJsonStringify({ label: "store bots", value: report.value }) });
      return EXIT_OK;
    }
    botLines({ report: report.value }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await opened.value.close();
  }
}

export const storeBotsCommand = defineCommand({ run: runStoreBots });
