/**
 * `slopweaver sweep list` — what the sweep has actually taken, and on what evidence.
 *
 * The published page's one rail is that a deletion is journalled so it can be FOUND afterwards. A ledger
 * nothing reads is not that rail, it is a file; this verb is the reading half, and it is the answer to "what
 * did the sweep take" without a session having to know where the ledger lives.
 *
 * Each act prints its verdict, its witness and the exact register verb line it ran, so a reader can re-derive
 * the act without opening the run journal it landed in.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { renderJournalRow, type SweepJournalRow } from "../../../sweep/journalRow.js";
import { readSweepLedger, sweepLedgerPath } from "../../../sweep/journalStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { flag, LIST_USAGE, parseSweepListArgs, VERB_ARG_OFFSET } from "./core.js";

/** Everything `sweep list` touches outside itself, injected so a test drives the whole verb. */
export interface SweepListDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `sweep list` against injected seams.
 *
 * @param rest the argv tail after `sweep list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runSweepList({ rest, deps }: { rest: readonly string[]; deps: SweepListDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LIST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseSweepListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LIST_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const ledger = sweepLedgerPath({ home: resolveHome({ named: flag({ name: "home", values }) }) });
  const rows = readSweepLedger({ path: ledger });
  if (rows.isErr()) {
    deps.writeDiagnostic(`sweep list: ${rows.error.message}`);
    return EXIT_ERROR;
  }
  const shown = selectRows({ rows: rows.value, slug: flag({ name: "slug", values }) });
  if (values["json"] === true) {
    shown.forEach((row) => {
      deps.writeOut(safeJsonStringify({ label: "a sweep ledger row", value: row }));
    });
    return EXIT_OK;
  }
  if (shown.length === 0) {
    deps.writeOut("sweep list: no acts recorded.");
    return EXIT_OK;
  }
  deps.writeOut(`sweep list: ${String(shown.length)} act(s)`);
  shown.forEach((row) => {
    deps.writeOut(renderJournalRow({ row }));
  });
  return EXIT_OK;
}

/**
 * Narrow the ledger to one row's history, when the caller named one.
 *
 * @param rows every act, oldest first
 * @param slug the board row to filter to, or undefined for all of them
 * @returns the acts to print
 */
function selectRows({
  rows,
  slug,
}: {
  rows: readonly SweepJournalRow[];
  slug: string | undefined;
}): readonly SweepJournalRow[] {
  if (slug === undefined) {
    return rows;
  }
  return rows.filter((row) => row.slug === slug);
}

/**
 * The real seams: the two output channels.
 *
 * @returns the production dependencies for {@link runSweepList}
 */
export function productionSweepListDeps(): SweepListDeps {
  return {
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver sweep list`. */
export const sweepListCommand = defineCommand({
  run: (argv) => runSweepList({ deps: productionSweepListDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
