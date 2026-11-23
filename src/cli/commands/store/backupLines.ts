/**
 * The rendered LINES of `slopweaver store backup` and `store restore` — pure text over a report, with no
 * process, socket, clock or filesystem. Split from `./backupCore.ts`, which keeps the parsers and the recipe
 * row: the two halves share no helper and the file-size ratchet was the prompt. `--status`'s lines are
 * `./backupStatus.ts`.
 *
 * A night writes to a list of destinations, so what the night measured once — the files, the dump, the legs —
 * prints once, and what each destination got prints as its own block, in list order.
 */
import { join } from "node:path";

import type { ChunkTally } from "../../../store/backup/chunkPlan.js";
import type { StrandedFor, UnremovedStaging } from "../../../store/backup/finishStagings.js";
import type { KeyWrapStatus } from "../../../store/backup/keyWrapStep.js";
import { CREATE_MASTER_PASSWORD_COMMAND } from "../../../store/backup/masterPasswordErrors.js";
import { FILES_MANIFEST } from "../../../store/backup/plan.js";
import type { SkippedProtectedPath } from "../../../store/backup/protectedPaths.js";
import type { RestoreReport } from "../../../store/backup/restore.js";
import type { FilesRestoreReport } from "../../../store/backup/restoreFiles.js";
import type { SecretsRestoreReport } from "../../../store/backup/restoreSecrets.js";
import type { BackupReport, DestinationOutcome } from "../../../store/backup/run.js";
import type { SweepReport } from "../../../store/backup/sweep.js";
import type { DestinationSweepOutcome, SweepOnlyReport } from "../../../store/backup/sweepRun.js";

/**
 * Render a byte count for a human.
 *
 * @param bytes the count
 * @returns the count in the largest unit it reaches
 */
function bytesLine({ bytes }: { bytes: number }): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${String(bytes)} B`;
}

/**
 * The human report of one backup: the verdict, what the night measured once, then one block per destination.
 *
 * @param report what the backup did
 * @returns the lines, outcome first
 */
export function backupLines({ report }: { report: BackupReport }): readonly string[] {
  const { manifest } = report;
  return [
    verdictLine({ report }),
    `  files first: ${String(report.files.count)} file(s), ${bytesLine({ bytes: report.files.bytes })}`,
    ...vanishedLines({ vanished: report.files.vanished }),
    ...skippedProtectedLines({ skipped: report.files.skippedProtectedPaths }),
    `  database ${manifest.database} — dump ${bytesLine({ bytes: manifest.dump.bytes })}, storage tar ` +
      `${bytesLine({ bytes: manifest.storage.bytes })}, ${manifest.pgDumpVersion}`,
    `  manifest ${manifest.createdAtIso}, sha256 dump ${manifest.dump.sha256.slice(0, 12)}… storage ` +
      `${manifest.storage.sha256.slice(0, 12)}…`,
    // Printed on EVERY run, in both directions. A leg that says nothing when it did not run is the silent
    // shrink this whole line exists to prevent — the absence has to be as loud as the presence.
    manifest.secrets === null
      ? `  credentials NOT included — no master password; generate it once with \`${CREATE_MASTER_PASSWORD_COMMAND}\``
      : `  credentials ${bytesLine({ bytes: manifest.secrets.bytes })} encrypted, sha256 ${manifest.secrets.sha256.slice(0, 12)}…`,
    // The same both-directions rule for the Vault leg: `null` only when no backup key could be read.
    manifest.vault === null
      ? "  Vault NOT included — no backup key; create one with `slopweaver store backup --create-key`"
      : `  Vault ${String(manifest.vault.rows)} secret(s) sealed under backup key ${manifest.vault.keyFingerprint}`,
    ...report.destinations.flatMap((outcome) => destinationLines({ outcome })),
    ...strandedLines({ stranded: report.stranded }),
    ...countLine({ label: "pruned", names: report.pruned, noun: "older staged" }),
    ...unremovedLines({ unremoved: report.unremoved }),
  ];
}

