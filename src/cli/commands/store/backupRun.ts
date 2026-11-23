/**
 * The nightly half of `store backup`: stage once, send to every destination on the list through its own door
 * (`./backupTargets.ts`), record one `last.json` entry per destination, print.
 *
 * Split from `./backup.ts`, which keeps the verb's dispatch, usage and the recipe rows, when the list made it outgrow
 * the size ratchet. The orchestration is `src/store/backup/run.ts`.
 *
 * **Exit codes.** A night exits non-zero when it could not stage, or any destination FAILED — `automation run-due`
 * records that against the row. A destination whose drive was out is not a failure: the night is staged here,
 * `--sweep-only` sends it, and `--status` is what turns red about a copy that has not left the machine.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  backupDestinations,
  type ConfiguredDestination,
  rememberedDestinations,
} from "../../../store/backup/destinationConfig.js";
import { recordLastOutcome } from "../../../store/backup/lastOutcome.js";
import { readMasterPassword } from "../../../store/backup/masterPassword.js";
import {
  admitBackupRun,
  type BackupProtection,
  heldRunMayRecord,
  type ReadBackupProtection,
  readBackupProtection,
} from "../../../store/backup/protectedPaths.js";
import { type BackupDeps, type BackupReport, runBackup } from "../../../store/backup/run.js";
import { pruneObligations } from "../../../store/backup/stagingDestinations.js";
import type { VolumePin } from "../../../store/backup/volumePin.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { StoreBackupArgs } from "./backupCore.js";
import { backupLines } from "./backupLines.js";
import { attemptOutcome } from "./backupStatus.js";
import {
  type BackupDoor,
  nightTargets,
  productionBackupDoor,
  productionSealing,
  type ReadSealing,
} from "./backupTargets.js";
import { fail, optionalBackupKey, printReport } from "./verbShell.js";
import { type DriveProbes, inspectWriteDestinations, SYSTEM_DRIVE_PROBES } from "./writeDestination.js";

/** What a night reaches the world through, so a test runs one with no Keychain, no drive and no store. */
export interface NightSeams {
  readonly door: BackupDoor;
  readonly probes: DriveProbes;
  readonly sealing: ReadSealing;
  /** How the owner's protected paths are read — required, so no test reads the owner's own registry by default. */
  readonly readProtection: ReadBackupProtection;
  /** The stack effects, when not the production ones. */
  readonly deps?: BackupDeps;
}

/** A staged night, and the pins its destinations are labelled from. */
interface StagedNight {
  readonly report: BackupReport;
  readonly pins: readonly VolumePin[];
}

/**
 * The production seams.
 *
 * @returns the door, the drive reads and the Keychain read a night uses
 */
export function productionNightSeams(): NightSeams {
  return {
    door: productionBackupDoor(),
    probes: SYSTEM_DRIVE_PROBES,
    readProtection: readBackupProtection,
    sealing: productionSealing,
  };
}

/**
 * The destinations a `--local-only` staging owes, so `--sweep-only` still sends it later: the list when it can be
 * read, and nothing when no list is configured yet — a local-only run never needs one.
 *
 * @param home the Slopweaver home
 * @param override what `--destination` carried, or `null`
 * @returns the destinations, or why a list that is there could not be read
 */
function localOnlyOwes({
  home,
  override,
}: {
  home: string;
  override: string | null;
}): Result<readonly ConfiguredDestination[]> {
  const selection = backupDestinations({ home, override });
  if (selection.isOk()) {
    return ok(selection.value.destinations);
  }
  if (selection.error.code === "DESTINATION_UNSELECTED") {
    return ok([]);
  }
  return err([selection.error.message]);
}

/**
 * Stage a `--local-only` night: no destination is written, and the Vault leg is sealed when a key can be read.
 *
 * @param args what the invocation asked for
 * @param home the Slopweaver home
 * @param storeSelection the store's connection string
 * @param nowIso this backup's instant
 * @param protection the owner's protected paths, admitted before anything was read
 * @param deps the stack effects, when not the production ones
 * @returns the report, or every reason it could not stage
 */
