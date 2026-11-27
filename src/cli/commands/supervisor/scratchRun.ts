/**
 * `slopweaver supervisor tick-capture`, `refresh-run` and `scratch-carry` — the edge of the three verbs that
 * replace the scripts a supervisor seat used to copy from its predecessor (`tick.sh`, `refresh-run.sh`) and
 * the `rsync -a` that carried them.
 *
 * Every decision is pure and lives elsewhere: `../../../supervisor/scratch/tickCapture.ts` owns the readings,
 * `qualifyRefs.ts` the bare-reference rewrite, `carry.ts` the retention rule. This module spawns children,
 * reads directories and writes files. A child is the only seam injected, because it is the only one a test
 * cannot stand up; the filesystem is real, in a temp directory.
 */
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { quietLauncherEnv } from "#lib/launcherEnv.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import {
  CARRIED_FILES,
  type CarryReport,
  carrySummaryLines,
  planCarry,
  type ScratchEntry,
} from "../../../supervisor/scratch/carry.js";
import { type ChildOutcome, exitCodeOf } from "../../../supervisor/scratch/childOutcome.js";
import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";
import {
  captureSummaryLines,
  isCompletedExit,
  isFailedEmptyReading,
  READING_TIMEOUT_MS,
  type ReadingOutcome,
  readingFiles,
  type TickCapture,
  type TickReading,
  tickDraftArgs,
  tickReadings,
} from "../../../supervisor/scratch/tickCapture.js";
import {
  confinedChildEnv,
  confinementLines,
  readingsForConfinement,
  tickConfinement,
} from "../../../supervisor/scratch/tickConfinement.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { type ScratchBuildGate, scratchBuildGate } from "./scratchBuildGate.js";
import {
  parseScratchCarryArgs,
  parseTickCaptureArgs,
  SUPERVISOR_SCRATCH_CARRY_USAGE,
  SUPERVISOR_TICK_CAPTURE_USAGE,
} from "./scratchCore.js";
import { chosenBin, productionScratchDeps, refuse, type ScratchDeps } from "./scratchDeps.js";
import { appendToLedger } from "./scratchLedger.js";

/**
 * A file's size, or zero when the child never created it.
 *
 * @param path the file
 * @returns its size in bytes
 */
function sizeOf({ path }: { path: string }): number {
  return existsSync(path) ? statSync(path).size : 0;
}

/**
 * Take one reading: settle the build, launch it, and take it once more when it came back empty and must print, or
 * failed while a rebuild crossed it — keeping only the last attempt.
 *
 * @param dir the tick's directory, already created
 * @param bin the `slopweaver` binary the child launches from
 * @param gate the capture's rebuild gate, shared across its readings
 * @returns what the reading left, before any ledger row
 */
async function takeReading({
  dir,
  bin,
  reading,
  deps,
  gate,
  env,
}: {
  dir: string;
  bin: string;
  reading: TickReading;
  deps: ScratchDeps;
  gate: ScratchBuildGate;
  env: NodeJS.ProcessEnv | undefined;
}): Promise<ReadingOutcome> {
  const before = await gate.settle({ reading: reading.name });
  const { file, errFile } = readingFiles({ reading });
  const { timeoutMs = READING_TIMEOUT_MS } = reading;
  // The child rewrites both files on each launch, so a second attempt leaves only its own bytes behind.
  const attempt = async (): Promise<{ child: ChildOutcome; bytes: number }> => {
    const ended = await deps.runChild({
      argv: reading.argv,
      bin,
      stderrPath: join(dir, errFile),
      stdoutPath: join(dir, file),
      timeoutMs,
      ...(env === undefined ? {} : { env }),
    });
    return { bytes: sizeOf({ path: join(dir, file) }), child: ended };
  };
  const first = await attempt();
  const firstExit = exitCodeOf({ outcome: first.child });
  const retried = isFailedEmptyReading({ bytes: first.bytes, exitCode: firstExit, reading });
  // A refusal prints nothing to stdout, so an empty document is a failure even where the exit code is a finding.
  const firstFailed = !isCompletedExit({ exitCode: firstExit, reading }) || first.bytes === 0;
  // Every failure goes to the gate, an empty retry's included: a reading whose completed exits take in 1 reads a
  // stale-build refusal as complete-but-empty, and retried without the gate it would launch into the same stale build.
  const retake = await gate.retake({ before: before.state, failed: firstFailed, reading: reading.name });
  const waitedForRebuildMs = before.waitedMs + retake.waitedMs;
  const { child, bytes } = retried || retake.again ? await attempt() : first;
  const exitCode = exitCodeOf({ outcome: child });
  return {
    argv: reading.argv,
    bytes,
    child,
    completed: isCompletedExit({ exitCode, reading }) && !isFailedEmptyReading({ bytes, exitCode, reading }),
    errFile,
    exitCode,
    file,
    name: reading.name,
    ...(reading.draftSource === undefined ? {} : { draftSource: reading.draftSource }),
    ...(retried ? { retried: true as const } : {}),
    ...(retake.again ? { retriedAfterRebuild: true as const } : {}),
    ...(waitedForRebuildMs > 0 ? { waitedForRebuildMs } : {}),
  };
}

