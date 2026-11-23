/**
 * `store backup --sweep-only`: no new dump; every destination on the list swept, through its own door, for the
 * earlier stagings it lacks (`src/store/backup/sweepRun.ts`). Split from `./backup.ts` with the night's half.
 *
 * **It never writes `last.json`.** A sweep updates each destination's receipts, which is what `--status` reads for
 * "last written"; `last.json` keeps describing the last staging a night took, so a sweep that sent nothing new never
 * turns `--status` red about a copy that did land, and one that sent a backlog never paints over a failed night.
 *
 * **With every destination's drive out it reads no key.** The hourly sweep's ordinary state while the SSD is out is
 * answered BEFORE the Keychain and the master password are read, so a drive-out hour costs neither, and a key that
 * cannot be read surfaces on the nightly, which reads it either way.
 */
import { admitBackupRun } from "../../../store/backup/protectedPaths.js";
import { runSweepOnly } from "../../../store/backup/sweepRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { sweepOnlyLines } from "./backupLines.js";
import type { NightSeams } from "./backupRun.js";
import { productionNightSeams } from "./backupRun.js";
import { sweepTargets } from "./backupTargets.js";
import { fail, printReport } from "./verbShell.js";
import { inspectWriteDestinations } from "./writeDestination.js";

/** The label the sweep's report is printed under. */
const SWEEP_LABEL = "store backup --sweep-only";

/**
 * Sweep every destination on the list and print what each got.
 *
 * @param home the Slopweaver home
 * @param override what `--destination` carried, or `null`
 * @param json whether to emit the report rather than the lines
 * @param keepLocal how many written staging directories to keep on disk
 * @param seams the door, drive reads and Keychain read the sweep uses; its stack is never touched
 * @returns the exit code — non-zero when any destination failed or any staging could not be sent
 */
export async function reportSweepOnly({
  home,
  override,
  json,
  keepLocal,
  seams = productionNightSeams(),
}: {
  home: string;
  override: string | null;
  json: boolean;
  keepLocal: number;
  seams?: Omit<NightSeams, "deps">;
}): Promise<number> {
  // Before the drive-out shortcut below, so a protected staging root or an unreadable registry is never green.
  const admitted = admitBackupRun({ home, read: seams.readProtection });
  if (admitted.isErr()) {
    return fail({ lines: [admitted.error.message] });
  }
  const inspected = inspectWriteDestinations({ home, override, probes: seams.probes, protection: admitted.value });
  if (inspected.isErr()) {
    return fail({ lines: inspected.error });
  }
  const { inspections, obligations } = inspected.value;
  const unreachable = inspections.flatMap((inspection) => (inspection.kind === "reachable" ? [] : [inspection]));
  if (unreachable.length === inspections.length) {
    // Nothing to send to: the staging stays as it is, and no key is read.
    const report = await runSweepOnly({ home, keepLocal, obligations, targets: unreachable });
    printReport({ json, label: SWEEP_LABEL, lines: () => sweepOnlyLines({ report }), value: report });
    return report.destinations.some((outcome) => outcome.status === "failed") ? EXIT_ERROR : EXIT_OK;
  }
  const sealing = seams.sealing({ home });
  if (sealing.isErr()) {
    return fail({ lines: sealing.error });
  }
  const atIso = new Date().toISOString();
  const targets = sweepTargets({
    atIso,
    door: seams.door,
    home,
    inspections,
    probes: seams.probes,
    sealing: sealing.value,
  });
  const report = await runSweepOnly({ home, keepLocal, obligations, targets });
  printReport({ json, label: SWEEP_LABEL, lines: () => sweepOnlyLines({ report }), value: report });
  const failed = report.destinations.some(
    (outcome) =>
      outcome.status === "failed" || (outcome.status === "swept" && outcome.report.sweep.unrecoverable.length > 0),
  );
  return failed ? EXIT_ERROR : EXIT_OK;
}
