/**
 * `slopweaver reading list` — every index row, oldest first.
 *
 * Reads local state and nothing else. `--json` emits one row per line rather than one array, which is the
 * `whole-file-json` rule rather than a style: the index grows for as long as the install runs.
 */
import { logger } from "#lib/logger.js";
import { producerSlug } from "../../../readings/row.js";
import { readReadingIndex } from "../../../readings/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { flag, LIST_USAGE, parseReadingListArgs, VERB_ARG_OFFSET } from "./core.js";

/** Everything `reading list` touches outside itself, injected so a test drives the whole verb. */
export interface ReadingListDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `reading list` against injected seams.
 *
 * @param rest the argv tail after `reading list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runReadingList({ rest, deps }: { rest: readonly string[]; deps: ReadingListDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LIST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseReadingListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LIST_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = flag({ name: "home", values });
  const index = readReadingIndex(home === undefined ? {} : { home });
  if (index.isErr()) {
    deps.writeDiagnostic(`reading list: ${index.error.message}`);
    return EXIT_ERROR;
  }
  const producer = flag({ name: "producer", values });
  const rows =
    producer === undefined
      ? index.value
      : index.value.filter((row) => producerSlug({ producer: row.producer }) === producerSlug({ producer }));
  if (values["json"] === true) {
    rows.forEach((row) => {
      deps.writeOut(JSON.stringify(row));
    });
    return EXIT_OK;
  }
  if (rows.length === 0) {
    deps.writeOut("reading list: the ledger holds no readings that match");
    return EXIT_OK;
  }
  rows.forEach((row) => {
    deps.writeOut(`${row.recordedAtIso}  ${row.by}  ${row.producer}  ${String(row.bytes)} bytes  ${row.readingId}`);
  });
  return EXIT_OK;
}

/**
 * The real seams: the two output channels.
 *
 * @returns the production dependencies for {@link runReadingList}
 */
export function productionReadingListDeps(): ReadingListDeps {
  return {
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver reading list`. */
export const readingListCommand = defineCommand({
  run: (argv) => runReadingList({ deps: productionReadingListDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
