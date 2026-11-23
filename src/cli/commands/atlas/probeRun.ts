/**
 * `slopweaver atlas probe` — the effectful shell of the estate-wide keyword count over the atlas tables.
 *
 * Thin by design: the statements and folds are `src/store/atlas/probe.ts`'s, the loop is
 * `src/store/atlas/probeRun.ts`'s and the rendering is {@link ./probeCore}'s. What lives here is open →
 * run → emit → close.
 *
 * **It reads the STORE, not the generation files**, and that is the whole point of the verb existing
 * beside `atlas <platform> read`. `read` opens one platform's own published generation off disk; this
 * asks all 35 at once, which is only affordable because `store import-atlas` already landed them in five
 * indexed tables. A `--platform` narrows it, and an install that has never imported gets a report saying
 * so rather than 35 silent zeroes.
 *
 * **No default database**, exactly as the rest of the store family: it refuses without
 * `SLOPWEAVER_STORE_URL`, because a tool that picks its own database is a tool that can run against the
 * wrong one.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { readerExecute, runAtlasProbe } from "../../../store/atlas/probeRun.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { atlasProbeLines, parseAtlasProbeArgs } from "./probeCore.js";
import { ATLAS_PROBE_USAGE } from "./probeUsage.js";

/** Where the flag tail starts: past the runtime, the script, the `atlas` noun and the `probe` verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Count a question's keywords across every atlas this store holds.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runAtlasProbeCommand(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ATLAS_PROBE_USAGE });
    return EXIT_OK;
  }
  const args = parseAtlasProbeArgs({ rest });
  if (args.isErr()) {
    args.error.forEach((msg) => {
      logger.error({ msg });
    });
    logger.error({ msg: ATLAS_PROBE_USAGE });
    return EXIT_USAGE;
  }
  const opened = await connectStore({ max: 1 });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const report = await runAtlasProbe({
      execute: readerExecute({ reader: client }),
      plan: { cells: args.value.cells, platform: args.value.platform, terms: args.value.terms },
    });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    if (args.value.json) {
      logger.out({ line: safeJsonStringify({ label: "atlas probe report", value: report.value }) });
      return EXIT_OK;
    }
    atlasProbeLines({ report: report.value }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const atlasProbeCommand = defineCommand({ run: runAtlasProbeCommand });
