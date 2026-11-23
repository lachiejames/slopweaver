/**
 * `slopweaver compact [--source <id>] [--older-than <N|Nd>] [--json]` — bronze's lifecycle pass. It merges
 * each source's overlapping window files into ONE canonical file, collapsing the cross-window duplicates
 * the per-write dedup index cannot see, and (only when explicitly asked) drops records past an age
 * horizon. Lossless by default; `slopweaver audit` before and after shows the record + byte delta.
 *
 * A thin effectful shell: the age grammar, the horizon arithmetic, and both renderings are pure
 * ({@link ./core}); the streaming rewrite is {@link ../../../corpus/compact}, which reads and writes a line
 * at a time so a window past V8's 512 MiB string ceiling is rewritten rather than refused. Human report →
 * stderr, `--json` → stdout (pristine). It never reads or writes a watermark, thread cursor, or repo cursor.
 *
 * Each source is compacted under that source's REFRESH SLOT ({@link ../../../corpus/refreshSlot}), because
 * the rewrite unlinks the window files it read and a refresh appending to one of them meanwhile would lose
 * its rows. A source another process holds is skipped and said so; the slots taken are released before the
 * verb returns, since a scheduled run shares the recipe runner's process.
 */

import { slopweaverHome } from "../../../config.js";
import { listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import { type CompactRun, compactCorpus } from "../../../corpus/compactCorpus.js";
import {
  acquireRefreshSlot,
  compactSlotRefusalLines,
  releaseRefreshSlot,
  slotUnavailableLines,
} from "../../../corpus/refreshSlot.js";
import { type CorpusSource } from "../../../corpus/types.js";
import { BRONZE_SOURCES } from "../../../integrations/corpusSources.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { compactHumanLines, compactJson, horizonIso, parseCompactOptions, partitionBySlot } from "./core.js";

// Interpolated from BRONZE_SOURCES rather than written out: `selectSources` validates against that same
// list, so a hand-kept spelling here drifts the moment a source is added — as it did, listing four while
// the parser had accepted six since gmail and self landed.
const USAGE = `usage: slopweaver compact [--source ${BRONZE_SOURCES.join("|")}] [--older-than <N|Nd>] [--json] [--home <dir>]`;

/**
 * Which requested sources actually have bronze on disk. Compacting a never-ingested source is a no-op,
 * and a row of zeros for it is noise — so it's skipped rather than reported. A source whose listing is REFUSED is
 * kept, so compacting it refuses by name rather than the protected source vanishing from the report.
 */
function sourcesWithBronze({ sources, home }: { sources: readonly CorpusSource[]; home: string }): CorpusSource[] {
  return sources.filter((source) => {
    const files = listBronzeFiles({ home, source });
    return files.isErr() || files.value.length > 0;
  });
}

/** Emit the run's report: `--json` to stdout (pristine), else the human lines to stderr. */
function report({ run, json, olderThanDays }: { run: CompactRun; json: boolean; olderThanDays?: number }): void {
  const age = olderThanDays !== undefined ? { olderThanDays } : {};
  if (json) {
    logger.out({ line: JSON.stringify(compactJson({ failed: run.failed, plans: run.plans, ...age }), null, 2) });
    return;
  }
  for (const line of compactHumanLines({ failed: run.failed, plans: run.plans, ...age })) {
    logger.info({ msg: line });
  }
}

/**
 * Compact every source whose refresh slot this process can take, skipping (and saying so) each one another
 * process's refresh or compaction holds or whose slot could not be taken at all, and releasing every slot taken
 * before returning.
 *
 * @param home the Slopweaver home
 * @param sources the sources with bronze on disk
 * @param olderThanDays the explicit age horizon, when one was given
 * @returns the compaction's outcome, or undefined when every source was held and nothing ran
 */
function compactUnderSlots({
  home,
  sources,
  olderThanDays,
}: {
  home: string;
  sources: readonly CorpusSource[];
  olderThanDays?: number;
}): ReturnType<typeof compactCorpus> | undefined {
  const slots = partitionBySlot({ sources, take: acquireRefreshSlot });
  for (const holder of slots.held) {
    compactSlotRefusalLines({ holder, source: holder.source }).forEach((line) => {
      logger.error({ msg: line });
    });
  }
  for (const skipped of slots.unavailable) {
    slotUnavailableLines({ ...skipped, verb: "compact" }).forEach((line) => {
      logger.error({ msg: line });
    });
  }
  if (slots.admitted.length === 0) {
    return undefined;
  }
  try {
    return compactCorpus({
      home,
      sources: slots.admitted,
      // The clock enters HERE and nowhere deeper: the horizon is computed once, then everything below is pure.
      ...(olderThanDays !== undefined ? { olderThanIso: horizonIso({ days: olderThanDays, now: new Date() }) } : {}),
    });
  } finally {
    for (const source of slots.admitted) {
      releaseRefreshSlot({ source });
    }
  }
}

/**
 * Run the compact verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCompact(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["run"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseCompactOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { home, sources, olderThanDays, json } = parsed.value;
  const present = sourcesWithBronze({ home, sources });
  if (present.length === 0) {
    logger.error({ msg: `no bronze corpus found under ${home} — nothing to compact` });
    return EXIT_EXPECTED_EMPTY;
  }

  const compacted = compactUnderSlots({
    home,
    sources: present,
    ...(olderThanDays !== undefined ? { olderThanDays } : {}),
  });
  if (compacted === undefined) {
    // Every source with bronze has a live writer. Nothing was compacted and nothing is wrong: the next run,
    // unchanged, is the remedy — so NOT YET, which a scheduler leaves due rather than stamping.
    return EXIT_DEFERRED;
  }
  if (compacted.isErr()) {
    compacted.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  compacted.value.warnings.forEach((warning) => {
    logger.warn({ msg: warning });
  });

  report({ json, run: compacted.value, ...(olderThanDays !== undefined ? { olderThanDays } : {}) });
  // A source can fail before rewriting anything (a corrupt line aborts the plan) or after the canonical
  // file landed (a superseded file it could not unlink). Either way it is UNFINISHED — never partially
  // lost — and the run did not do what was asked, so it must not exit 0. Re-running completes it.
  return compacted.value.failed.length > 0 ? EXIT_ERROR : EXIT_OK;
}

export const compactRunCommand = defineCommand({ run: runCompact });
