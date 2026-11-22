/**
 * `slopweaver dev slice-shape` — one streaming pass over bronze, emitting the four numbers a dev-loop slice
 * is priced on.
 *
 * The owner's `SLICE = MEASURE` ruling asked for the four candidate shapes priced rather than one of them
 * chosen. Three of the four needed a number nothing here produced: a date histogram for **window**, a
 * per-thread size distribution for **sample**, and a per-container tally for **channels**. **cap** was
 * derivable from the per-source counts and is priced beside them so all four are read off one table.
 *
 * Effectful shell only — it opens files, reads a clock and prints. Every tally, every share and every line
 * of the report is {@link ../../../corpus/sliceShape}, {@link ../../../corpus/sliceShapePrices} and
 * {@link ./sliceShapeCore}.
 *
 * Read-only with respect to the corpus: it opens each `.jsonl` for reading and writes nothing at all.
 *
 * A line that does not parse as a corpus record is COUNTED and skipped rather than aborting the pass. A
 * shape reading is a census, and a census that stops at the first malformed row reports nothing about the
 * 1.9 million rows behind it; the unparsed count is printed so a reader can see how much the census missed.
 */
import { slopweaverHome } from "../../../config.js";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { resolveCorpusScan } from "../../../corpus/corpusResolve.js";
import { protectedSkipWarnings, readJsonlLines, scanJsonlProtected } from "../../../corpus/corpusStore.js";
import {
  absorbRow,
  emptySliceShape,
  finishSliceShape,
  type SliceShape,
  type SliceShapeAccumulator,
} from "../../../corpus/sliceShape.js";
import { type CorpusSource } from "../../../corpus/types.js";
import { ALL_CORPUS_SOURCES } from "../../../integrations/corpusSources.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  DEV_SLICE_SHAPE_USAGE,
  parseDevSliceShapeArgs,
  parseTopContainers,
  renderSliceShape,
} from "./sliceShapeCore.js";

/** What one pass read, beside the shape itself. */
interface PassResult {
  readonly shape: SliceShape;
  readonly fileCount: number;
  readonly unparsedRows: number;
  readonly elapsedMs: number;
  readonly unreadableDirs: readonly string[];
  /** One line per path the owner's protect list kept out of the walk; the shape is short by these. */
  readonly warnings: readonly string[];
}

/**
 * The four fields the shape pass reads off one bronze line.
 *
 * A whole `JSON.parse` per line rather than a targeted extraction, because it measured at 518 MB/s over this
 * install's own bronze (repro: `node -e` over `slack/compact.jsonl`) — 16 seconds for the whole
 * 7.9 GB — so the pass is IO-bound either way and a hand-rolled field scanner would only add a way to be
 * wrong about a record whose fields arrived in an unexpected order.
 */
function fieldsOf({
  line,
}: {
  line: string;
}): { source: CorpusSource; tsIso: string; container: string; sourceId: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { source, tsIso, container, sourceId } = parsed;
  if (typeof source !== "string" || typeof tsIso !== "string") {
    return undefined;
  }
  const known = ALL_CORPUS_SOURCES.find((candidate) => candidate === source);
  if (known === undefined) {
    return undefined;
  }
  return {
    container: typeof container === "string" ? container : "",
    source: known,
    sourceId: typeof sourceId === "string" ? sourceId : "",
    tsIso,
  };
}

/** Fold every line of every bronze file into one accumulator, counting what would not parse. */
function foldCorpus({ files, into }: { files: readonly string[]; into: SliceShapeAccumulator }): number {
  let unparsed = 0;
  for (const path of files) {
    readJsonlLines({
      onLine: ({ line, byteLength }) => {
        if (line.trim().length === 0) {
          return;
        }
        const fields = fieldsOf({ line });
        if (fields === undefined) {
          unparsed += 1;
          return;
        }
        absorbRow({ into, row: { ...fields, byteLength } });
      },
      path,
    });
  }
  return unparsed;
}

/**
 * Run the whole pass over a resolved corpus dir — one walk, one fold — the walk judged by the owner's protect list,
 * so a protected tree is the refusal's lines rather than "nothing to measure".
 */
function runPass({
  dir,
  home,
  top,
  nowMs,
  protection,
}: {
  dir: string;
  home: string;
  top: number;
  nowMs: number;
  protection: OwnerProtectionResolver | undefined;
}): Result<PassResult | undefined> {
  const scanned = scanJsonlProtected({ dir, home, operation: { target: "the corpus", verb: "measure" }, protection });
  if (scanned.isErr()) {
    return err(scanned.error);
  }
  const scan = scanned.value;
  if (scan.files.length === 0) {
    return ok(undefined);
  }
  const startedAt = performance.now();
  const into = emptySliceShape();
  const unparsedRows = foldCorpus({ files: scan.files.map((file) => file.path), into });
  return ok({
    elapsedMs: performance.now() - startedAt,
    fileCount: scan.files.length,
    shape: finishSliceShape({ into, nowMs, top }),
    unparsedRows,
    unreadableDirs: scan.unreadableDirs,
    warnings: protectedSkipWarnings({ scan }),
  });
}

