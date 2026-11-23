/**
 * The two filesystem reads `plans` makes of a store directory itself, as the production halves of
 * `./run.ts`'s `ensureStoreDir` and `resolveStore` seams. Split out because neither touches the register: one makes
 * sure a newly registered Codex home can take a sign-in, the other names the directory a path reaches on disk.
 */
import { accessSync, chmodSync, constants, existsSync, mkdirSync, statSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

/**
 * Create a Codex home that is not there yet, as 0700, and refuse one that cannot take a sign-in.
 *
 * @param storeDir the Codex home about to be registered
 * @returns `created` or `existed`, or the reason the home cannot be used
 */
export function ensureStoreDirLive({ storeDir }: { storeDir: string }): Result<"created" | "existed", string> {
  try {
    const existed = existsSync(storeDir) && statSync(storeDir).isDirectory();
    if (!existed) {
      // A regular file at the path is not a home: this `mkdirSync` throws EEXIST on it, as the printed
      // `mkdir -p` would, so the add is refused rather than registering a home nobody can sign into.
      mkdirSync(storeDir, { recursive: true });
      // 0700, set explicitly because `mkdirSync`'s `mode` is masked by the umask (a Codex review: under
      // `umask 0200` it made 0500): the directory is about to hold the provider CLI's own login.
      chmodSync(storeDir, 0o700);
    }
    // A home they cannot write or enter takes no sign-in either, existing or just made: this throws EACCES.
    accessSync(storeDir, constants.W_OK | constants.X_OK);
    if (existed) {
      return ok("existed");
    }
    return ok("created");
  } catch (error: unknown) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The directory a store path names on disk, so two rows over one sign-in are caught (`./storeAlias.ts`).
 *
 * @param storeDir the store path a row names
 * @returns `<dev>:<ino>`, or undefined when nothing is there
 */
export function resolveStoreLive({ storeDir }: { storeDir: string }): string | undefined {
  // An absent store has no directory to share, which is an answer rather than a failure (`./storeAlias.ts`).
  if (!existsSync(storeDir)) {
    return undefined;
  }
  // Device and inode, never a path string: macOS reaches one directory as `/private/x` and as
  // `/System/Volumes/Data/private/x`, and `realpath` returns both unchanged (a Codex review found it).
  const { dev, ino } = statSync(storeDir);
  return `${String(dev)}:${String(ino)}`;
}
