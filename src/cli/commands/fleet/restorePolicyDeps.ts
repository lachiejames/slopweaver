/**
 * The real seams `fleet restore-policy` (`./restorePolicyRun.ts`) runs over: this machine's file system, the `cmux`
 * binary, the wall clock and the logger. Every refusal the verb makes on what it finds — a symlink, a hard link,
 * bytes that are not UTF-8, a byte-order mark — is decided in the run; this file only reports what is there and
 * performs the backup, the atomic write and the restore exactly as asked.
 */
import { closeSync, constants, copyFileSync, fsyncSync, lstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicStream } from "#lib/writeAtomic.js";

import { realCmuxCli } from "../../../cmux/sidebar.js";
import { FleetCommandErrors } from "./errors.js";
import type { ConfigFileState, RestorePolicyDeps } from "./restorePolicyRun.js";

/** A file-system act as a `Result`, its thrown error as the message. */
function attempt({ act }: { act: () => void }): Result<void, string> {
  try {
    act();
    return ok(undefined);
  } catch (error) {
    return err(errorMessage({ error }));
  }
}

/** What `lstat` says sits at a path. */
function inspectPath({ path }: { path: string }): ConfigFileState {
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) {
      return { kind: "absent" };
    }
    if (stat.isSymbolicLink()) {
      return { kind: "symlink" };
    }
    if (!stat.isFile()) {
      return { kind: "not-a-file" };
    }
    return { kind: "file", links: stat.nlink, mode: stat.mode };
  } catch (error) {
    return { detail: errorMessage({ error }), kind: "unreadable" };
  }
}

/** Copy the config to a backup path that must not exist yet, then flush the copy. */
const backupFile: RestorePolicyDeps["backupFile"] = ({ from, to }) =>
  attempt({
    act: () => {
      copyFileSync(from, to, constants.COPYFILE_EXCL);
      // Flushed as the new config is, so a crash between the two never leaves the edit durable and its undo not.
      const handle = openSync(to, "r");
      try {
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
    },
  });

/** Read a file's bytes and decode them as strict UTF-8. */
const readText: RestorePolicyDeps["readText"] = ({ path }) => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return err(FleetCommandErrors.configReadFailed({ cause: error, path }));
  }
  try {
    // Strict and BOM-keeping: a byte decoding would replace is a byte the rewrite would silently change.
    return ok(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return err(FleetCommandErrors.configInvalidUtf8({ path }));
  }
};

/** Put a backup's bytes back over the config, atomically and at the given mode. */
const restoreFile: RestorePolicyDeps["restoreFile"] = ({ from, to, fileMode }) =>
  attempt({
    act: () => {
      const bytes = readFileSync(from);
      writeFileAtomicStream({
        exactMode: true,
        fileMode,
        path: to,
        produce: ({ writeBytes }) => {
          writeBytes({ bytes });
        },
      });
    },
  });

/** Write the config's new text atomically at the given mode. */
const writeText: RestorePolicyDeps["writeText"] = ({ path, contents, fileMode }) =>
  attempt({
    act: () => {
      // The mode is set on the staged temp before the rename, so the umask cannot strip a bit of theirs.
      writeFileAtomicStream({
        exactMode: true,
        fileMode,
        path,
        produce: ({ write }) => {
          write({ text: contents });
        },
      });
    },
  });

/**
 * The real seams: this machine's file system, the `cmux` binary, the wall clock and the logger. Exported so a test
 * keeps the real file effects against a temporary directory and swaps only the clock, cmux and the output.
 *
 * @returns the production dependencies
 */
export function productionRestorePolicyDeps(): RestorePolicyDeps {
  return {
    backupFile,
    defaultConfigPath: () => join(homedir(), ".config", "cmux", "cmux.json"),
    inspect: inspectPath,
    now: () => new Date(),
    readText,
    reloadConfig: () =>
      realCmuxCli()
        .run({ argv: ["reload-config"] })
        .mapErr((error) => error.message),
    restoreFile,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
    writeText,
  };
}
