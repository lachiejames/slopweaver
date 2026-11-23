/**
 * `store recover`'s hold on the destination: the master password read at most once, the backup it opens, and
 * the effects that read that backup. The key comes from the wrap beside the chosen backup, never the Keychain,
 * because the Mac being recovered may not be the one that made the backup.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { backupErrorLines } from "../../../store/backup/errors.js";
import { openDestinationBackup } from "../../../store/backup/keyWrapStore.js";
import { localDirectoryTransport } from "../../../store/backup/localDirectoryTransport.js";
import { SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { type RecoverError, RecoverErrors } from "../../../store/backup/recoverErrors.js";
import type { RecoverDeps } from "../../../store/backup/recoverSteps.js";
import { chooseBackup } from "../../../store/backup/rehearsalSource.js";
import { runRestoreFiles } from "../../../store/backup/restoreFiles.js";
import { runRestoreSecrets } from "../../../store/backup/restoreSecrets.js";
import { resolveRestoreSource, verifyBackupDirectory } from "../../../store/backup/restoreSource.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import { promptMasterPassword } from "./restoreRun.js";
import { resolveDestination } from "./verbShell.js";

/**
 * A backup failure carried into the recovery's union, its lines intact, naming the step.
 *
 * @param step the step that failed
 * @param reasons what it said
 * @returns the recovery failure
 */
export function stepFailed({ step, reasons }: { step: string; reasons: readonly string[] }): RecoverError {
  return RecoverErrors.stepFailed({ reasons, step });
}

/** The destination a recovery reads, and the PLAIN transport its backups are listed and its wraps read through. */
export interface RecoverReader {
  readonly root: string;
  readonly plain: BackupTransport;
}

/** The backup this recovery opened with the master password: the key it was written under, and its reader. */
interface OpenedBackup {
  readonly key: Buffer;
  readonly transport: BackupTransport;
}

/** One recovery's hold on the destination: the password read once, and the backup it opened. */
export interface BackupSession {
  readonly masterPassword: () => Promise<string>;
  /** Unwrap the chosen backup's key with the master password, and remember it for the later steps. */
  readonly open: (args: { prefix: string }) => Promise<Result<OpenedBackup, RecoverError>>;
  /** The backup {@link BackupSession.open} opened — every step reading it runs after the fetch that opens it. */
  readonly opened: () => Result<OpenedBackup, RecoverError>;
}

/**
 * The recovery's hold on the destination. The password is asked for at most once, on the first call that needs
 * it, so a `--dry-run` that only chooses the backup never asks.
 *
 * @param reader the destination and its plain transport
 * @param prompt where the password comes from — the hidden terminal prompt in production
 * @returns the session
 */
export function backupSession({
  reader,
  prompt = promptMasterPassword,
}: {
  reader: RecoverReader;
  prompt?: () => Promise<string>;
}): BackupSession {
  let password: Promise<string> | null = null;
  let current: OpenedBackup | null = null;
  const masterPassword = (): Promise<string> => {
    if (password !== null) {
      return password;
    }
    const asked = prompt();
    password = asked;
    return asked;
  };
  return {
    masterPassword,
    open: async ({ prefix }) => {
      const opened = await openDestinationBackup({
        password: await masterPassword(),
        prefix,
        project: SUPABASE_PROJECT_ID,
        transport: reader.plain,
      });
      if (opened.isErr()) {
        return err(
          stepFailed({ reasons: [opened.error.message], step: "opening the backup with the master password" }),
        );
      }
      current = { key: opened.value.key, transport: opened.value.destination.transport };
      return ok(current);
    },
    opened: () => {
      if (current === null) {
        return err(stepFailed({ reasons: ["the backup was not opened before this step"], step: "reading the backup" }));
      }
      return ok(current);
    },
  };
}

/** The effects that read the destination and the fetched backup. */
type BackupDeps = Pick<
  RecoverDeps,
  "chooseBackup" | "decryptSecrets" | "fetchSource" | "restoreFiles" | "verifySource"
>;

/**
 * The production effects that read the destination: `store restore`'s fetch, verify and decrypt, and the files leg.
 *
 * @param home the home being recovered, which the fetch stages under
 * @param reader the destination and its plain transport, which lists the backups
 * @param session the password and the opened backup, which every read past the choice goes through
 * @returns those effects
 */
export function backupDeps({
  home,
  reader,
  session,
}: {
  home: string;
  reader: RecoverReader;
  session: BackupSession;
}): BackupDeps {
  return {
    chooseBackup: async ({ from }) =>
      (
        await chooseBackup({
          destination: reader.root,
          from,
          listBackups: ({ prefix }) => reader.plain.list({ prefix }),
        })
      ).mapErr((error) => stepFailed({ reasons: [error.message], step: "choosing the backup" })),
    decryptSecrets: ({ source, manifest, into, passphrase }) =>
      runRestoreSecrets({ into, manifest, passphrase, source })
        .map((report) => report.names)
        .mapErr((error) => stepFailed({ reasons: [error.message], step: "decrypting the credentials" })),
    fetchSource: async ({ prefix }) => {
      const opened = await session.open({ prefix });
      if (opened.isErr()) {
        return err(opened.error);
      }
      const { transport } = opened.value;
      return (
        await resolveRestoreSource({ from: join(reader.root, prefix), home, transportFor: () => ok(transport) })
      ).mapErr((error) => stepFailed({ reasons: backupErrorLines({ error }), step: "fetching the backup" }));
    },
    restoreFiles: async ({ source, into }) => {
      const opened = session.opened();
      if (opened.isErr()) {
        return err(opened.error);
      }
      return (await runRestoreFiles({ into, source, transport: opened.value.transport }))
        .map((report) => report.count)
        .mapErr((error) => stepFailed({ reasons: backupErrorLines({ error }), step: "rebuilding the files leg" }));
    },
    verifySource: ({ source }) =>
      verifyBackupDirectory({ directory: source.directory }).mapErr((error) =>
        stepFailed({ reasons: backupErrorLines({ error }), step: "verifying the backup" }),
      ),
  };
}

/**
 * The destination a recovery reads. No key is resolved here: the chosen backup's key is unwrapped from the wrap
 * beside it with the master password, so a wiped Mac with an empty Keychain recovers all the same.
 *
 * @param home the home whose secrets may remember the destination
 * @param override what `--destination` carried, or `null`
 * @returns the destination and its plain transport, or every reason none resolved
 */
export function recoverReader({ home, override }: { home: string; override: string | null }): Result<RecoverReader> {
  return resolveDestination({ home, override }).map(({ root }) => ({
    plain: localDirectoryTransport({ root, rootPolicy: "require-existing" }),
    root,
  }));
}
