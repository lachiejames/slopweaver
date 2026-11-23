/**
 * `slopweaver derive` — the free, deterministic silver synthesis. Reads the bronze corpus, builds the
 * directory + cross-ref graph + opportunities + the cross-source identity resolution, and writes them
 * under `corpus/silver/`. No LLM, no network — cheap enough to re-run in full every time. `--dry-run`
 * prints the summary without writing.
 *
 * The identity roster is the store's row (the human override/seed), read once per run; the
 * DERIVED cross-source map is written to `silver/index/identities.json` for PR10/PR18 to consume.
 *
 * The synthesis itself lives in `silver/derive/pipeline.ts`, because `derive` has a second caller: a
 * consumer whose freshness check chose JIT refresh runs the same pipeline in-process. What is left here is
 * the verb — flags, progress, the summary and the exit code.
 */
import { progressJsonEnabled } from "../../../config.js";
import { silverIndexDir } from "../../../corpus/corpusPaths.js";
import { guardLoadSlot, type LoadSlotGuard } from "../../../lib/loadSlots.js";
import { logger } from "../../../lib/logger.js";
import { DEFAULT_PROGRESS_CONFIG, type ProgressSink } from "../../../lib/progress.js";
import { createRichProgressEmitter, type RichProgressEmitter } from "../../../lib/progressRichEmitter.js";
import {
  type DerivePhaseEvent,
  type DerivePipelineResult,
  runDerivePipeline,
  writeSilverArtifacts,
} from "../../../silver/derive/pipeline.js";
import { planDeriveSummary } from "../../../silver/deriveSilver.js";
import { type IdentityRosterPort, identityRosterPort } from "../../../silver/identityRoster.js";
import { admitLoadSlot } from "../../admitLoadSlot.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, parsePositiveInteger, resolveHome, verbTail } from "../../optionParsers.js";

const USAGE = "usage: slopweaver derive [--home <dir>] [--corpus <dir>] [--top N] [--dry-run]";
const DEFAULT_TOP = 20;

/** The validated derive args. */
interface DeriveArgs {
  readonly home: string;
  readonly corpus?: string;
  readonly top: number;
  readonly dryRun: boolean;
}

/** Parse + validate the derive flag tail (printing errors), or the usage exit code to return. */
function parseDeriveArgs({ rest }: { rest: readonly string[] }): { args: DeriveArgs } | { code: number } {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["dry-run"], value: ["home", "corpus", "top"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: USAGE });
    return { code: EXIT_USAGE };
  }
  const { values, flags } = parsed.value;
  const flagErrors: string[] = [];
  const top =
    values["top"] !== undefined
      ? parsePositiveInteger({ errors: flagErrors, label: "--top", value: values["top"] })
      : DEFAULT_TOP;
  if (flagErrors.length > 0) {
    flagErrors.forEach((e) => {
      logger.error({ msg: e });
    });
    return { code: EXIT_USAGE };
  }
  return {
    args: {
      dryRun: flags.has("dry-run"),
      home: resolveHome({ named: values["home"] }),
      top: top!,
      ...(values["corpus"] !== undefined ? { corpus: values["corpus"] } : {}),
    },
  };
}

/**
 * Build the progress emitter for one derive run. Derive is fast, so its stages are UNthrottled — each is a
 * distinct, watchable step, not a flood. When a machine sink is injected (tests), the human lane is silenced
 * so a unit test does no real stderr I/O and its assertions see only machine JSON.
 */
function deriveEmitter({ sink }: { sink?: ProgressSink }): RichProgressEmitter {
  let extra: { humanSink?: ProgressSink; machineSink?: ProgressSink };
  if (sink !== undefined) {
    extra = { humanSink: () => {}, machineSink: sink };
  } else if (progressJsonEnabled()) {
    extra = {};
  } else {
    extra = { machineSink: () => {} };
  }
  return createRichProgressEmitter({
    config: { ...DEFAULT_PROGRESS_CONFIG, heartbeatMs: 0 },
    verb: "derive",
    ...extra,
  });
}

