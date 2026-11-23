/**
 * What `--set-destination`, `--add-destination` and `--remove-destination` print: the change, the whole list the
 * night now writes in order, the drive pinned, and an environment override that replaces the list for a run.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { BACKUP_DIRECTORY_ENV } from "../../../store/backup/destination.js";
import { EXIT_OK } from "../../exitCodes.js";
import {
  changeDestinations,
  type DestinationChangeKind,
  type DestinationSettingsReport,
} from "./destinationSettings.js";
import { fail } from "./verbShell.js";

/**
 * The opening line for each kind of change.
 *
 * @param report what was remembered
 * @returns the line
 */
function headline({ report }: { report: DestinationSettingsReport }): string {
  const where = `(remembered in ${report.secretPath})`;
  if (report.change === "set") {
    return `store backup: backups now go to ${report.root} ${where}`;
  }
  if (report.change === "add") {
    return `store backup: backups now also go to ${report.root} ${where}`;
  }
  return `store backup: backups no longer go to ${report.root} ${where}`;
}

/**
 * The human report of a changed list.
 *
 * @param report what was remembered
 * @param envValue what the environment variable that replaces the list holds, when it is set
 * @returns the lines, outcome first
 */
export function destinationSettingsLines({
  report,
  envValue,
}: {
  report: DestinationSettingsReport;
  envValue: string | undefined;
}): readonly string[] {
  const lines = [headline({ report })];
  if (report.destinations.length > 1) {
    lines.push(`  each night writes, in this order: ${report.destinations.join(", ")}`);
  }
  if (report.change !== "remove" && report.pin === null) {
    lines.push("  not on an external drive, so nothing is pinned");
  }
  if (report.pin !== null) {
    lines.push(
      `  pinned to the drive "${report.pin.volumeName}" (volume ${report.pin.volumeUuid}) at ${report.pin.mountPoint}, ` +
        `recorded in ${report.pinPath}`,
      "  a night the drive is out stages here and says DRIVE NOT PLUGGED IN; `--sweep-only` sends it once it is back",
    );
  }
  const envOnly = report.destinations.length === 1 && report.destinations[0] === envValue;
  if (envValue !== undefined && !envOnly) {
    lines.push(
      `  NOTE: ${BACKUP_DIRECTORY_ENV} is set to ${envValue} in this environment and replaces the remembered list for a run`,
    );
  }
  return lines;
}

/**
 * The `--set-destination`, `--add-destination` and `--remove-destination` path.
 *
 * @param home the Slopweaver home
 * @param change which change was asked for
 * @param address what the flag carried
 * @param json whether to emit the report rather than the lines
 * @returns the exit code
 */
export function reportDestinationChange({
  home,
  change,
  address,
  json,
}: {
  home: string;
  change: DestinationChangeKind;
  address: string;
  json: boolean;
}): number {
  const outcome = changeDestinations({ address, change, home });
  if (outcome.isErr()) {
    return fail({ lines: outcome.error });
  }
  if (json) {
    logger.out({ line: safeJsonStringify({ label: `store backup --${change}-destination`, value: outcome.value }) });
    return EXIT_OK;
  }
  destinationSettingsLines({ envValue: process.env[BACKUP_DIRECTORY_ENV], report: outcome.value }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}
