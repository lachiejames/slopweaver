/**
 * `store backup`'s three paths that take no backup: `--status` reads the last attempt and each destination's newest
 * receipt, `--create-key` makes the Keychain key once, and `--check` probes every destination, reads the key, and
 * says per destination whether it holds the key's wrap. Split from `./backup.ts`, which keeps the writing paths,
 * when it grew past the size ratchet. The master password's own two modes are `./backupMasterPassword.ts`.
 */
import { realpathSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { BACKUP_KEY_SERVICE, createBackupKey } from "../../../store/backup/backupKeychain.js";
import { sharesDeviceWithHome } from "../../../store/backup/destination.js";
import { backupDestinations, type ConfiguredDestination } from "../../../store/backup/destinationConfig.js";
import { destinationHasKeyWrap } from "../../../store/backup/keyWrapStore.js";
import { readLastOutcome } from "../../../store/backup/lastOutcome.js";
import { readMasterPassword } from "../../../store/backup/masterPassword.js";
import { CREATE_MASTER_PASSWORD_COMMAND } from "../../../store/backup/masterPasswordErrors.js";
import { SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import {
  admitBackupRun,
  protectedDestinationLines,
  type ReadBackupProtection,
  readBackupProtection,
} from "../../../store/backup/protectedPaths.js";
import { type LastUpload, lastUploadsOnDisk } from "../../../store/backup/receipts.js";
import { stagingDirectories } from "../../../store/backup/staging.js";
import { readVolumePins } from "../../../store/backup/volumePins.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { attemptedStaging, destinationLabel, statusDestinations, statusExitCode, statusLines } from "./backupStatus.js";
import { allErrors, fail, resolveBackupKey } from "./verbShell.js";
import { inspectWriteDestinations, openWriteDestination, type WriteInspection } from "./writeDestination.js";

/**
 * The destinations `--status` reports on: the configured list, empty when none is configured yet — a fresh install
 * has nothing to report — and a refusal for a list that is there and cannot be read.
 *
 * @param home the Slopweaver home
 * @returns the destinations, or the line naming why the list could not be read
 */
function statusList({ home }: { home: string }): Result<readonly ConfiguredDestination[]> {
  const selection = backupDestinations({ home, override: null });
  if (selection.isOk()) {
    return ok(selection.value.destinations);
  }
  if (selection.error.code === "DESTINATION_UNSELECTED") {
    return ok([]);
  }
  return err([selection.error.message]);
}

/**
 * A staging path as the filesystem resolves it, so `last.json`'s spelling and the receipt scan's compare as one
 * directory whichever spelling of the home each went through. A path that resolves to
 * nothing stays as spelled: no receipt the scan read can sit in a directory that is not there, so it matches none.
 *
 * @param path the staging directory as recorded
 * @returns the resolved path
 */
function resolvedPath({ path }: { path: string }): string {
  const resolved = safeFs({ execute: () => realpathSync(path), operation: "resolve a staging directory", path });
  if (resolved.isErr()) {
    return path;
  }
  return resolved.value;
}

/**
 * A destination's newest upload with its staging directory resolved, as `resolvedPath` resolves the attempted night.
 *
 * @param upload the newest upload a receipt evidences, `null` when none does
 * @returns the same upload, its directory resolved
 */
function resolvedUpload({ upload }: { upload: LastUpload | null }): LastUpload | null {
  if (upload === null) {
    return null;
  }
  return { ...upload, directory: resolvedPath({ path: upload.directory }) };
}

/**
 * The `--status` path: report the most recent attempt and, per configured destination, when bytes last reached it,
 * and run nothing.
 *
 * @param home the Slopweaver home
 * @param json whether to emit the record rather than the lines
 * @param readProtection how the owner's protected paths are read; a test hands in its own
 * @returns the exit code — non-zero unless the last attempt wrote somewhere and failed nowhere, and non-zero when the
 *   owner's protection holds every backup
 */
export function reportStatus({
  home,
  json,
  readProtection = readBackupProtection,
}: {
  home: string;
  json: boolean;
  readProtection?: ReadBackupProtection;
}): number {
  // The same admission a night passes: a night held on the owner's protection reads as held here too, never as the
  // last green `last.json` a protected staging root still holds.
  const admitted = admitBackupRun({ home, read: readProtection });
  if (admitted.isErr()) {
    return fail({ lines: [admitted.error.message] });
  }
  const list = statusList({ home });
  const pins = readVolumePins({ home });
  if (list.isErr() || pins.isErr()) {
    return fail({ lines: [...(list.isErr() ? list.error : []), ...(pins.isErr() ? [pins.error.message] : [])] });
  }
  const outcome = readLastOutcome({ home });
  const uploads = lastUploadsOnDisk({ destinations: list.value, stagings: stagingDirectories({ home }) });
  const destinations = statusDestinations({
    destinations: list.value,
    outcome,
    pins: pins.value,
    uploads: new Map(uploads.map(({ destination, upload }) => [destination.id, resolvedUpload({ upload })])),
  });
  const attempted = attemptedStaging({ outcome });
  const night = attempted === null ? null : resolvedPath({ path: attempted });
  if (json) {
    // The two read failures are carried as the strings `readLastOutcome` returns rather than flattened into one
    // `null`: "nothing has ever run here" and "there is a file there and it is not a record" are different
    // statements about the install.
    logger.out({ line: safeJsonStringify({ label: "store backup --status", value: { destinations, outcome } }) });
  } else {
    statusLines({ destinations, night, outcome }).forEach((line) => {
      logger.out({ line });
    });
  }
  // A destination a night refuses as protected writes nothing and records nothing, so its last green block would
  // otherwise stand here unchallenged; it is named HELD and the status reads red.
  const held = protectedDestinationLines({ protection: admitted.value, roots: list.value.map(({ root }) => root) });
  if (held.length > 0) {
    return fail({ lines: held });
  }
  return statusExitCode({ outcome });
}

/**
 * The `--create-key` path: make the backup key in the login Keychain, once, and print only its fingerprint.
 *
 * @param json whether to emit the record rather than the line
 * @returns the exit code — non-zero when a key exists, the Keychain is locked, or the write did not read back
 */
export function reportCreateKey({ json }: { json: boolean }): number {
  const created = createBackupKey();
  if (created.isErr()) {
    return fail({ lines: [created.error.message] });
  }
  const { fingerprint } = created.value;
  logger.out({
    line: json
      ? safeJsonStringify({ label: "store backup --create-key", value: { fingerprint, service: BACKUP_KEY_SERVICE } })
      : `store backup --create-key: created backup key ${fingerprint} in the login Keychain (${BACKUP_KEY_SERVICE})`,
  });
  return EXIT_OK;
}

/** What `--check` found at one destination. */
type CheckedDestination =
  | {
      readonly status: "reachable";
      readonly root: string;
      readonly label: string;
      readonly location: string;
      readonly wrapPresent: boolean;
      readonly pinned: boolean;
      readonly sharesDeviceWithHome: boolean | null;
    }
  | {
      readonly status: "drive-not-plugged-in";
      readonly root: string;
      readonly label: string;
      readonly mountPoint: string;
      readonly volumeUuid: string;
    }
  | { readonly status: "failed"; readonly root: string; readonly label: string; readonly errors: readonly string[] };

/**
 * Probe one destination without making anything: reachable and whether it holds the key's wrap, its drive out, or
 * why it is refused.
 *
 * @param home the Slopweaver home
 * @param inspection the destination as inspected
 * @param fingerprint the backup key's fingerprint, which names its wrap
 * @param label what the destination is called
 * @returns what was found
 */
async function checkOne({
  home,
  inspection,
  fingerprint,
  label,
}: {
  home: string;
  inspection: WriteInspection;
  fingerprint: string;
  label: string;
}): Promise<CheckedDestination> {
  const { root } = inspection.destination;
  if (inspection.kind === "not-plugged-in") {
    const { mountPoint, volumeUuid } = inspection.pin;
    return { label, mountPoint, root, status: "drive-not-plugged-in", volumeUuid };
  }
  if (inspection.kind === "failed") {
    return { errors: inspection.errors, label, root, status: "failed" };
  }
  const opened = openWriteDestination({ create: false, home, inspection });
  if (opened.isErr()) {
    return { errors: opened.error, label, root, status: "failed" };
  }
  const transport = opened.value;
  const probe = await transport.probe();
  if (probe.isErr()) {
    return { errors: [probe.error.message], label, root, status: "failed" };
  }
  const wrap = await destinationHasKeyWrap({ fingerprint, project: SUPABASE_PROJECT_ID, transport });
  if (wrap.isErr()) {
    return { errors: [wrap.error.message], label, root, status: "failed" };
  }
  return {
    label,
    location: probe.value.location,
    pinned: inspection.held !== null,
    root,
    sharesDeviceWithHome: sharesDeviceWithHome({ home, root }),
    status: "reachable",
    wrapPresent: wrap.value,
  };
}

/**
 * The `--check` path: probe every destination and read the backup key and master password once, and dump nothing.
 * One block per destination; non-zero when any destination is refused, or none is reachable. A destination the
 * owner protects is refused before it is probed, and a protected staging root or unreadable registry refuses all.
 *
 * A destination on the same device as the home is said, not refused: it survives a deleted home but not a lost
 * disk, and which one the operator is guarding against is theirs to pick.
 *
 * @param home the Slopweaver home
 * @param override what `--destination` carried, or `null`
 * @param json whether to emit the probe rather than the lines
 * @returns the exit code
 */
export async function reportCheck({
  home,
  override,
  json,
}: {
  home: string;
  override: string | null;
  json: boolean;
}): Promise<number> {
  const admitted = admitBackupRun({ home, read: readBackupProtection });
  if (admitted.isErr()) {
    return fail({ lines: [admitted.error.message] });
  }
  const inspected = inspectWriteDestinations({ home, override, protection: admitted.value });
  const key = resolveBackupKey();
  const masterPassword = readMasterPassword({ home }).mapErr((error) => [error.message]);
  const pins = readVolumePins({ home }).mapErr((error) => [error.message]);
  if (inspected.isErr() || key.isErr() || masterPassword.isErr() || pins.isErr()) {
    return fail({ lines: allErrors({ results: [inspected, key, masterPassword, pins] }) });
  }
  const { fingerprint } = key.value;
  const checked: CheckedDestination[] = [];
  for (const inspection of inspected.value.inspections) {
    const label = destinationLabel({ pins: pins.value, root: inspection.destination.root });
    checked.push(await checkOne({ fingerprint, home, inspection, label }));
  }
  const masterPasswordSet = masterPassword.value !== null;
  const healthy = checked.some((one) => one.status === "reachable") && !checked.some((one) => one.status === "failed");
  if (json) {
    const value = {
      destinations: checked,
      keyFingerprint: fingerprint,
      masterPasswordSet,
      origin: inspected.value.origin,
    };
    logger.out({ line: safeJsonStringify({ label: "store backup --check", value }) });
  } else {
    [
      `store backup --check: backup key ${fingerprint} readable with no prompt (${inspected.value.origin} destinations)`,
      ...(masterPasswordSet
        ? []
        : [
            `  NO master password — only this Mac's Keychain opens these backups; run \`${CREATE_MASTER_PASSWORD_COMMAND}\``,
          ]),
      ...checked.flatMap((one) => checkLines({ checked: one, masterPasswordSet })),
    ].forEach((line) => {
      logger.out({ line });
    });
  }
  return healthy ? EXIT_OK : EXIT_ERROR;
}

/**
 * One destination's `--check` block.
 *
 * @param checked what was found there
 * @param masterPasswordSet whether `secrets/backup-passphrase` holds a usable password
 * @returns its lines
 */
function checkLines({
  checked,
  masterPasswordSet,
}: {
  checked: CheckedDestination;
  masterPasswordSet: boolean;
}): readonly string[] {
  const head = `  ${checked.label} (${checked.root})`;
  if (checked.status === "drive-not-plugged-in") {
    return [
      `${head}: DRIVE NOT PLUGGED IN — nothing is mounted at ${checked.mountPoint} (pinned volume ${checked.volumeUuid})`,
    ];
  }
  if (checked.status === "failed") {
    return [`${head}: FAILED`, ...checked.errors.map((line) => `    ${line}`)];
  }
  return [
    `${head}: ${checked.location} reachable${checked.pinned ? ", on its pinned drive" : ""}`,
    `    ${wrapLine({ masterPasswordSet, wrapPresent: checked.wrapPresent })}`,
    ...(checked.sharesDeviceWithHome === true
      ? ["    on the same device as the home: it survives a deleted home, not a lost disk"]
      : []),
  ];
}

/**
 * Whether a lost Mac could open one destination: the key's wrap there, under a master password set here.
 *
 * @param masterPasswordSet whether `secrets/backup-passphrase` holds a usable password
 * @param wrapPresent whether the destination holds this key's wrap
 * @returns one line
 */
function wrapLine({ masterPasswordSet, wrapPresent }: { masterPasswordSet: boolean; wrapPresent: boolean }): string {
  if (wrapPresent) {
    return "holds this key's wrap: a lost Mac opens it with the master password";
  }
  if (!masterPasswordSet) {
    return "holds no wrap of this key — there is no master password to wrap it under";
  }
  return "holds no wrap of this key yet — the next `store backup` writes it";
}