/**
 * What finishing could not remove: one line each, so a staging left on disk is never silent.
 *
 * @param unremoved what a release or prune could not remove, and why
 * @returns the lines, none when everything went
 */
function unremovedLines({ unremoved }: { unremoved: readonly UnremovedStaging[] }): readonly string[] {
  return unremoved.map(
    ({ name, why }) => `  could not clear staged copy ${name}: ${why} — it stays on disk until a later run clears it`,
  );
}

/**
 * The first line of a night: where it staged, and how many destinations it reached.
 *
 * @param report what the backup did
 * @returns the line
 */
function verdictLine({ report }: { report: BackupReport }): string {
  const total = report.destinations.length;
  if (total === 0) {
    return `store backup: staged locally at ${report.directory} (nothing written to a destination)`;
  }
  const wrote = report.destinations.filter((outcome) => outcome.status === "succeeded").length;
  return `store backup: staged ${report.directory} and wrote it to ${String(wrote)} of ${String(total)} destination(s)`;
}

/**
 * One destination's block on a night.
 *
 * @param outcome what became of it
 * @returns its lines, its root first
 */
function destinationLines({ outcome }: { outcome: DestinationOutcome }): readonly string[] {
  const { root } = outcome.destination;
  if (outcome.status === "drive-not-plugged-in") {
    const how = outcome.ejected ? "was ejected during the run" : "is not plugged in";
    return [
      `  ${root}: DRIVE NOT PLUGGED IN — the drive at ${outcome.pin.mountPoint} ${how}, so nothing more reached it`,
      "    the backup is staged on this machine; plug the drive in and `slopweaver store backup --sweep-only` sends it",
    ];
  }
  if (outcome.status === "failed") {
    return [`  ${root}: FAILED`, ...outcome.errors.map((line) => `    ${line}`)];
  }
  const { receipt, files, dumpChunks, keyWrap } = outcome.report;
  return [
    `  ${root}: wrote ${join(receipt.destination, receipt.prefix)} encrypted under backup key ` +
      `${receipt.encryption.keyFingerprint} (${receipt.encryption.scheme})`,
    `    ${String(files.uploaded)} new blob(s) sent (${bytesLine({ bytes: files.uploadedBytes })})`,
    ...chunkLines({ label: "large files", tally: files.chunks }),
    ...chunkLines({ label: "dump", tally: dumpChunks }),
    ...keyWrapLines({ keyWrap }),
    ...receipt.objects.map(
      (object) => `    ${object.name} — ${bytesLine({ bytes: object.bytes })}, sha256 ${object.sha256.slice(0, 12)}…`,
    ),
  ];
}

/**
 * The earlier stagings each destination never got, one line per destination that lacks any — NAMED, never sent by a
 * night, so a run never hides one.
 *
 * @param stranded what each destination lacks
 * @returns zero or more lines
 */
function strandedLines({ stranded }: { stranded: readonly StrandedFor[] }): readonly string[] {
  return stranded
    .filter((entry) => entry.names.length > 0)
    .map(
      (entry) =>
        `  ${String(entry.names.length)} earlier staging(s) ${entry.destination.root} never got, left for ` +
        `\`store backup --sweep-only\`: ${entry.names.join(", ")}`,
    );
}

/**
 * A count of named stagings as one line, or nothing when there are none.
 *
 * @param label the verb
 * @param noun what kind of copies they are
 * @param names the staging names
 * @returns zero or one line
 */
function countLine({
  label,
  noun,
  names,
}: {
  label: string;
  noun: string;
  names: readonly string[];
}): readonly string[] {
  if (names.length === 0) {
    return [];
  }
  return [`  ${label} ${String(names.length)} ${noun} cop${names.length === 1 ? "y" : "ies"}: ${names.join(", ")}`];
}

/**
 * The key wrap's line — printed for every destination written, in both directions, because a destination with no
 * wrap is one a lost Mac cannot open, and that absence must be as loud as the presence.
 *
 * @param keyWrap what became of the wrap there
 * @returns one line
 */
