/**
 * `slopweaver machine free-disk` — frees disk on the owner's disk ruling, one closed target at a time.
 *
 * The order is the safety argument. Every run reads the target and prints its plan first; a dry run stops
 * there. An apply then acts on one item at a time, and immediately before each act it reads that target AGAIN
 * and runs the same pure planner over the fresh read, acting only when the item's path still has the device and
 * inode the plan captured — so a dry run from earlier is evidence for the owner, never authority for this act.
 * The first item that changed or failed stops the run, and what already happened is reported. Four
 * independent directories cannot be removed atomically, and nothing here claims they are. That loop is
 * `freeDiskApply.ts`.
 *
 * The two file system acts are bound to the plan's inode in `../../../live/machine/freeDisk/boundAct.ts`: a tree
 * removal and one same-volume rename into the Trash. The Docker trim is a fixed argv run through
 * `../../../live/machine/freeDisk/read.ts`.
 */
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

import { declaredMainCheckoutPaths } from "../../../admit/declaredMainCheckouts.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { parseDfKib, type VolumeReading, volumeFreeGb } from "../../../live/machine/diskFootprint.js";
import { moveBoundToTrash, removeBoundTree } from "../../../live/machine/freeDisk/boundAct.js";
import { readBundleRuling } from "../../../live/machine/freeDisk/bundleRuling.js";
import { observeFreeDiskTarget, runDocker } from "../../../live/machine/freeDisk/read.js";
import { DRY_RUN_CLOSING, outcomeLine, planLines, volumeLine } from "../../../live/machine/freeDisk/render.js";
import type { FreeDiskPlan, FreeDiskReport } from "../../../live/machine/freeDisk/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { applyPlan, type MachineFreeDiskDeps, readPlan } from "./freeDiskApply.js";
import { type FreeDiskArgs, parseMachineFreeDiskArgs, VERB_ARG_OFFSET } from "./freeDiskCore.js";
import { MACHINE_FREE_DISK_USAGE } from "./freeDiskUsage.js";

/** Write the run's report: one JSON document, or the outcome lines and the volume line. */
function emitReport({
  deps,
  report,
  json,
}: {
  deps: MachineFreeDiskDeps;
  report: FreeDiskReport;
  json: boolean;
}): void {
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "a machine free-disk report", value: report }));
    return;
  }
  if (!report.applied) {
    deps.writeOut(DRY_RUN_CLOSING);
    return;
  }
  for (const outcome of report.outcomes) {
    deps.writeOut(outcomeLine({ outcome }));
  }
  if (report.outcomes.length === 0) {
    deps.writeOut("  nothing to act on");
  }
  deps.writeOut(volumeLine({ report }));
}

/** Help, or the parsed argv, or the usage exit after printing every problem — all before anything is read. */
function parseOrExit({ rest, deps }: { rest: readonly string[]; deps: MachineFreeDiskDeps }): FreeDiskArgs | number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(MACHINE_FREE_DISK_USAGE);
    return EXIT_OK;
  }
  const parsed = parseMachineFreeDiskArgs({ readRuling: deps.bundleRuling, rest });
  if (parsed.isOk()) {
    return parsed.value;
  }
  for (const problem of parsed.error) {
    deps.writeDiagnostic(`machine free-disk: ${problem}`);
  }
  deps.writeDiagnostic(MACHINE_FREE_DISK_USAGE);
  return EXIT_USAGE;
}

/**
 * Carry the plan out and report it. A stop partway still reports the acts already done: one document with the
 * stop under `--json`, otherwise their lines on stderr before the stop.
 */
function applyAndReport({
  deps,
  json,
  plan,
  volumeBefore,
}: {
  deps: MachineFreeDiskDeps;
  json: boolean;
  plan: FreeDiskPlan;
  volumeBefore: VolumeReading;
}): number {
  const applied = applyPlan({ deps, plan });
  const volumeAfter = deps.volume();
  const base = { applied: true, plan, schemaVersion: 1, volumeAfter, volumeBefore } as const;
  if (applied.isOk()) {
    emitReport({ deps, json, report: { ...base, outcomes: applied.value, stopped: undefined } });
    return EXIT_OK;
  }
  const { error, outcomes } = applied.error;
  if (json) {
    emitReport({ deps, json, report: { ...base, outcomes, stopped: { code: error.code, message: error.message } } });
  } else {
    for (const outcome of outcomes) {
      deps.writeDiagnostic(outcomeLine({ outcome }));
    }
  }
  deps.writeDiagnostic(`machine free-disk: stopped — ${error.message}`);
  return EXIT_ERROR;
}

/**
 * Run `machine free-disk` against injected seams.
 *
 * @param rest the argv tail after `machine free-disk`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runMachineFreeDisk({ rest, deps }: { rest: readonly string[]; deps: MachineFreeDiskDeps }): number {
  const parsed = parseOrExit({ deps, rest });
  if (typeof parsed === "number") {
    return parsed;
  }
  const { apply, json, target } = parsed;
  const volumeBefore = deps.volume();
  if (volumeBefore === undefined) {
    deps.writeDiagnostic(
      "machine free-disk: df -k of the state home could not be read, so no saving could be measured",
    );
    return EXIT_ERROR;
  }
  const plan = readPlan({ actedOnly: false, deps, target });
  if (plan.isErr()) {
    deps.writeDiagnostic(`machine free-disk: ${plan.error.message}`);
    return EXIT_ERROR;
  }
  // Under --json the plan still reaches the reader before any act, on stderr, so stdout stays one document.
  const writePlanLine = json ? deps.writeDiagnostic : deps.writeOut;
  for (const line of planLines({ freeGb: volumeFreeGb({ volume: volumeBefore }), plan: plan.value })) {
    writePlanLine(line);
  }
  if (!apply) {
    emitReport({
      deps,
      json,
      report: {
        applied: false,
        outcomes: [],
        plan: plan.value,
        schemaVersion: 1,
        stopped: undefined,
        volumeAfter: undefined,
        volumeBefore,
      },
    });
    return EXIT_OK;
  }
  return applyAndReport({ deps, json, plan: plan.value, volumeBefore });
}

/** `df -k` of the state home, bounded. */
function stateHomeVolume(): VolumeReading | undefined {
  try {
    return parseDfKib({
      text: execFileSync("df", ["-k", slopweaverHome()], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 }),
    });
  } catch {
    return undefined;
  }
}

/**
 * The real seams: both output channels, the reads, `df`, and the two acts.
 *
 * @returns the production dependencies for {@link runMachineFreeDisk}
 */
export function productionMachineFreeDiskDeps(): MachineFreeDiskDeps {
  // The account's own home from the user database, never `$HOME`: an exported HOME=~/Downloads would otherwise
  // aim every derived cache path beneath a directory the owner ruled left alone.
  const userHome = userInfo().homedir;
  const cwd = process.cwd();
  const declaredMainCheckouts = declaredMainCheckoutPaths();
  return {
    bundleRuling: () => readBundleRuling({ home: slopweaverHome() }),
    moveToTrash: moveBoundToTrash,
    observe: ({ target, actedOnly }) =>
      observeFreeDiskTarget({ actedOnly, cwd, declaredMainCheckouts, target, userHome }),
    removeTree: removeBoundTree,
    runDocker: ({ argv }) => runDocker({ argv }),
    volume: stateHomeVolume,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver machine free-disk`. */
export const machineFreeDiskCommand = defineCommand({
  run: (argv) => runMachineFreeDisk({ deps: productionMachineFreeDiskDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