/**
 * Run every reading of one tick, one after another, each into its own pair of files.
 *
 * @param dir the tick's directory, already created
 * @param bin the `slopweaver` binary each child launches from
 * @param readings the readings to take, in order
 * @param deps the injected seams
 * @param env every child's environment, when the tick is confined to a scratch home
 * @returns what each reading left, and the reading on whose turn a rebuild wait ran out, when one did
 */
async function takeReadings({
  dir,
  bin,
  readings,
  by,
  home,
  deps,
  env,
}: {
  dir: string;
  bin: string;
  readings: readonly TickReading[];
  by: string;
  home: string | undefined;
  deps: ScratchDeps;
  env: NodeJS.ProcessEnv | undefined;
}): Promise<{ outcomes: readonly ReadingOutcome[]; rebuildGaveUpAt: string | undefined }> {
  const outcomes: ReadingOutcome[] = [];
  const gate = scratchBuildGate({ bin, deps });
  // One after another, never in parallel: the budget exists because the machine was already loaded, and
  // eighteen children at once is the load.
  for (const reading of readings) {
    const outcome = await takeReading({ bin, deps, dir, env, gate, reading });
    const readingId = appendToLedger({ by, deps, home, outcome, path: join(dir, outcome.file), reading });
    outcomes.push(readingId === undefined ? outcome : { ...outcome, readingId });
  }
  return { outcomes, rebuildGaveUpAt: gate.gaveUpAt() };
}

/**
 * Take one tick's readings into `<scratch>/tick-<tick>/`, refusing a directory that already exists, and
 * write `capture.json` beside them. Shared by `tick-capture` and `supervisor tick open`.
 *
 * @param scratch the seat's scratch directory
 * @param tick the tick label, already validated
 * @param bin the `slopweaver` binary each child launches from
 * @param readings the readings to take, in order
 * @param home the state home the readings are recorded in, when `--home` named one
 * @param deps the injected seams
 * @param env every child's whole environment, set only when the tick is confined to a scratch home
 *   (`../../../supervisor/scratch/tickConfinement.ts`); absent, each child keeps the quiet launcher environment
 * @returns the capture and its serialised text, or why nothing was captured
 */
export async function captureTick({
  scratch,
  tick,
  bin,
  readings,
  home,
  deps,
  env,
}: {
  scratch: string;
  tick: string;
  bin: string;
  readings: readonly TickReading[];
  home: string | undefined;
  deps: ScratchDeps;
  env?: NodeJS.ProcessEnv;
}): Promise<Result<{ capture: TickCapture; text: string }, ScratchError>> {
  const dir = resolve(join(scratch, `tick-${tick}`));
  if (existsSync(dir)) {
    return err(ScratchErrors.destinationExists({ path: dir }));
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (cause: unknown) {
    return err(ScratchErrors.fileFailed({ cause, path: dir }));
  }
  const startedIso = deps.now();
  const { outcomes, rebuildGaveUpAt } = await takeReadings({
    bin,
    by: `tick-${tick}`,
    deps,
    dir,
    env,
    home,
    readings,
  });
  const capturedIso = deps.now();
  const capture: TickCapture = {
    capturedIso,
    dir,
    readings: outcomes,
    startedIso,
    tick,
    tickDraftArgs: tickDraftArgs({ capturedIso, dir, readings: outcomes, startedIso }),
    ...(rebuildGaveUpAt === undefined ? {} : { rebuildGaveUpAt }),
  };
  const text = JSON.stringify(capture, null, 1);
  try {
    writeFileAtomic({ contents: `${text}\n`, path: join(dir, "capture.json") });
  } catch (cause: unknown) {
    return err(ScratchErrors.fileFailed({ cause, path: join(dir, "capture.json") }));
  }
  return ok({ capture, text });
}

/**
 * Take every reading of one tick into its own directory.
 *
 * @param rest the argv after `supervisor tick-capture`
 * @param deps the injected seams
 * @returns the exit code
 * @internal — read by this module and its own tests.
 */
export async function runTickCapture({ rest, deps }: { rest: readonly string[]; deps: ScratchDeps }): Promise<number> {
  const parsed = parseTickCaptureArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ deps, error: parsed.error, usage: SUPERVISOR_TICK_CAPTURE_USAGE, verb: "tick-capture" });
  }
  const args = parsed.value;
  // The same confinement `tick open` applies: a `--home` other than the ambient one holds every child to it.
  const confinement = tickConfinement({ ambientHome: deps.ambientHome(), home: args.home });
  const plan = readingsForConfinement({
    confinement,
    readings: tickReadings({ loopSessionKey: args.loopSessionKey }),
  });
  const env = confinedChildEnv({ base: quietLauncherEnv(), confinement });
  const captured = await captureTick({
    bin: chosenBin({ bin: args.bin, deps }),
    deps,
    home: args.home,
    readings: plan.readings,
    scratch: args.dir,
    tick: args.tick,
    ...(env === undefined ? {} : { env }),
  });
  if (captured.isErr()) {
    return refuse({ deps, error: captured.error, usage: SUPERVISOR_TICK_CAPTURE_USAGE, verb: "tick-capture" });
  }
  const { capture, text } = captured.value;
  const confined = confinementLines({ confinement, plan });
  if (args.json) {
    // stdout stays one document; what a confined capture left out goes to stderr, never silently.
    for (const line of confined) {
      deps.writeDiagnostic(`supervisor tick-capture: ${line}`);
    }
    deps.writeOut(text);
    return EXIT_OK;
  }
  for (const line of [...confined, ...captureSummaryLines({ capture })]) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * The predecessor directory's top-level entries, sized.
 *
 * @param dir the directory
 * @returns each entry, a directory sized zero
 */
