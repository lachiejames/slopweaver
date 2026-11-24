/**
 * `slopweaver store tables`, `store rows` and `store row` — the read-only browsing verbs the console's Store page
 * reads through. Thin shells: parse (`./browseCore.ts`), read (`src/store/browse/read.ts`), print.
 *
 * With `--json` a refusal is printed on stdout as `{"error":{"code","message"}}` and the verb exits non-zero, so the
 * console can show the verb's own sentence instead of only an exit code. A usage refusal exits 2, a read that did not
 * answer exits 1.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { StoreBrowseError } from "../../../store/browse/errors.js";
import { readStoreRow, readStoreRows, readStoreTables } from "../../../store/browse/read.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseStoreRowArgs, parseStoreRowsArgs, parseStoreTablesArgs } from "./browseCore.js";
import { STORE_ROW_USAGE, STORE_ROWS_USAGE, STORE_TABLES_USAGE } from "./browseUsage.js";
import { storeTail } from "./core.js";
import { type StoreCommandError, storeCommandErrorLines } from "./errors.js";

/** Print a usage refusal, as JSON on stdout when asked for, else as lines on stderr with the usage. */
function refuseUsage({ error, json, usage }: { error: StoreCommandError; json: boolean; usage: string }): number {
  const lines = storeCommandErrorLines({ error });
  if (json) {
    logger.out({
      line: safeJsonStringify({
        label: "store browse refusal",
        value: { error: { code: error.code, message: lines.join("; ") } },
      }),
    });
    return EXIT_USAGE;
  }
  for (const line of lines) {
    logger.error({ msg: line });
  }
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/** Print a read's document or its refusal. */
function emit<T>({
  read,
  json,
  label,
  lines,
}: {
  read: Result<T, StoreBrowseError>;
  json: boolean;
  label: string;
  lines: (document: T) => readonly string[];
}): number {
  if (read.isErr()) {
    if (json) {
      logger.out({
        line: safeJsonStringify({ label, value: { error: { code: read.error.code, message: read.error.message } } }),
      });
    } else {
      logger.error({ msg: read.error.message });
    }
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: safeJsonStringify({ label, value: read.value }) });
    return EXIT_OK;
  }
  for (const line of lines(read.value)) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** Whether the tail asks for help. */
function wantsHelp({ rest }: { rest: readonly string[] }): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

/**
 * Run `store tables`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreTables(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantsHelp({ rest })) {
    logger.out({ line: STORE_TABLES_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreTablesArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ error: args.error, json: rest.includes("--json"), usage: STORE_TABLES_USAGE });
  }
  const read = await readStoreTables(args.value.home === undefined ? {} : { home: args.value.home });
  return emit({
    json: args.value.json,
    label: "store tables",
    lines: (document) =>
      document.tables.map((table) => {
        let rows = "never analysed";
        if (table.estimatedRows !== null) {
          rows = `~${String(table.estimatedRows)} rows`;
        }
        return `${table.name}  ${rows}  ${String(table.columns.length)} columns`;
      }),
    read,
  });
}

/**
 * Run `store rows`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreRows(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantsHelp({ rest })) {
    logger.out({ line: STORE_ROWS_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreRowsArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ error: args.error, json: rest.includes("--json"), usage: STORE_ROWS_USAGE });
  }
  const { home, request } = args.value;
  const read = await readStoreRows({ request, ...(home === undefined ? {} : { home }) });
  return emit({
    json: args.value.json,
    label: "store rows",
    lines: (document) => [
      `${document.table} page ${String(document.page)}: ${String(document.rows.length)} rows${document.hasNext ? ", more follow" : ""}`,
      "Pass --json for the values; this summary prints none.",
    ],
    read,
  });
}

/**
 * Run `store row`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreRow(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantsHelp({ rest })) {
    logger.out({ line: STORE_ROW_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreRowArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ error: args.error, json: rest.includes("--json"), usage: STORE_ROW_USAGE });
  }
  const { home, locatorHex } = args.value;
  const read = await readStoreRow({ locatorHex, ...(home === undefined ? {} : { home }) });
  return emit({
    json: args.value.json,
    label: "store row",
    lines: (document) => [
      `one row of ${document.table}, ${String(document.columns.length)} columns`,
      "Pass --json for the values; this summary prints none.",
    ],
    read,
  });
}

export const storeTablesCommand = defineCommand({ run: runStoreTables });
export const storeRowsCommand = defineCommand({ run: runStoreRows });
export const storeRowCommand = defineCommand({ run: runStoreRow });
