/**
 * The production effects behind `plans connect` and `plans connect-worker`: the store directory a Codex sign-in is
 * written into (reserved, marked, retired and removed owner-only), the liveness probe, the worker launch and the
 * sign-in exchange. `connectRun.ts` parses flags and prints; this file is the effectful shell it hands the behaviour.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { bundledLauncherPath } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";

import { runCodexLoginExchange } from "../../../codex/loginExchange.js";
import type { CodexConnectDeps } from "../../../plans/connectCodexRecord.js";
import { launchConnectWorker } from "../../../plans/connectLaunch.js";
import { CONNECT_RESERVATION_FILE } from "../../../plans/connectPlan.js";
import { planRegisterPort } from "../../../plans/port.js";
import { stateHomePaths } from "../../../stateHome.js";

/** The program that opens a sign-in page in the default browser. */
const PAGE_OPENER = "/usr/bin/open";

/** A thrown value's message. */
function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a thrown value is a Node error carrying one of these codes. */
function hasCode({ error, codes }: { error: unknown; codes: readonly string[] }): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

/** Move a store aside into a fresh holding directory, answering where it went. */
function retireStoreDir({ storeDir }: { storeDir: string }): Result<string, string> {
  let holding: string;
  try {
    // Exclusive and randomly named, so the rename below can only ever land in a directory this call made.
    holding = mkdtempSync(`${storeDir}.retired-`);
  } catch (error: unknown) {
    return err(messageOf({ error }));
  }
  try {
    renameSync(storeDir, join(holding, "store"));
    return ok(holding);
  } catch (error: unknown) {
    const message = messageOf({ error });
    try {
      // Only an empty directory goes: the rename failed, so nothing of the store is inside it.
      rmdirSync(holding);
      return err(message);
    } catch (removal: unknown) {
      return err(`${message}; the empty ${holding} was left behind: ${messageOf({ error: removal })}`);
    }
  }
}

/** Whether a process is alive: EPERM means it exists under another user, ESRCH that it is gone. */
function processAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return hasCode({ codes: ["EPERM"], error });
  }
}

/** Remove a store directory whole. */
function removeStoreDir({ storeDir }: { storeDir: string }): Result<void, string> {
  try {
    rmSync(storeDir, { force: true, recursive: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err(messageOf({ error }));
  }
}

/** The attempt id a store's reservation file names, or `undefined` when there is none. */
function readStoreReservation({ storeDir }: { storeDir: string }): Result<string | undefined, string> {
  try {
    return ok(readFileSync(join(storeDir, CONNECT_RESERVATION_FILE), "utf8"));
  } catch (error: unknown) {
    if (hasCode({ codes: ["ENOENT", "ENOTDIR"], error })) {
      return ok(undefined);
    }
    return err(messageOf({ error }));
  }
}

/** The ancestors of `dir`, itself included, that are not there yet — outermost first. */
function missingDirs({ dir }: { dir: string }): readonly string[] {
  const missing: string[] = [];
  let probe = dir;
  while (!existsSync(probe) && probe !== dirname(probe)) {
    missing.unshift(probe);
    probe = dirname(probe);
  }
  return missing;
}

/**
 * Make the store's parent one level at a time, each set owner-only the moment it exists: `mkdirSync`'s mode is masked
 * by the umask, so under 0o777 a recursive create lands its first level 0000 and cannot make the next.
 * A directory already standing, or made concurrently by someone else, is left as it is — it is not this call's.
 */
function makeParentDir({ parent }: { parent: string }): Result<void, string> {
  for (const dir of missingDirs({ dir: parent })) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      chmodSync(dir, 0o700);
    } catch (error: unknown) {
      if (!hasCode({ codes: ["EEXIST"], error })) {
        return err(messageOf({ error }));
      }
    }
  }
  return ok(undefined);
}

/** Make the store directory, answering false when one already stands there. */
function makeStoreDir({ storeDir }: { storeDir: string }): Result<boolean, string> {
  // Apart from the store's own create, so a failure under the parent (a file where it belongs) is an error, never "taken".
  const parent = makeParentDir({ parent: dirname(storeDir) });
  if (parent.isErr()) {
    return err(parent.error);
  }
  try {
    // Not recursive, so a directory already standing there fails EEXIST rather than being adopted.
    mkdirSync(storeDir, { mode: 0o700 });
    return ok(true);
  } catch (error: unknown) {
    if (hasCode({ codes: ["EEXIST"], error })) {
      return ok(false);
    }
    return err(messageOf({ error }));
  }
}

/** Mark a directory this call just made as one attempt's, taking it back on a failure. */
function markStoreDir({ attemptId, storeDir }: { attemptId: string; storeDir: string }): Result<boolean, string> {
  try {
    // Residue: the reservation is a file inside the path, not the directory's identity, so a
    // process of the same user that swaps its own directory in between the `mkdirSync` above and the write below has
    // it marked, and a later cleanup removes it. Recording the directory's inode beside the id and comparing it at
    // removal would close that; a same-user process able to do this can delete the directory itself.
    // Explicit, because `mkdirSync`'s mode is masked by the umask: the store is about to hold a sign-in.
    chmodSync(storeDir, 0o700);
    const reservation = join(storeDir, CONNECT_RESERVATION_FILE);
    writeFileSync(reservation, attemptId, { flag: "wx", mode: 0o600 });
    // The same umask masks the file's mode too (under umask 0o777 it lands 0000, unreadable).
    chmodSync(reservation, 0o600);
    return ok(true);
  } catch (error: unknown) {
    // This call made the directory, so it takes it back rather than leave an alias nobody holds.
    const message = messageOf({ error });
    try {
      rmSync(storeDir, { force: true, recursive: true });
      return err(message);
    } catch (removal: unknown) {
      return err(`${message}; ${storeDir} was left behind: ${messageOf({ error: removal })}`);
    }
  }
}

/** Reserve a fresh store directory for one attempt, answering false when the path is already taken. */
function reserveStoreDir({ attemptId, storeDir }: { attemptId: string; storeDir: string }): Result<boolean, string> {
  const made = makeStoreDir({ storeDir });
  if (made.isErr() || !made.value) {
    return made;
  }
  return markStoreDir({ attemptId, storeDir });
}

/**
 * The production effects for one home.
 *
 * @param home the Slopweaver home the attempt and the register belong to
 * @returns the deps every Connect function takes
 */
export function productionCodexConnectDeps({ home }: { home: string }): CodexConnectDeps {
  const port = planRegisterPort();
  const connectionsDir = stateHomePaths({ home }).live.planConnectionsDir;
  return {
    launchWorker: ({ id }) => {
      mkdirSync(connectionsDir, { mode: 0o700, recursive: true });
      const launcher = bundledLauncherPath({ importMetaUrl: import.meta.url });
      return launchConnectWorker({ home, id, launcher, logPath: `${connectionsDir}/worker.log` });
    },
    mintId: () => randomBytes(8).toString("hex"),
    nowMs: () => Date.now(),
    processAlive,
    processId: () => process.pid,
    readRegister: () => port.read({ home }),
    readStoreReservation,
    removeStoreDir,
    reserveStoreDir,
    retireStoreDir,
    runSignIn: ({ cancelPath, codexHome, deadlineMs, signInUrlPath }) =>
      runCodexLoginExchange({ cancelPath, codexHome, deadlineMs, opener: PAGE_OPENER, signInUrlPath }),
    wait: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    writeRegister: ({ mutation }) => port.write({ home, mutation, nowIso: new Date().toISOString() }),
  };
}