function topLevelEntries({ dir }: { dir: string }): readonly ScratchEntry[] {
  return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
    bytes: entry.isFile() ? statSync(join(dir, entry.name)).size : 0,
    name: entry.name,
  }));
}

/**
 * Copy what a carry report marks carried — refusing, copying nothing, when any inherited file is already in
 * the successor's directory, and copying nothing at all under `--dry-run`.
 *
 * @param report the planned carry
 * @returns nothing, or why the carry stopped
 */
function copyCarried({ report }: { report: CarryReport }): Result<void, ScratchError> {
  const clash = CARRIED_FILES.map((name) => join(report.to, name)).find((path) => existsSync(path));
  if (clash !== undefined) {
    return err(ScratchErrors.destinationExists({ path: clash }));
  }
  if (report.dryRun) {
    return ok(undefined);
  }
  try {
    mkdirSync(report.to, { recursive: true });
    for (const file of report.files.filter((candidate) => candidate.status === "carried")) {
      copyFileSync(join(report.from, file.name), join(report.to, file.name), constants.COPYFILE_EXCL);
    }
    return ok(undefined);
  } catch (cause: unknown) {
    return err(ScratchErrors.fileFailed({ cause, path: report.to }));
  }
}

/**
 * Carry a predecessor seat's inherited state into a successor's scratch directory, and nothing else.
 *
 * @param rest the argv after `supervisor scratch-carry`
 * @param deps the injected seams
 * @returns the exit code
 * @internal — read by this module and its own tests.
 */
export function runScratchCarry({ rest, deps }: { rest: readonly string[]; deps: ScratchDeps }): number {
  const parsed = parseScratchCarryArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ deps, error: parsed.error, usage: SUPERVISOR_SCRATCH_CARRY_USAGE, verb: "scratch-carry" });
  }
  const args = parsed.value;
  const fail = (error: ScratchError): number =>
    refuse({ deps, error, usage: SUPERVISOR_SCRATCH_CARRY_USAGE, verb: "scratch-carry" });
  const from = resolve(args.from);
  const to = resolve(args.to);
  if (from === to) {
    return fail(ScratchErrors.usage({ message: `--from and --to are both ${from}` }));
  }
  let entries: readonly ScratchEntry[];
  try {
    entries = topLevelEntries({ dir: from });
  } catch (cause: unknown) {
    return fail(ScratchErrors.fileFailed({ cause, path: from }));
  }
  const report = planCarry({ dryRun: args.dryRun, entries, from, to });
  const carried = copyCarried({ report });
  if (carried.isErr()) {
    return fail(carried.error);
  }
  if (args.json) {
    deps.writeOut(JSON.stringify(report));
    return EXIT_OK;
  }
  for (const line of carrySummaryLines({ report })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/** `slopweaver supervisor tick-capture`. */
export const supervisorTickCaptureCommand = defineCommand({
  run: (argv) => runTickCapture({ deps: productionScratchDeps(), rest: verbTail({ argv, verbs: ["tick-capture"] }) }),
});

/** `slopweaver supervisor scratch-carry`. */
export const supervisorScratchCarryCommand = defineCommand({
  run: (argv) => runScratchCarry({ deps: productionScratchDeps(), rest: verbTail({ argv, verbs: ["scratch-carry"] }) }),
});
