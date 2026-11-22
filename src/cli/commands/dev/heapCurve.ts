/**
 * `slopweaver dev heap-curve` — measure what a whole-corpus pass HOLDS, against the corpus on disk.
 *
 * This is the verb that keeps the heap guard honest. The guard projects a load from `HEAP_BYTES_PER_DISK_BYTE`,
 * which was MEASURED, and a measurement rots as the record shape and the reader change. Run this against the
 * real corpus whenever either moves, and the exit code says whether the shipped coefficient still covers what
 * a whole-corpus pass actually retains.
 *
 * It loads the corpus the way `derive`, `distil` and `compact` load it — holding the records live, exactly
 * as those passes do — and reads the heap after a forced full collection at each boundary. Effectful shell
 * only; the arithmetic and the rendering are {@link ./heapCurveCore}.
 *
 * It used to carry three more phases: the prebuilt BM25 index, an in-heap retrieval index over the records,
 * and the prebuilt vector index. All three are gone, so what is left is the
 * one phase every surviving whole-corpus pass shares.
 */
import { resolveCorpusScan } from "../../../corpus/corpusResolve.js";
import { type CorpusProjection } from "../../../corpus/corpusRowCore.js";
import { collectGarbage, readHeap } from "../../../lib/heapBudget.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { loadCorpus } from "../../../retrieval/loadCorpus.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  coefficientsCover,
  DEV_HEAP_CURVE_USAGE,
  deriveHeapCurve,
  type HeapCurveSample,
  type HeapPhase,
  parseDevHeapCurveArgs,
  parseProjection,
  renderHeapCurve,
} from "./heapCurveCore.js";

/** Force a full collection, then read the heap — the one way to get a live-set number rather than a peak. */
function settle({ phase, startedAt }: { phase: HeapPhase["phase"]; startedAt: number }): HeapPhase {
  collectGarbage();
  const reading = readHeap();
  return {
    elapsedMs: performance.now() - startedAt,
    externalBytes: reading.externalBytes,
    liveBytes: reading.usedBytes,
    phase,
  };
}

/**
 * Load the corpus and read the heap on both sides of it, keeping the records live across the reading.
 *
 * `records` is held until the sample is complete rather than allowed to fall out of scope, because the
 * number this verb exists to produce is what a pass HOLDS: a load measured after its own result became
 * collectable reports the heap of a program that has already finished.
 */
function measure({
  home,
  corpus,
  projection,
}: {
  home: string;
  corpus: string | undefined;
  projection: CorpusProjection;
}): { sample: HeapCurveSample; warnings: readonly string[] } | string {
  const startedAt = performance.now();
  const resolved = resolveCorpusScan({ home, ...(corpus !== undefined ? { corpus } : {}) });
  if (resolved.isErr()) {
    return resolved.error.message;
  }
  const scan = resolved.value;
  const phases: HeapPhase[] = [settle({ phase: "start", startedAt })];
  const loaded = loadCorpus({
    home,
    nowIso: new Date().toISOString(),
    projection,
    ...(corpus !== undefined ? { corpus } : {}),
  });
  if (loaded.isErr()) {
    return loaded.error.message;
  }
  const records = loaded.value.records;
  phases.push(settle({ phase: "records", startedAt }));
  return {
    sample: {
      corpusDir: scan.dir,
      diskBytes: scan.diskBytes,
      fileCount: scan.fileCount,
      limitBytes: readHeap().limitBytes,
      phases,
      projection,
      recordCount: records.length,
    },
    // The load's own warnings, which name every path the protect list kept out of its walk; the resolution's copy
    // of those same skips is not added, so each is said once.
    warnings: loaded.value.warnings,
  };
}

/**
 * Parse the flag tail and the projection it names, reporting every usage error through the logger.
 * Split out so the shell below stays a plain parse → measure → render sequence.
 */
function parseOrReportUsage({
  rest,
  log,
}: {
  rest: readonly string[];
  log: Pick<Logger, "error">;
}): { home: string | undefined; corpus: string | undefined; json: boolean; projection: CorpusProjection } | undefined {
  const parsed = parseDevHeapCurveArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, DEV_HEAP_CURVE_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  const { values } = parsed.value;
  const projection = parseProjection({
    value: typeof values["projection"] === "string" ? values["projection"] : undefined,
  });
  if (projection.isErr()) {
    projection.error.forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  return {
    corpus: typeof values["corpus"] === "string" ? values["corpus"] : undefined,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    projection: projection.value,
  };
}

/**
 * Run the heap-curve verb over an injected logger — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev heap-curve <tail>`)
 * @param log the diagnostic + data sinks
 * @returns EXIT_OK when the shipped coefficients cover the measurement, EXIT_ERROR when one under-projects
 *   or the corpus could not be loaded, EXIT_USAGE on a bad flag
 */
export async function runDevHeapCurveWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out" | "warn">;
}): Promise<number> {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_HEAP_CURVE_USAGE });
    return EXIT_OK;
  }
  const args = parseOrReportUsage({ log, rest });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const measured = measure({
    corpus: args.corpus,
    home: resolveHome({ named: args.home }),
    projection: args.projection,
  });
  if (typeof measured === "string") {
    log.error({ msg: measured });
    return EXIT_ERROR;
  }
  // A curve measured over a tree the protect list partly kept out is short by those paths, so they are said.
  for (const msg of measured.warnings) {
    log.warn({ msg });
  }
  const curve = deriveHeapCurve({ sample: measured.sample });
  if (args.json) {
    log.out({ line: JSON.stringify(curve) });
  } else {
    for (const line of renderHeapCurve({ curve })) {
      log.out({ line });
    }
  }
  return coefficientsCover({ curve }) ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run the heap-curve verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev heap-curve <tail>`)
 * @returns the process exit code — see {@link runDevHeapCurveWithDeps}
 */
export async function runDevHeapCurve(argv: readonly string[]): Promise<number> {
  return runDevHeapCurveWithDeps({ argv, log: logger });
}

export const devHeapCurveCommand = defineCommand({ run: runDevHeapCurve });
