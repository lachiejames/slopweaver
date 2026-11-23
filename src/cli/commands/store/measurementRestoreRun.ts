/**
 * `slopweaver store measurement-restore` — every stored measurement a filter selects, written back under a
 * directory at its home-relative path, byte for byte, never replacing a file already there. The seams it
 * shares with the other two measurement verbs live in `./measurementRun.ts`.
 */
import { safeJsonStringify } from "#lib/safeJson.js";
import { restoreTarget } from "../../../store/fleet/measurement.js";
import type { StoredMeasurementLocation } from "../../../store/fleet/measurementStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import {
  MEASUREMENT_RESTORE_USAGE,
  measurementNothingStoredLine,
  newestPerPath,
  parseMeasurementRestoreArgs,
  type RestoreStep,
  restoreAction,
  restoreCounts,
  restoreSummaryLine,
} from "./measurementCore.js";
import {
  filterWords,
  homeOf,
  type MeasurementReader,
  type MeasurementVerbDeps,
  productionMeasurementVerbDeps,
  refuseUsage,
  settleExisting,
  storeUnreadable,
  withReader,
} from "./measurementRun.js";

/**
 * Run `store measurement-restore` against injected seams.
 *
 * @param rest the argv tail after `store measurement-restore`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code — 1 when any path was refused, differed or failed to write
 */
export async function runStoreMeasurementRestore({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: MeasurementVerbDeps;
}): Promise<number> {
  const args = parseMeasurementRestoreArgs({ rest });
  if (args.isErr()) {
    return refuseUsage({ deps, problems: args.error, usage: MEASUREMENT_RESTORE_USAGE, verb: "measurement-restore" });
  }
  const { into, measurementClass, prefix, dryRun, json } = args.value;
  if (into === undefined) {
    return refuseUsage({
      deps,
      problems: ["--into <dir> is required: the directory the home-relative paths are written under"],
      usage: MEASUREMENT_RESTORE_USAGE,
      verb: "measurement-restore",
    });
  }
  return withReader({
    deps,
    home: homeOf({ deps, named: args.value.home }),
    use: async (reader) => {
      const read = await reader.locations({ filter: { measurementClass, prefix } });
      if (read.isErr()) {
        return storeUnreadable({ deps, error: read.error, verb: "measurement-restore" });
      }
      if (read.value.length === 0) {
        deps.writeDiagnostic(
          `store measurement-restore: ${measurementNothingStoredLine({ what: filterWords({ measurementClass, prefix }) })}`,
        );
        return EXIT_EXPECTED_EMPTY;
      }
      const planned = planSteps({ deps, into, locations: read.value });
      if (dryRun) {
        return reportRestore({ deps, dryRun, failures: planned.failures, into, json, steps: planned.steps });
      }
      const wrote = await writeSteps({ deps, into, reader, steps: planned.steps });
      const failures = planned.failures.concat(wrote.failures);
      return reportRestore({ deps, dryRun, failures, into, json, steps: wrote.steps });
    },
    verb: "measurement-restore",
  });
}

/**
 * Decide each path's step: where it lands under `--into`, and whether a file is already there.
 *
 * @param locations every stored location the filter selected
 * @param into the directory the home-relative paths are written under
 * @returns one step per newest path, and one line per path that cannot land inside `--into`
 */
function planSteps({
  locations,
  into,
  deps,
}: {
  locations: readonly StoredMeasurementLocation[];
  into: string;
  deps: MeasurementVerbDeps;
}): { steps: readonly RestoreStep[]; failures: readonly string[] } {
  const failures: string[] = [];
  const steps: RestoreStep[] = [];
  for (const location of newestPerPath({ locations })) {
    const target = restoreTarget({ into, relativePath: location.relativePath });
    if (target.isErr()) {
      failures.push(target.error.message);
      continue;
    }
    const action = restoreAction({
      bodySha256: location.bodySha256,
      existingSha256: deps.existingSha256({ path: target.value }),
    });
    steps.push({ action, location, target: target.value });
  }
  return { failures, steps };
}

/**
 * Print what a restore did, or would do, and pick its exit code.
 *
 * @param steps every path's settled step
 * @param failures one line per path refused, unread or unwritten
 * @param into the `--into` directory, named in the summary
 * @param dryRun whether nothing was written
 * @returns 1 when any path failed or differs, else 0
 */
function reportRestore({
  steps,
  failures,
  into,
  dryRun,
  json,
  deps,
}: {
  steps: readonly RestoreStep[];
  failures: readonly string[];
  into: string;
  dryRun: boolean;
  json: boolean;
  deps: MeasurementVerbDeps;
}): number {
  const counts = restoreCounts({ steps });
  if (json) {
    deps.writeOut(
      safeJsonStringify({ label: "store measurement-restore", value: { counts, dryRun, failures, into, steps } }),
    );
  } else {
    steps
      .filter((step) => step.action === "differs")
      .forEach((step) => {
        deps.writeDiagnostic(
          `store measurement-restore: ${step.target} differs from the stored ${step.location.bodySha256.slice(0, 12)} — left alone`,
        );
      });
    failures.forEach((line) => {
      deps.writeDiagnostic(`store measurement-restore: ${line}`);
    });
    deps.writeOut(restoreSummaryLine({ counts, dryRun, into }));
  }
  if (failures.length > 0 || counts.differs > 0) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Read and create every `write` step's body, one at a time so only one body is resident.
 *
 * Each create is exclusive, so the plan's "absent" is re-decided by the kernel at the write: a file that
 * appeared since the plan, or a second stored path the filesystem folds onto the same name (`Gold.md` and
 * `gold.md` on a case-insensitive volume), is never replaced — it is re-hashed and becomes `identical` or
 * `differs`, exactly as if the plan had seen it.
 *
 * @param steps every path's decided step
 * @param into the directory every write must resolve inside, through any link
 * @param reader the open store
 * @returns every step as it settled — a path that could not be read or written is not one, so it is never
 *   counted as written — and one line per such path
 */
async function writeSteps({
  steps,
  into,
  reader,
  deps,
}: {
  steps: readonly RestoreStep[];
  into: string;
  reader: MeasurementReader;
  deps: MeasurementVerbDeps;
}): Promise<{ steps: readonly RestoreStep[]; failures: readonly string[] }> {
  const failures: string[] = [];
  const settled: RestoreStep[] = [];
  for (const step of steps) {
    if (step.action !== "write") {
      settled.push(step);
      continue;
    }
    const body = await reader.body({ bodySha256: step.location.bodySha256 });
    if (body.isErr()) {
      failures.push(`${step.location.relativePath}: ${body.error.message}`);
      continue;
    }
    const written = deps.createFile({
      bytes: body.value,
      modifiedAt: step.location.fileModifiedAt,
      path: step.target,
      root: into,
    });
    if (written.isErr()) {
      for (const line of written.error) {
        failures.push(`${step.location.relativePath}: ${step.target} could not be written: ${line}`);
      }
      continue;
    }
    const action = settleExisting({ created: written.value, deps, location: step.location, target: step.target });
    settled.push({ ...step, action });
  }
  return { failures, steps: settled };
}

/** `slopweaver store measurement-restore`. */
export const storeMeasurementRestoreCommand = defineCommand({
  run: (argv) =>
    runStoreMeasurementRestore({
      deps: productionMeasurementVerbDeps(),
      rest: verbTail({ argv, verbs: ["measurement-restore"] }),
    }),
});