async function stageLocalOnly({
  args,
  home,
  storeSelection,
  nowIso,
  protection,
  deps,
}: {
  args: StoreBackupArgs;
  home: string;
  storeSelection: string;
  nowIso: string;
  protection: BackupProtection;
  deps: BackupDeps | undefined;
}): Promise<Result<StagedNight>> {
  const masterPassword = readMasterPassword({ home }).mapErr((error) => [error.message]);
  const key = optionalBackupKey();
  const owes = localOnlyOwes({ home, override: args.destination });
  const remembered = rememberedDestinations({ home }).mapErr((error) => [error.message]);
  if (masterPassword.isErr() || key.isErr() || owes.isErr() || remembered.isErr()) {
    return err([masterPassword, key, owes, remembered].flatMap((one) => (one.isErr() ? [...one.error] : [])));
  }
  const ran = await runBackup({
    home,
    keepLocal: args.keepLocal,
    key: key.value === null ? null : key.value.key,
    masterPassword: masterPassword.value,
    nowIso,
    obligations: pruneObligations({ active: owes.value, remembered: remembered.value }),
    owes: owes.value,
    protection,
    storeUrl: storeSelection,
    targets: [],
    ...(deps === undefined ? {} : { deps }),
  });
  // A night that wrote no destination earns the `staged` arm, which carries no label, so it needs no pin.
  return ran.map((report) => ({ pins: [], report }));
}

/**
 * Run one night and record it: `--local-only` stages and stops; otherwise every destination is inspected, the key
 * and master password read once, and each reachable destination sent through its own door.
 *
 * @param args what the invocation asked for
 * @param home the Slopweaver home
 * @param storeSelection the store's connection string
 * @param nowIso this backup's instant
 * @param seams the door, drive reads, Keychain read and stack the night uses
 * @returns the exit code
 */
export async function reportNight({
  args,
  home,
  storeSelection,
  nowIso,
  seams = productionNightSeams(),
}: {
  args: StoreBackupArgs;
  home: string;
  storeSelection: string;
  nowIso: string;
  seams?: NightSeams;
}): Promise<number> {
  // Admitted before EITHER kind of night, so `--local-only` walks no protected source either.
  const admitted = admitBackupRun({ home, read: seams.readProtection });
  if (admitted.isErr()) {
    const lines = [admitted.error.message];
    if (heldRunMayRecord({ error: admitted.error })) {
      recordLastOutcome({ home, outcome: { atIso: nowIso, errors: lines, status: "failed" } });
    }
    return fail({ lines });
  }
  const protection = admitted.value;
  const night = args.localOnly
    ? await stageLocalOnly({ args, deps: seams.deps, home, nowIso, protection, storeSelection })
    : await sendNight({ args, home, nowIso, protection, seams, storeSelection });
  if (night.isErr()) {
    recordLastOutcome({ home, outcome: { atIso: nowIso, errors: night.error, status: "failed" } });
    return fail({ lines: night.error });
  }
  const { report, pins } = night.value;
  recordLastOutcome({ home, outcome: attemptOutcome({ atIso: nowIso, pins, report }) });
  printReport({ json: args.json, label: "store backup", lines: () => backupLines({ report }), value: report });
  return report.destinations.some((outcome) => outcome.status === "failed") ? EXIT_ERROR : EXIT_OK;
}

/**
 * Inspect every destination, read the key and master password once, and run the night through one door each.
 *
 * @param args what the invocation asked for
 * @param home the Slopweaver home
 * @param storeSelection the store's connection string
 * @param nowIso this backup's instant
 * @param protection the owner's protected paths, admitted before anything was read
 * @param seams the door, drive reads, Keychain read and stack the night uses
 * @returns the report and the pins its labels come from, or every reason the night could not stage
 */
async function sendNight({
  args,
  home,
  storeSelection,
  nowIso,
  protection,
  seams,
}: {
  args: StoreBackupArgs;
  home: string;
  storeSelection: string;
  nowIso: string;
  protection: BackupProtection;
  seams: NightSeams;
}): Promise<Result<StagedNight>> {
  const inspected = inspectWriteDestinations({
    home,
    override: args.destination,
    probes: seams.probes,
    protection,
  });
  const sealing = seams.sealing({ home });
  if (inspected.isErr() || sealing.isErr()) {
    return err([inspected, sealing].flatMap((one) => (one.isErr() ? [...one.error] : [])));
  }
  const { inspections, obligations } = inspected.value;
  const targets = nightTargets({
    door: seams.door,
    home,
    inspections,
    nowIso,
    probes: seams.probes,
    sealing: sealing.value,
  });
  const ran = await runBackup({
    home,
    keepLocal: args.keepLocal,
    key: sealing.value.key.key,
    masterPassword: sealing.value.masterPassword,
    nowIso,
    obligations,
    owes: inspections.map((inspection) => inspection.destination),
    protection,
    storeUrl: storeSelection,
    targets,
    ...(seams.deps === undefined ? {} : { deps: seams.deps }),
  });
  return ran.map((report) => ({ pins: inspected.value.pins, report }));
}