function keyWrapLines({ keyWrap }: { keyWrap: KeyWrapStatus }): readonly string[] {
  if (keyWrap.state === "no-master-password") {
    return [
      `    backup key NOT wrapped here — only this Mac's Keychain opens it; generate the master ` +
        `password once with \`${CREATE_MASTER_PASSWORD_COMMAND}\``,
    ];
  }
  if (keyWrap.state === "present") {
    return [
      `    backup key's wrap already at ${keyWrap.objectName}, opened with the master password and left as it was`,
    ];
  }
  return [`    backup key wrapped under the master password at ${keyWrap.objectName}`];
}

/**
 * How many listed files were gone before the files leg could read them, as a line — and nothing on a night
 * where none were, so a healthy run prints as it did. Printed rather than swallowed: the manifest omits them,
 * and an omission nobody can see is the silent shrink `files first` exists to prevent.
 *
 * @param vanished the count the files leg reported
 * @returns zero or one line
 */
function vanishedLines({ vanished }: { vanished: number }): readonly string[] {
  if (vanished === 0) {
    return [];
  }
  return [`  skipped ${String(vanished)} file(s) removed while the files leg was reading them`];
}

/**
 * Every protected source the walk pruned, one line each with the owner's reason — printed because a source left out
 * of a backup must be as visible as one carried, and nothing on a night that pruned none.
 *
 * @param skipped what the walk withheld
 * @returns zero or more lines
 */
function skippedProtectedLines({ skipped }: { skipped: readonly SkippedProtectedPath[] }): readonly string[] {
  return skipped.map(({ path, why }) => `  NOT backed up: ${path} — the owner protects it from every session (${why})`);
}

/**
 * What one set of chunks cost, as a line — and nothing when there were none, so a v1-shaped night prints as it did.
 *
 * @param label what was chunked
 * @param tally what sending its chunks did
 * @returns zero or one line
 */
function chunkLines({ label, tally }: { label: string; tally: ChunkTally }): readonly string[] {
  if (tally.chunks === 0) {
    return [];
  }
  return [
    `    ${label}: ${String(tally.chunks)} chunk(s), ${String(tally.held)} already held, ${String(tally.sent)} sent ` +
      `(${bytesLine({ bytes: tally.sentRawBytes })} as ${bytesLine({ bytes: tally.sentStoredBytes })})`,
  ];
}

/**
 * What the sweep of EARLIER stagings did at one destination, as lines — and nothing at all when there was nothing.
 *
 * Silent on a healthy night by design: a run that finds no stranded copy has nothing to tell a reader,
 * and the rule against walls of text is real. Every recovery and every refusal DOES print, because a
 * directory that cannot be sent is the operator's decision to make and they cannot make it unseen.
 *
 * @param sweep what the sweep found
 * @returns zero or more lines
 */
function sweepLines({ sweep }: { sweep: SweepReport }): readonly string[] {
  const lines: string[] = [];
  sweep.recovered.forEach((staging) => {
    lines.push(`    recovered ${staging.directory} → ${staging.prefix} (${String(staging.objects.length)} object(s))`);
    if (staging.filesMissing.length > 0) {
      lines.push(
        `      but it lacks ${String(staging.filesMissing.length)} of the blobs and chunks its files.json ` +
          `names, so its files half will not restore; its dump does`,
      );
    }
  });
  sweep.unrecoverable.forEach((staging) => {
    lines.push(`    could NOT send ${staging.directory} — ${staging.error.message}`);
  });
  if (sweep.unfinished.length > 0) {
    lines.push(
      `    ${String(sweep.unfinished.length)} unfinished staging(s) carry no ${FILES_MANIFEST} and were left ` +
        `alone: ${sweep.unfinished.join(", ")}`,
    );
  }
  return lines;
}

/**
 * One destination's block on a sweep.
 *
 * @param outcome what became of it
 * @returns its lines, its root first
 */
