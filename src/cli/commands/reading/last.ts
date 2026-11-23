/**
 * `slopweaver reading last` — the latest reading one producer recorded, with its document.
 *
 * What every console page reads instead of running a slow verb itself. `--json` prints ONE object with
 * `observedAtIso` at the top level, which is the shape `site/lib/liveVerbs.ts` marks `stampsItsOwnTime`:
 * the tile stamps the reading with the instant it was TRUE, and the page adds who took it.
 *
 * "No reading yet" exits `EXIT_EXPECTED_EMPTY`, not `EXIT_ERROR`: the pipeline ran and the answer is a
 * legitimate absence a page shows in words. An unreadable index is `EXIT_ERROR`, because that is a store
 * we cannot see, and a page must never render it as empty.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { lastReading } from "../../../readings/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { flag, LAST_USAGE, parseReadingLastArgs, VERB_ARG_OFFSET } from "./core.js";

/** Everything `reading last` touches outside itself, injected so a test drives the whole verb. */
export interface ReadingLastDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `reading last` against injected seams.
 *
 * @param rest the argv tail after `reading last`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runReadingLast({ rest, deps }: { rest: readonly string[]; deps: ReadingLastDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LAST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseReadingLastArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LAST_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const producer = flag({ name: "producer", values });
  if (producer === undefined) {
    deps.writeDiagnostic("reading last: --producer is required");
    deps.writeDiagnostic(LAST_USAGE);
    return EXIT_USAGE;
  }
  const home = flag({ name: "home", values });
  const read = lastReading({ producer, ...(home === undefined ? {} : { home }) });
  if (read.isErr()) {
    deps.writeDiagnostic(`reading last: ${read.error.message}`);
    return read.error.code === "NO_READING" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  const { record, document } = read.value;
  if (values["json"] === true) {
    deps.writeOut(
      safeJsonStringify({
        label: `the last reading of ${record.producer}`,
        value: {
          by: record.by,
          bytes: record.bytes,
          document,
          observedAtIso: record.observedAtIso,
          producer: record.producer,
          readingId: record.readingId,
          recordedAtIso: record.recordedAtIso,
        },
      }),
    );
    return EXIT_OK;
  }
  deps.writeOut(
    `reading last: ${record.readingId} — ${record.producer} by ${record.by}, ${String(record.bytes)} bytes`,
  );
  deps.writeOut(`  true as of ${record.observedAtIso}, recorded ${record.recordedAtIso}`);
  return EXIT_OK;
}

/**
 * The real seams: the two output channels.
 *
 * @returns the production dependencies for {@link runReadingLast}
 */
export function productionReadingLastDeps(): ReadingLastDeps {
  return {
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver reading last`. */
export const readingLastCommand = defineCommand({
  run: (argv) => runReadingLast({ deps: productionReadingLastDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
