/**
 * `slopweaver dev dedup-index` — measure what the bronze writer's dedup index HOLDS, against the corpus on
 * disk.
 *
 * This is the verb that keeps `DEDUP_INDEX_BYTES_PER_RECORD` honest. The writer's index build guards itself
 * with that constant, and a constant that was MEASURED rots as the index's shape changes. Run this against
 * the real corpus whenever it moves, and the exit code says whether the shipped number still covers what the
 * index actually retains.
 *
 * It runs the same build a refresh runs — {@link buildBronzeDedupIndex} over one source's whole bronze tree
 * — holding the finished index live, exactly as a committer holds it, and reads the heap after a forced full
 * collection either side. Effectful shell only; the arithmetic and the rendering are {@link ./dedupIndexCore}.
 */
import { buildBronzeDedupIndex } from "../../../corpus/bronzeDedupIndex.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { collectGarbage, readHeap } from "../../../lib/heapBudget.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  DEV_DEDUP_INDEX_USAGE,
  type DedupIndexSample,
  dedupConstantHolds,
  deriveDedupIndexCost,
  parseDedupSource,
  parseDevDedupIndexArgs,
  renderDedupIndexCost,
} from "./dedupIndexCore.js";

/** Force a full collection, then read live heap — the one way to get a live-set number rather than a peak. */
function settle(): number {
  collectGarbage();
  return readHeap().usedBytes;
}

/** Build one source's index and read the heap either side of it, keeping the index live across the reading. */
function measure({ home, source }: { home: string; source: CorpusSource }): DedupIndexSample {
  const startedAt = performance.now();
  const startBytes = settle();
  const built = buildBronzeDedupIndex({ home, source });
  // Read the heap with the index STILL REFERENCED — a build whose result had already gone out of scope
  // would measure the collector, not the index.
  const heldBytes = settle();
  const ids = built.index.newestTs.size;
  return {
    diskBytes: built.diskBytes,
    elapsedMs: performance.now() - startedAt,
    fileCount: built.fileCount,
    heldBytes,
    ids,
    limitBytes: readHeap().limitBytes,
    refused: built.shortfall !== undefined,
    rows: built.rows,
    source,
    startBytes,
    unreadable: built.unreadable,
  };
}

/** Parse the flag tail and the source it names, reporting every usage error through the logger. */
function parseOrReportUsage({
  rest,
  log,
}: {
  rest: readonly string[];
  log: Pick<Logger, "error">;
}): { home: string | undefined; json: boolean; source: CorpusSource } | undefined {
  const parsed = parseDevDedupIndexArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, DEV_DEDUP_INDEX_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  const { values } = parsed.value;
  const source = parseDedupSource({ value: typeof values["source"] === "string" ? values["source"] : undefined });
  if (source.isErr()) {
    [...source.error, DEV_DEDUP_INDEX_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  return {
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    source: source.value,
  };
}

/**
 * Run the dedup-index verb over an injected logger — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev dedup-index <tail>`)
 * @param log the diagnostic + data sinks
 * @returns EXIT_OK when the shipped constant covers a complete measurement, EXIT_ERROR when it
 *   under-projects or the source could not be fully indexed, EXIT_USAGE on a bad flag
 */
export function runDevDedupIndexWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_DEDUP_INDEX_USAGE });
    return EXIT_OK;
  }
  const args = parseOrReportUsage({ log, rest });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const cost = deriveDedupIndexCost({
    sample: measure({ home: resolveHome({ named: args.home }), source: args.source }),
  });
  if (args.json) {
    log.out({ line: JSON.stringify(cost) });
  } else {
    for (const line of renderDedupIndexCost({ cost })) {
      log.out({ line });
    }
  }
  return dedupConstantHolds({ cost }) ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run the dedup-index verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev dedup-index <tail>`)
 * @returns the process exit code — see {@link runDevDedupIndexWithDeps}
 */
export function runDevDedupIndex(argv: readonly string[]): number {
  return runDevDedupIndexWithDeps({ argv, log: logger });
}

export const devDedupIndexCommand = defineCommand({ run: runDevDedupIndex });