/** Forward one pipeline phase onto the rich heartbeat lane. */
function emitPhase({ emitter, event }: { emitter: RichProgressEmitter; event: DerivePhaseEvent }): void {
  emitter.emit({
    lane: "heartbeat",
    phase: event.phase,
    ...(event.done !== undefined ? { done: event.done } : {}),
    ...(event.total !== undefined ? { total: event.total } : {}),
    ...(event.metrics !== undefined ? { metrics: event.metrics } : {}),
  });
}

/** Report everything the pipeline noticed but did not fail on. */
function reportPipelineNotes({ result }: { result: DerivePipelineResult }): void {
  result.warnings.forEach((w) => {
    logger.warn({ msg: w });
  });
  if (result.hiddenSuperseded > 0) {
    logger.info({
      msg: `hid ${String(result.hiddenSuperseded)} superseded record version(s) — deriving from the latest of each`,
    });
  }
  result.resolution.conflicts.forEach((conflict) => {
    logger.warn({ msg: `identity conflict: ${conflict}` });
  });
  if (result.artifacts.curated.capped > 0) {
    logger.warn({
      msg: `curated graph: dropped ${String(result.artifacts.curated.capped)} edge(s) over the per-record cap`,
    });
  }
}

/**
 * Run `derive` with an injected progress sink, so the verb is exercised without a real terminal.
 *
 * @param argv the full process argv
 * @param sink the progress sink; omit for the production one
 * @param guard the machine's load-slot guard; omit for the real one. A seam because the real guard writes
 *   into a directory shared with every other process on the host, which a unit test must never touch
 * @param identityRoster the door the store's identity roster is read through, once per run
 * @returns the process exit code
 */
export async function runDeriveWithDeps({
  argv,
  identityRoster,
  sink,
  guard = guardLoadSlot,
}: {
  argv: readonly string[];
  identityRoster: IdentityRosterPort;
  sink?: ProgressSink;
  guard?: LoadSlotGuard;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["run"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseDeriveArgs({ rest });
  if ("code" in parsed) {
    return parsed.code;
  }
  const { home, top, dryRun, corpus } = parsed.args;
  // BEFORE the pipeline reads bronze, deliberately: `derive` is one of the verbs that holds every record in
  // heap at once, so it is exactly what the machine's slot rations (src/lib/loadSlots.ts).
  const admitted = admitLoadSlot({ guard, logger });
  if ("code" in admitted) {
    return admitted.code;
  }
  // The store roster, read once: its records resolve people and its revision is what the stamp witnesses.
  const roster = await identityRoster.read({ home });
  if (roster.isErr()) {
    logger.error({ msg: roster.error.message });
    return EXIT_ERROR;
  }
  const emitter = deriveEmitter(sink !== undefined ? { sink } : {});
  const result = runDerivePipeline({
    home,
    roster: roster.value,
    onPhase: (event) => {
      emitPhase({ emitter, event });
    },
    ...(corpus !== undefined ? { corpus } : {}),
  });
  if (result.isErr()) {
    result.error.forEach((e) => {
      logger.error({ msg: e });
    });
    return EXIT_ERROR;
  }
  writeAndSummarise({ dryRun, emitter, home, result: result.value, top });
  return EXIT_OK;
}

/** Write silver (unless a dry run), then print the notes, the summary and where the stamp landed. */
function writeAndSummarise({
  dryRun,
  emitter,
  home,
  result,
  top,
}: {
  dryRun: boolean;
  emitter: RichProgressEmitter;
  home: string;
  result: DerivePipelineResult;
  top: number;
}): void {
  reportPipelineNotes({ result });
  const stampPath = dryRun ? undefined : writeSilverArtifacts({ derivedAtIso: new Date().toISOString(), home, result });
  emitter.finish({ lane: "heartbeat", phase: "write-silver" });
  planDeriveSummary({ artifacts: result.artifacts, top }).forEach((line) => {
    logger.out({ line: line });
  });
  logger.out({
    line:
      stampPath === undefined
        ? "(dry run — nothing written)"
        : `wrote silver → ${silverIndexDir({ home })} (freshness stamp → ${stampPath})`,
  });
}

/**
 * Run the derive verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDerive(argv: readonly string[]): Promise<number> {
  return runDeriveWithDeps({ argv, identityRoster: identityRosterPort() });
}

export const deriveRunCommand = defineCommand({ run: runDerive });
