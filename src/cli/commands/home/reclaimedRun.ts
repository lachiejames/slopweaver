/**
 * `slopweaver home reclaimed` — the reading half of the reclaim rail.
 *
 * A reclaim is not reversible, so the rail cannot be `sweep restore`'s. What it is instead: every run is
 * journalled with the count of distinct contents that survived it and whether the post-apply witness held,
 * so a later reader can answer "what did that run take, and did it prove it lost nothing" without having to
 * trust the session that ran it. A ledger nothing reads is not a rail, it is a file; this is the reading.
 */
import { renderReclaimRow } from "../../../home/reclaim/journalRow.js";
import { readReclaimLedger, reclaimLedgerPath } from "../../../home/reclaim/journalStore.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseHomeReclaimedArgs, RECLAIMED_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** Everything `home reclaimed` touches outside itself, injected so a test drives the whole verb. */
export interface HomeReclaimedDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `home reclaimed` against injected seams.
 *
 * @param rest the argv tail after `home reclaimed`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runHomeReclaimed({ rest, deps }: { rest: readonly string[]; deps: HomeReclaimedDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECLAIMED_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHomeReclaimedArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(RECLAIMED_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: typeof values["home"] === "string" ? values["home"] : undefined });
  const rows = readReclaimLedger({ path: reclaimLedgerPath({ home }) });
  if (rows.isErr()) {
    deps.writeDiagnostic(`home reclaimed: ${rows.error.message}`);
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    rows.value.forEach((row) => {
      deps.writeOut(safeJsonStringify({ label: "a reclaim ledger row", value: row }));
    });
    return EXIT_OK;
  }
  if (rows.value.length === 0) {
    deps.writeOut("home reclaimed: nothing has been reclaimed on this install.");
    return EXIT_OK;
  }
  deps.writeOut(`home reclaimed: ${String(rows.value.length)} run(s)`);
  rows.value.forEach((row) => {
    deps.writeOut(renderReclaimRow({ row }));
  });
  return EXIT_OK;
}

/**
 * The real seams: the two output channels.
 *
 * @returns the production dependencies for {@link runHomeReclaimed}
 */
export function productionHomeReclaimedDeps(): HomeReclaimedDeps {
  return {
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver home reclaimed`. */
export const homeReclaimedCommand = defineCommand({
  run: (argv) => runHomeReclaimed({ deps: productionHomeReclaimedDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
