/**
 * `slopweaver store lock` and `slopweaver store start` — close the local stack's password doors from the Mac,
 * and start the stack with the lock applied. Thin shells: the acts are `src/store/lock/reconcile.ts`, the flags
 * and lines `./lockCore.ts`, the pre-lock backup's effects `./lockBackupDeps.ts` and the pending-password file
 * `src/store/lock/pendingFile.ts`. The page that chose this design is `$SLOPWEAVER_HOME/pages/store-door-only/`;
 * the reference is `skills/store/reference/local-lock.md`.
 *
 * `store start` is what `yarn store:start` runs, so nobody starts the stack without the lock: a container recreate
 * restores the image's `pg_hba.conf`, and the start re-applies the rule straight after.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { writeSecretFile } from "../../../secrets/store.js";
import { STORE_URL_SECRET, storeUrlSelection } from "../../../store/config.js";
import {
  adminCount,
  adminSql,
  holdStackLock,
  installHbaFile,
  postmasterStartOverSocket,
  publishedPorts,
  readHbaFile,
  readRules,
  reloadAndReadRules,
  stackGateway,
} from "../../../store/lock/edge.js";
import { type StoreLockError, StoreLockErrors } from "../../../store/lock/errors.js";
import { type FoundSelection, type StackIdentity, stackIdentity } from "../../../store/lock/localStack.js";
import { hostIsLocal, loginUntilRefused, tryLogin } from "../../../store/lock/macLogin.js";
import {
  clearPendingInPlace,
  pendingPath,
  syncPendingInPlace,
  syncSecretsChain,
  writePendingInPlace,
} from "../../../store/lock/pendingFile.js";
import { type LockDeps, reconcileLock } from "../../../store/lock/reconcile.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";
import { storeTail } from "./core.js";
import { takeBackup } from "./lockBackupDeps.js";
import { type LockArgs, lockLines, parseLockArgs, pinnedStart } from "./lockCore.js";
import { LOCK_USAGE, START_USAGE } from "./lockUsage.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";

/**
 * How long `supabase start` may run before the start is called failed: a first start pulls every image, which on a
 * slow link takes minutes, so this sits well past that; it exists so a start wedged on a prompt nobody sees ends.
 */
const SUPABASE_START_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The stack a checkout's config names.
 *
 * @param workdir the checkout
 * @returns its identity, or why the config could not be read
 */
export function readStack({ workdir }: { workdir: string }): Result<StackIdentity, StoreLockError> {
  let text: string;
  try {
    text = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(StoreLockErrors.notLocalStack({ detail: `supabase/config.toml could not be read: ${why}` }));
  }
  return stackIdentity({ configToml: text });
}

/**
 * The store selection as the lock reads it: none, or the selection with its origin.
 *
 * @param home the Slopweaver home
 * @returns the selection, or why it could not be read
 */
export function foundSelection({ home }: { home: string }): Result<FoundSelection, StoreLockError> {
  const selection = storeUrlSelection({ home });
  if (selection.isOk()) {
    return ok({ origin: selection.value.origin, url: selection.value.url });
  }
  if (selection.error.code === "STORE_URL_MISSING") {
    return ok(null);
  }
  return err(StoreLockErrors.notLocalStack({ detail: selection.error.message }));
}

/**
 * The production effects.
 *
 * @returns every effect the lock performs
 */
export function productionLockDeps(): LockDeps {
  return {
    adminCount,
    adminSql,
    clearPending: clearPendingInPlace,
    holdStackLock,
    hostIsLocal,
    installHbaFile,
    loginUntilRefused,
    postmasterStartOverSocket,
    progress: ({ line }) => {
      logger.error({ msg: line });
    },
    publishedPorts,
    randomBytes: ({ size }) => randomBytes(size),
    readHbaFile,
    readPending: ({ home, projectId }) => {
      const path = pendingPath({ home, projectId });
      if (!existsSync(path)) {
        return null;
      }
      return readFileSync(path, "utf8").trim();
    },
    readRules,
    reloadAndReadRules,
    stackGateway,
    syncPending: ({ home, projectId }) => {
      try {
        syncPendingInPlace({ path: pendingPath({ home, projectId }) });
        return ok(undefined);
      } catch (cause: unknown) {
        const why = cause instanceof Error ? cause.message : String(cause);
        return err(StoreLockErrors.secretWriteFailed({ reasons: [`syncing store-lock/pending-login: ${why}`] }));
      }
    },
    takeBackup: takeBackup(),
    tryLogin,
    writePending: ({ home, password, projectId }) => {
      try {
        writePendingInPlace({ password, path: pendingPath({ home, projectId }) });
        return ok(undefined);
      } catch (cause: unknown) {
        const why = cause instanceof Error ? cause.message : String(cause);
        return err(StoreLockErrors.secretWriteFailed({ reasons: [`store-lock/pending-login: ${why}`] }));
      }
    },
    writeStoreUrl: ({ home, url }) =>
      writeSecretFile({ home, name: STORE_URL_SECRET, value: url })
        .mapErr((error) => StoreLockErrors.secretWriteFailed({ reasons: [error.message] }))
        .andThen((written) => syncSecretsChain({ path: written.path })),
  };
}

