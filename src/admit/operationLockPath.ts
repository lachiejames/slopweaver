/**
 * Where an operation lock lives on disk: one directory per key, under a home's ledgers unless a caller names the
 * directory itself (`../codexPlugin/sync.ts` keeps its lock beside the cache it guards). `./operationLock.ts` takes
 * and releases the lock; this module only names it, so a caller checking its own write paths reads the same answer.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { stateHomePaths } from "../stateHome.js";

/**
 * The directory holding one lock directory per key.
 *
 * Exported so a caller that must know an append WILL be able to lock, before an act it cannot undo, can check
 * the directory the lock is made in rather than restating its path.
 *
 * @param home the state home
 * @returns the lock directory, which may not exist yet
 */
export function operationLockDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "operation-locks");
}

/**
 * Where one key's lock lives — what a caller checking its own write paths has to include. The name is the key
 * hashed filesystem-safe, the way `prLedger.ts` hashes its own loci.
 *
 * @param home the state home
 * @param directory where the lock lives instead, as `./operationLock.ts`'s acquire was given it
 * @param key the lock's name
 * @returns the lock's own directory, which may not exist yet
 */
export function operationLockPath({
  home,
  directory = operationLockDir({ home }),
  key,
}: {
  home: string;
  directory?: string | undefined;
  key: string;
}): string {
  return join(directory, `${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32)}.lock`);
}
