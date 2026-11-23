/**
 * `slopweaver atlas jam sync [--json] [--home <dir>]` — publish the compiled generation.
 *
 * It reaches nothing at all: every byte it writes comes from the tables committed under
 * `src/atlas/jam/generated/`, which `yarn tsx tools/generateJamSurfaces.ts` produced from Jam's own public
 * documents and its own servers' answers. So this needs no credential, makes no request, and writes only
 * under `$SLOPWEAVER_HOME`.
 *
 * What it REFUSES is a table whose route-probe control rows have stopped grading `not-routed`, because the
 * whole route surface rests on two 404s meaning different things — `sync.ts` carries the argument.
 */
import type { JamAtlasKind } from "../../../atlas/jam/model.js";
import { type JamSyncReport, syncJamAtlas } from "../../../atlas/jam/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Jam atlas verb sits: past the runtime, the script, the `atlas` noun and the `jam` platform. */
const JAM_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const JAM_SYNC_USAGE = "usage: slopweaver atlas jam sync [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** How many entities the sync published of one kind — zero when the report carries no row for it. */
function entitiesOfKind({ kind, report }: { kind: JamAtlasKind; report: JamSyncReport }): number {
  const row = report.entitiesByKind.findLast((entry) => entry.kind === kind);
  if (row === undefined) {
    return 0;
  }
  return row.entities;
}

/**
 * Print what the sync published, leading with the finding rather than with a bare total.
 *
 * @param asJson whether to print the whole report rather than the summary lines
 * @param report what the sync published
 *
 * @internal
 */
export function reportJamSync({ asJson, report }: { asJson: boolean; report: JamSyncReport }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return;
  }
  const count = ({ kind }: { kind: JamAtlasKind }): string => String(entitiesOfKind({ kind, report }));
  logger.out({
    line:
      `jam compiled surface — ${count({ kind: "operation" })} published operation(s), ` +
      `${count({ kind: "scope" })} declared scope(s), ${count({ kind: "route" })} probed ` +
      `route(s), ${count({ kind: "integration" })} published integration page(s)`,
  });
  logger.out({
    line: `  ${String(report.gaps)} gap(s) carried; read them with: slopweaver atlas jam coverage --open-only`,
  });
}

/**
 * Run the `atlas jam sync` verb.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function jamAtlasSyncCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: JAM_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JAM_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((reason) => {
      logger.error({ msg: reason });
    });
    logger.error({ msg: JAM_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const synced = syncJamAtlas({ at: new Date().toISOString(), home: options.value.home });
  if (synced.isErr()) {
    logger.error({ msg: synced.error.message });
    return EXIT_ERROR;
  }
  reportJamSync({ asJson: options.value.json, report: synced.value });
  return EXIT_OK;
}
