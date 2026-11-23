/**
 * `slopweaver store import-owner-turn-dump` — the owner-turn record restored from a `pg_dump` keep.
 *
 * Verbs that restore data selectively are wanted. A keep of the
 * `owner_turn` and `owner_turn_location` tables is the one copy of turns whose files are gone, so this loads it
 * faithfully: the domain is `../../../store/ownerTurnDump/`, the write the same append-only `importOwnerTurns` the
 * `owner-turns` leg uses, and each row keeps the `first_imported_at` / `recorded_at` it was dumped with.
 *
 * All or nothing: one refused row writes nothing, because a keep loaded in part is a record nobody can describe.
 * `--dry-run` opens no connection, exactly as `store import-fleet`'s does.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { connectStore } from "../../../store/client.js";
import { importOwnerTurns } from "../../../store/fleet/ownerTurnStore.js";
import { readOwnerTurnDump } from "../../../store/ownerTurnDump/read.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { storeTail } from "./core.js";
import {
  type ImportOwnerTurnDumpReport,
  importOwnerTurnDumpLines,
  parseImportOwnerTurnDumpArgs,
} from "./importOwnerTurnDumpArgs.js";
import { IMPORT_OWNER_TURN_DUMP_USAGE } from "./importOwnerTurnDumpUsage.js";

/**
 * Print the report, as JSON or as lines.
 *
 * @param report what the load did
 * @param json whether `--json` was given
 */
function printReport({ report, json }: { report: ImportOwnerTurnDumpReport; json: boolean }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store import-owner-turn-dump report", value: report }) });
    return;
  }
  importOwnerTurnDumpLines({ report }).forEach((msg) => {
    logger.error({ msg });
  });
}

/**
 * Run the verb.
 *
 * @param argv the full process argv (`[node, cli, store, import-owner-turn-dump, …]`)
 * @returns the process exit code
 */
export async function runImportOwnerTurnDump(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: IMPORT_OWNER_TURN_DUMP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseImportOwnerTurnDumpArgs({ argv: rest });
  if (parsed.isErr()) {
    parsed.error.forEach((msg) => {
      logger.error({ msg });
    });
    logger.error({ msg: IMPORT_OWNER_TURN_DUMP_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = await readOwnerTurnDump({ path: args.from });
  if (read.isErr()) {
    logger.error({ msg: read.error.message });
    return EXIT_ERROR;
  }
  const { bodies, locations, refused } = read.value;
  const report: ImportOwnerTurnDumpReport = {
    bodies: bodies.length,
    bodiesWritten: 0,
    dryRun: args.dryRun,
    from: args.from,
    locations: locations.length,
    locationsWritten: 0,
    refused: refused.map((refusal) => refusal.message),
  };
  if (refused.length > 0 || args.dryRun) {
    printReport({ json: args.json, report });
    return refused.length > 0 ? EXIT_ERROR : EXIT_OK;
  }
  const opened = await connectStore(args.home === undefined ? {} : { home: args.home });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const written = await importOwnerTurns({ bodies, client, locations });
    if (written.isErr()) {
      logger.error({ msg: written.error.message });
      return EXIT_ERROR;
    }
    printReport({
      json: args.json,
      report: { ...report, bodiesWritten: written.value.bodies, locationsWritten: written.value.locations },
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

/** The verb, as the manifest loads it. */
export const storeImportOwnerTurnDumpCommand = defineCommand({ run: runImportOwnerTurnDump });