/** The resolved scope of one invocation, or `undefined` once every parse error has been reported. */
function scopeOrReportUsage({
  rest,
  log,
}: {
  rest: readonly string[];
  log: Pick<Logger, "error">;
}): { home: string; corpus: string | undefined; top: number; json: boolean } | undefined {
  const parsed = parseDevSliceShapeArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, DEV_SLICE_SHAPE_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  const { values } = parsed.value;
  const top = parseTopContainers({ value: typeof values["top"] === "string" ? values["top"] : undefined });
  if (top.isErr()) {
    [...top.error, DEV_SLICE_SHAPE_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  return {
    corpus: typeof values["corpus"] === "string" ? values["corpus"] : undefined,
    home: typeof values["home"] === "string" ? values["home"] : slopweaverHome(),
    json: values["json"] === true,
    top: top.value,
  };
}

/** The whole report as one JSON object — the shape a later comparison reads. */
function jsonReport({ dir, pass }: { dir: string; pass: PassResult }): string {
  return JSON.stringify({
    corpusDir: dir,
    elapsedMs: Math.round(pass.elapsedMs),
    fileCount: pass.fileCount,
    shape: pass.shape,
    unparsedRows: pass.unparsedRows,
    unreadableDirs: pass.unreadableDirs,
  });
}

/**
 * Run the slice-shape verb over an injected logger — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev slice-shape <tail>`)
 * @param log the diagnostic + data sinks
 * @param now the instant the candidate windows are measured back from
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns EXIT_OK on a completed pass, EXIT_EXPECTED_EMPTY when the corpus holds no `.jsonl` at all,
 *   EXIT_ERROR when a directory could not be listed (a census over a partial tree is not one), EXIT_USAGE
 *   on a bad flag
 */
export function runDevSliceShapeWithDeps({
  argv,
  log,
  now,
  protection,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  now: Date;
  protection?: OwnerProtectionResolver | undefined;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_SLICE_SHAPE_USAGE });
    return EXIT_OK;
  }
  const scope = scopeOrReportUsage({ log, rest });
  if (scope === undefined) {
    return EXIT_USAGE;
  }
  const resolved = resolveCorpusScan({
    home: scope.home,
    ...(scope.corpus !== undefined ? { corpus: scope.corpus } : {}),
    protection,
  });
  if (resolved.isErr()) {
    log.error({ msg: resolved.error.message });
    return EXIT_ERROR;
  }
  const { dir } = resolved.value;
  const passed = runPass({ dir, home: scope.home, nowMs: now.getTime(), protection, top: scope.top });
  if (passed.isErr()) {
    for (const msg of passed.error) {
      log.error({ msg });
    }
    return EXIT_ERROR;
  }
  const pass = passed.value;
  if (pass === undefined) {
    log.error({ msg: `slice-shape: no .jsonl under ${dir} — nothing to measure` });
    return EXIT_EXPECTED_EMPTY;
  }
  // A path the protect list kept out of the walk goes to stderr, so a `--json` reading on stdout stays one object.
  for (const msg of pass.warnings) {
    log.error({ msg });
  }
  emitPass({ dir, json: scope.json, log, pass });
  return pass.unreadableDirs.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/** Print a finished pass: one JSON object under `--json`, else the rendered shape and a read summary, on stdout. */
function emitPass({
  dir,
  pass,
  json,
  log,
}: {
  dir: string;
  pass: PassResult;
  json: boolean;
  log: Pick<Logger, "out">;
}): void {
  if (json) {
    log.out({ line: jsonReport({ dir, pass }) });
    return;
  }
  for (const line of renderSliceShape({ shape: pass.shape })) {
    log.out({ line });
  }
  log.out({
    line:
      `\nread ${String(pass.fileCount)} file(s) in ${(pass.elapsedMs / 1000).toFixed(1)}s · ` +
      `${String(pass.unparsedRows)} unparsed row(s)`,
  });
}

/**
 * Run the slice-shape verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev slice-shape <tail>`)
 * @returns the process exit code — see {@link runDevSliceShapeWithDeps}
 */
export function runDevSliceShape(argv: readonly string[]): number {
  return runDevSliceShapeWithDeps({ argv, log: logger, now: new Date() });
}

export const devSliceShapeCommand = defineCommand({ run: runDevSliceShape });