/**
 * The checkout whose config names the stack: `--workdir`, else this one.
 *
 * @param workdir the checkout the caller named, absent for this one
 * @returns the directory
 */
export function workdirOf({ workdir }: { workdir: string | undefined }): string {
  if (workdir !== undefined) {
    return workdir;
  }
  return installedTreeRoot({ importMetaUrl: import.meta.url });
}

/**
 * Run the lock for parsed flags and print its report.
 *
 * @param args the parsed flags
 * @returns the exit code
 */
async function lockAndReport({ args }: { args: LockArgs }): Promise<number> {
  const home = resolvedHome({ home: args.home });
  const stack = readStack({ workdir: workdirOf({ workdir: args.workdir }) });
  if (stack.isErr()) {
    return fail({ lines: [`store lock: ${stack.error.message}`] });
  }
  const selection = foundSelection({ home });
  if (selection.isErr()) {
    return fail({ lines: [`store lock: ${selection.error.message}`] });
  }
  const report = await reconcileLock({
    deps: productionLockDeps(),
    request: { home, rotate: args.rotate, selection: selection.value, stack: stack.value },
  });
  if (report.isErr()) {
    return fail({ lines: [`store lock: ${report.error.message}`] });
  }
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "store lock report", value: report.value }) });
  } else {
    lockLines({ report: report.value }).forEach((line) => {
      logger.out({ line });
    });
  }
  return EXIT_OK;
}

/**
 * Close the local stack's password doors from the Mac.
 *
 * @param argv the full process argv
 * @returns the exit code — 0 locked and proven, 1 refused or failed, 2 a caller mistake
 */
export async function runStoreLock(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LOCK_USAGE });
    return EXIT_OK;
  }
  const args = parseLockArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: LOCK_USAGE });
  }
  return lockAndReport({ args: args.value });
}

/**
 * Start the local stack through the pinned Supabase CLI, then lock it.
 *
 * @param argv the full process argv
 * @returns the exit code — 0 started, locked and proven; 1 the start or the lock failed
 */
export async function runStoreStart(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: START_USAGE });
    return EXIT_OK;
  }
  const args = parseLockArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: START_USAGE });
  }
  const launch = pinnedStart({
    env: process.env,
    nodePath: process.execPath,
    treeRoot: installedTreeRoot({ importMetaUrl: import.meta.url }),
    workdir: workdirOf({ workdir: args.value.workdir }),
  });
  const started = spawnSync(launch.command, [...launch.args], {
    env: launch.env,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: SUPABASE_START_TIMEOUT_MS,
  });
  if (started.error !== undefined) {
    const timedOut = "code" in started.error && started.error.code === "ETIMEDOUT";
    if (timedOut) {
      return fail({
        lines: [
          `store start: supabase start ran past ${String(SUPABASE_START_TIMEOUT_MS / 60_000)} minutes and was stopped — the stack is not locked`,
        ],
      });
    }
    return fail({ lines: [`store start: the Supabase CLI did not launch: ${started.error.message}`] });
  }
  if (started.status !== 0) {
    return fail({ lines: [`store start: supabase start exited ${String(started.status)} — the stack is not locked`] });
  }
  return lockAndReport({ args: args.value });
}

export const storeLockCommand = defineCommand({ run: runStoreLock });
export const storeStartCommand = defineCommand({ run: runStoreStart });
