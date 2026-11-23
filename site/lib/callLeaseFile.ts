/**
 * The call lease as a FILE in the hold directory the production server was started with — the one place a lease is
 * written or removed, so the page's beat (`/api/console/call`) and the mint's own hold (`/api/talk/offer`) cannot
 * drift apart. `scripts/docs-site.sh`'s refresh round reads every unexpired `calls/*.json` and holds its swap while
 * one stands; `site/lib/consoleHold.ts` says why.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CallLease } from "./consoleHold";

/** The environment variable `scripts/docs-site.sh` starts a production server with. */
export const HOLD_DIR_ENV = "SLOPWEAVER_CONSOLE_HOLD_DIR";

/**
 * The hold directory this server was started with, or `undefined` for a server with no rebuild to hold — `yarn dev`,
 * a build CI runs.
 *
 * @returns the directory, or `undefined`
 */
export function consoleHoldDir(): string | undefined {
  const dir = process.env[HOLD_DIR_ENV];
  if (dir === undefined || dir === "") {
    return undefined;
  }
  return dir;
}

/**
 * Replace one file atomically and durably: stage a uniquely named sibling, fsync it, rename it over the target, then
 * flush the directory. `site/` never imports `src/`, so this is `src/lib/writeAtomic.ts`'s `writeFileAtomic` written
 * out in the same shape. The staged name carries a uuid so two beats for one call never share a temp file (a
 * pid-only name made the second rename fail with ENOENT), `wx` turns an impossible collision into an error, and a
 * failure removes the stage instead of leaving it beside the lease (best effort: a directory that lost write
 * permission cannot have the stage removed either, and the original error still surfaces).
 *
 * @param contents the whole new body
 * @param path the file to replace
 */
async function writeFileAtomic({ contents, path }: { contents: string; path: string }): Promise<void> {
  const staged = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    const handle = await open(staged, "wx");
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(staged, path);
  } catch (error: unknown) {
    // Best effort: when the failure was the directory losing write permission the removal fails the same way, and
    // the caller must still see the write's own error rather than the cleanup's.
    await rm(staged, { force: true }).catch(() => undefined);
    throw error;
  }
  try {
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // A directory cannot be flushed on every platform; the lease's own bytes are already on the device.
  }
}

/**
 * Write one lease, renamed into place so the refresh round's `jq` never reads a half-written file.
 *
 * @param dir the hold directory
 * @param lease the lease, whose `callId` names its file
 */
export async function writeCallLease({ dir, lease }: { dir: string; lease: CallLease }): Promise<void> {
  const calls = join(dir, "calls");
  await mkdir(calls, { recursive: true });
  await writeFileAtomic({ contents: JSON.stringify(lease), path: join(calls, `${lease.callId}.json`) });
}

/**
 * Remove one lease, which ends its hold at once. A lease already gone is no failure.
 *
 * @param dir the hold directory
 * @param callId the id the lease was written under
 */
export async function removeCallLease({ dir, callId }: { dir: string; callId: string }): Promise<void> {
  await rm(join(dir, "calls", `${callId}.json`), { force: true });
}