function sweptLines({ outcome }: { outcome: DestinationSweepOutcome }): readonly string[] {
  const { root } = outcome.destination;
  if (outcome.status === "drive-not-plugged-in") {
    return [`  ${root}: drive not plugged in at ${outcome.pin.mountPoint} — nothing sent`];
  }
  if (outcome.status === "failed") {
    return [`  ${root}: FAILED`, ...outcome.errors.map((line) => `    ${line}`)];
  }
  const { recovered, unrecoverable } = outcome.report.sweep;
  const head =
    recovered.length + unrecoverable.length === 0
      ? `  ${root}: no staging is waiting for it — nothing sent`
      : `  ${root}: sent ${String(recovered.length)} staging(s), ${String(unrecoverable.length)} could not be sent`;
  return [head, ...keyWrapLines({ keyWrap: outcome.report.keyWrap }), ...sweepLines({ sweep: outcome.report.sweep })];
}

/**
 * The human report of a `--sweep-only` run: one block per destination, then what finishing released and pruned.
 *
 * @param report what the sweep did
 * @returns the lines, outcome first
 */
export function sweepOnlyLines({ report }: { report: SweepOnlyReport }): readonly string[] {
  const sent = report.destinations.reduce(
    (sum, outcome) => sum + (outcome.status === "swept" ? outcome.report.sweep.recovered.length : 0),
    0,
  );
  return [
    `store backup --sweep-only: sent ${String(sent)} staging(s) across ${String(report.destinations.length)} destination(s) — no new dump taken`,
    ...report.destinations.flatMap((outcome) => sweptLines({ outcome })),
    ...countLine({ label: "pruned", names: report.pruned, noun: "uploaded staged" }),
    ...unremovedLines({ unremoved: report.unremoved }),
  ];
}

/**
 * The human report of one restore.
 *
 * @param report what the restore did
 * @returns the lines, verdict first
 */
export function restoreLines({ report }: { report: RestoreReport }): readonly string[] {
  const origin =
    report.source.kind === "local-destination"
      ? join(report.source.root, report.source.prefix)
      : report.source.directory;
  const lines = [
    `store restore: ${origin} → database ${report.database} (${report.created ? "created" : "existing"}, ${report.mode} mode)${report.dropped ? " — dropped after the report" : ""}`,
    `  backup of ${report.manifest.database} taken ${report.manifest.createdAtIso}; digests verified`,
    `  storage tar carries ${String(report.storageMembers.length)} member(s)${report.storageRestored ? ", unpacked into the live volume" : ""}`,
    report.vaultRows === null
      ? "  Vault: this backup carried no Vault leg"
      : `  Vault: ${String(report.vaultRows)} secret(s) re-created and counted`,
  ];
  if (report.comparison !== null) {
    lines.push(
      report.comparison.identical
        ? "  compared to live: IDENTICAL row counts"
        : "  compared to live: DIFFERENT row counts",
    );
    report.comparison.tables.forEach((row) => {
      const mark = row.live !== null && row.live === row.restored ? "=" : "≠";
      // `null` here means the table is on one side only, which is a different report from a count of zero.
      const liveText = row.live === null ? "absent" : String(row.live);
      const restoredText = row.restored === null ? "absent" : String(row.restored);
      lines.push(`    ${mark} ${row.table}: live ${liveText}, restored ${restoredText}`);
    });
  }
  return lines;
}

/**
 * The human report of a credentials restore — the NAMES written, never a value.
 *
 * Each name is a filename under `secrets/`, which is a credential's identity and not its content. The
 * count alone would be worse than useless during a recovery: "3 secrets restored" does not tell you the
 * Slack token is among them.
 *
 * @param report which names were written, and where
 * @returns the lines
 */
export function secretsRestoreLines({ report }: { report: SecretsRestoreReport }): readonly string[] {
  return [
    `store restore: credentials decrypted under ${report.into} — ${String(report.names.length)} file(s) at 0600`,
    `  ${report.names.join(", ")}`,
  ];
}

/**
 * The human report of a files restore.
 *
 * @param report what came back
 * @returns the lines, verdict first
 */
export function filesRestoreLines({ report }: { report: FilesRestoreReport }): readonly string[] {
  return [
    `store restore: files rebuilt under ${report.into} — ${String(report.count)} file(s), ${bytesLine({ bytes: report.bytes })}, every digest matches`,
  ];
}
