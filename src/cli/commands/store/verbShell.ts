/**
 * The shell the `store` backup verbs share: how a refusal prints, which home a run reads, which local directory a
 * backup is written to, and the backup key every object is encrypted under.
 *
 * Its own module because `store backup`, `store restore`, `store rehearse` and `store recover` are separate verbs
 * in separate files and each needs these. Nothing here reaches the store or writes a backup; it only resolves what
 * to reach them with.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { readBackupKey, requireBackupKey } from "../../../store/backup/backupKeychain.js";
import { refuseHomeOverlap } from "../../../store/backup/destination.js";
import { type BackupDestinationOrigin, backupReadDestination } from "../../../store/backup/destinationConfig.js";
import { encryptingTransport } from "../../../store/backup/encryptingTransport.js";
import { BackupErrors, backupErrorLines } from "../../../store/backup/errors.js";
import { localDirectoryTransport } from "../../../store/backup/localDirectoryTransport.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

/**
 * Print refusal lines and the usage that follows them.
 *
 * @param lines what the parser refused on
 * @param usage the verb's own usage block
 * @returns the usage exit code
 */
export function refuse({ lines, usage }: { lines: readonly string[]; usage: string }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * Print every error line and exit non-zero.
 *
 * @param lines the failure this run hit
 * @returns the error exit code
 */
export function fail({ lines }: { lines: readonly string[] }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  return EXIT_ERROR;
}

/**
 * Print one report: the document under `--json`, else its rendered lines.
 *
 * @param json whether `--json` was passed
 * @param label what the document is, for the serialiser's size guard
 * @param value the report
 * @param lines the report rendered as lines, built only when they are printed
 */
export function printReport({
  json,
  label,
  value,
  lines,
}: {
  json: boolean;
  label: string;
  value: unknown;
  lines: () => readonly string[];
}): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label, value }) });
    return;
  }
  lines().forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Every failure line across several independent resolutions, in order, so one run names every missing piece
 * rather than the first.
 *
 * @param results the resolutions, each failing with lines
 * @returns the lines of every one that failed, empty when none did
 */
export function allErrors({ results }: { results: readonly Result<unknown>[] }): readonly string[] {
  return results.flatMap((result) => (result.isErr() ? [...result.error] : []));
}

/** The local destination a backup is read from, where that came from, and the plain transport over it. */
export interface ResolvedDestination {
  readonly root: string;
  readonly origin: BackupDestinationOrigin;
  /** The PLAIN transport; a caller wraps it in the object cipher, so nothing is read or sent unencrypted. */
  readonly transport: BackupTransport;
}

/**
 * Resolve the ONE destination a read takes — `--destination`, else `SLOPWEAVER_BACKUP_DIRECTORY`, else the first
 * on the remembered `secrets/store-backup-directory` list (`backupReadDestination`) — and the transport over it.
 *
 * @param home the Slopweaver home whose secrets may remember the destination
 * @param override what `--destination` carried, or `null`
 * @param create whether to make the directory (0700) first — a writing run does, a probe does not, so `--check`
 *   reports a destination that is not there rather than making one
 * @returns the destination, or why none is selected or it could not be made
 */
export function resolveDestination({
  home,
  override,
  create = false,
}: {
  home: string;
  override: string | null;
  create?: boolean;
}): Result<ResolvedDestination> {
  const selected = backupReadDestination({ home, override });
  if (selected.isErr()) {
    return err([selected.error.message]);
  }
  const { destination, origin } = selected.value;
  const { root } = destination;
  return openLocalDestination({ create, home, root }).map((transport) => ({ origin, root, transport }));
}

/**
 * The plain transport over one local destination root, made first (0700) when `create`, and refused when it and
 * the home sit one inside the other.
 *
 * @param home the Slopweaver home whose staging the root must stay clear of
 * @param root the destination's absolute root
 * @param create whether to make the directory first — only a writing run does
 * @returns the transport, or why the root could not be made or is refused
 */
export function openLocalDestination({
  home,
  root,
  create,
}: {
  home: string;
  root: string;
  create: boolean;
}): Result<BackupTransport> {
  const existed = existsSync(root);
  if (create) {
    try {
      mkdirSync(root, { mode: 0o700, recursive: true });
    } catch (error: unknown) {
      return err(backupErrorLines({ error: BackupErrors.destinationUncreatable({ cause: error, destination: root }) }));
    }
  }
  // Every verb here stages plaintext under the home. Both sides exist by now, so the check compares identities.
  const clear = refuseHomeOverlap({ home, root });
  if (clear.isErr()) {
    if (create && !existed) {
      rmSync(root, { force: true, recursive: true });
    }
    return err(backupErrorLines({ error: clear.error }));
  }
  // Only a run that made the root may make it again; a probe or a read never conjures a destination.
  const rootPolicy = create ? "create" : "require-existing";
  return ok(localDirectoryTransport({ root, rootPolicy }));
}

/**
 * Read the backup key from the login Keychain, with no prompt — what the 03:00 run relies on.
 *
 * @returns the key and its fingerprint, or the lines naming why there is none to use
 */
export function resolveBackupKey(): Result<{ key: Buffer; fingerprint: string }> {
  return requireBackupKey().mapErr((error) => [error.message]);
}

/**
 * Read the backup key when there is one: `null` when the Keychain holds none — a caller that can go on without it
 * says so — and a refusal when one exists and cannot be read, because a locked or malformed key is a fault the
 * operator has to see rather than a quiet `null`.
 *
 * @returns the key and its fingerprint, `null` when none exists, or the lines naming why it could not be read
 */
export function optionalBackupKey(): Result<{ key: Buffer; fingerprint: string } | null> {
  const status = readBackupKey();
  if (status.isErr()) {
    return err([status.error.message]);
  }
  if (status.value.kind === "absent") {
    return ok(null);
  }
  return resolveBackupKey();
}

/**
 * The reader a restore fetches a destination backup through: the decrypting transport over its root.
 *
 * @param key the backup key, or `null` when the Keychain holds none
 * @returns the factory `resolveRestoreSource` calls with the address's root
 */
export function destinationReader({
  key,
}: {
  key: Buffer | null;
}): (args: { root: string }) => Result<BackupTransport> {
  return ({ root }) => {
    if (key === null) {
      return err(backupErrorLines({ error: BackupErrors.backupKeyAbsent({ destination: root }) }));
    }
    return ok(
      encryptingTransport({ inner: localDirectoryTransport({ root, rootPolicy: "require-existing" }), key }).transport,
    );
  };
}

/**
 * The state home a run reads, with an absent `--home` named as the case that takes the ambient one.
 *
 * @param home what `--home` carried, absent when the flag was not passed
 * @returns the flag's home when one was passed, else this install's own state home
 */
export function resolvedHome({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}
