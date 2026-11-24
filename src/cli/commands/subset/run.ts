/**
 * `slopweaver subset build|status` — the small-corpus iteration loop's front door.
 *
 * `build` writes a NEW home holding only the last `--days` of the real corpus; `status` reads any home and
 * says whether it is a subset and of what. Both are thin effectful shells: the flag grammar and both
 * renderings are pure ({@link ./core}), the copy itself is {@link ../../../corpus/subsetBuild}.
 *
 * `build` never writes into the home it is slicing, and never into a home that already holds bronze. Both
 * refusals are typed rather than defensive coding: the destination checks are the only thing standing
 * between a mistyped `--out` and the 8 GB corpus it came from.
 */

import { slopweaverHome } from "../../../config.js";
import { renderSubsetLines } from "../../../corpus/subset.js";
import { buildSubset } from "../../../corpus/subsetBuild.js";
import { readSubsetManifest } from "../../../corpus/subsetStore.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseSubsetBuildOptions, parseSubsetStatusOptions, subsetBuildLines, subsetJson } from "./core.js";

const BUILD_USAGE = "usage: slopweaver subset build --out <dir> [--days N] [--limit N] [--home <dir>] [--json]";
const STATUS_USAGE = "usage: slopweaver subset status [--home <dir>] [--json]";

/** Report every parse rejection, then the usage line. */
function reportUsage({ errors, usage }: { errors: readonly string[]; usage: string }): number {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Run `subset build`.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runSubsetBuild(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["build"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BUILD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSubsetBuildOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    return reportUsage({ errors: parsed.error, usage: BUILD_USAGE });
  }
  const { home, out, days, limit, json } = parsed.value;
  const startedMs = Date.now();
  // The clock enters HERE and nowhere deeper: the window is measured once, then everything below is pure.
  const built = buildSubset({
    days,
    ...(limit !== undefined ? { limit } : {}),
    now: new Date(),
    onProgress: ({ source, kept, scanned }) => {
      logger.info({ msg: `  ${source}: kept ${String(kept)} of ${String(scanned)}` });
    },
    outHome: out,
    sourceHome: home,
  });
  if (built.isErr()) {
    logger.error({ msg: built.error.message });
    if (built.error.code === "NO_SOURCE_CORPUS") {
      return EXIT_EXPECTED_EMPTY;
    } else if (built.error.code === "COPY_FAILED" || built.error.code === "SUBSET_PROTECTED") {
      return EXIT_ERROR;
    } else {
      return EXIT_USAGE;
    }
  }
  if (json) {
    logger.out({ line: JSON.stringify(subsetJson({ home: out, manifest: built.value }), null, 2) });
    return EXIT_OK;
  }
  const lines = subsetBuildLines({ elapsedSeconds: (Date.now() - startedMs) / 1000, manifest: built.value, out });
  lines.forEach((line) => {
    logger.info({ msg: line });
  });
  return EXIT_OK;
}

/**
 * Run `subset status`.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runSubsetStatus(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["status"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STATUS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSubsetStatusOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    return reportUsage({ errors: parsed.error, usage: STATUS_USAGE });
  }
  const { home, json } = parsed.value;
  const manifest = readSubsetManifest({ home });
  if (manifest === undefined) {
    // Not an error. A home with no manifest is the ordinary full corpus, and saying so plainly is the
    // whole contract: a reader must never have to infer "full" from silence.
    if (json) {
      logger.out({ line: JSON.stringify({ home, subset: false }, null, 2) });
      return EXIT_OK;
    }
    logger.info({ msg: `${home} is NOT a subset — it is a full corpus home (no corpus/.subset.json)` });
    return EXIT_OK;
  }
  if (json) {
    logger.out({ line: JSON.stringify({ subset: true, ...subsetJson({ home, manifest }) }, null, 2) });
    return EXIT_OK;
  }
  renderSubsetLines({ manifest }).forEach((line) => {
    logger.info({ msg: line });
  });
  return EXIT_OK;
}

export const subsetBuildCommand = defineCommand({ run: runSubsetBuild });
export const subsetStatusCommand = defineCommand({ run: runSubsetStatus });
