/**
 * What the `profile-held` check reads to tell a FIRST BOOT from a home that lost the owner's profile: the surviving evidence,
 * on disk, that the owner's profile ever existed on or reached this machine. A selected store is not that evidence
 * (`./ownerProfileWritten.ts`).
 *
 * Why the hold opens there at all is `./profileHeld.ts` (`FirstBootEvidence`). This module is only the read, and it
 * fails CLOSED: absence is an `ENOENT` and nothing else, so a path that cannot be stat'd, a ledger that cannot be read
 * or holds a line that is not a row, and a delivery directory that cannot be listed are all errors, which the caller
 * treats as configured. `existsSync` and `tokenFromEnvOrHomeFile` are deliberately not used: both read an unreadable
 * path as an absent one, which is the right answer for a credential fallback and the wrong one for a safety decision.
 *
 * It reads the resolved home AND `~/.slopweaver`, under both `$HOME` and the account's own home directory: a session
 * whose `$SLOPWEAVER_HOME` or `$HOME` points at an empty directory on a machine whose default home holds the owner's profile
 * is a wrong home, not a first boot, and the two look identical from the resolved home alone.
 *
 * Opens no store and writes nothing, so it adds no database driver to the PreToolUse dispatcher's bundle.
 * `hooks/lib/profile-delivered.sh`'s `profile_first_boot` is its bash twin, for the lane no node can run; change both
 * or neither.
 */
import { lstatSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { contextCopyPath } from "../context/cache.js";
import { readProfileLoads } from "../context/loadLedgerStore.js";
import { accountDefaultHome, userDefaultHome } from "../homeDir.js";
import { stateHomePaths } from "../stateHome.js";

import { ownerProfileWrittenPath } from "./ownerProfileWritten.js";

import { type FirstBootEvidence, neverConfigured } from "./profileHeld.js";

/** A path whose presence could not be settled: anything but `ENOENT` from `lstat` or `readdir`. */
export interface FirstBootPathUnreadableError {
  readonly code: "FIRST_BOOT_PATH_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The user database has no entry for this account, so the home no environment variable moves cannot be named. */
export interface FirstBootAccountUnknownError {
  readonly code: "FIRST_BOOT_ACCOUNT_UNKNOWN";
  readonly message: string;
}

/** The load ledger could not be read whole, or carried a line that is not a row, so its history is unknown. */
export interface FirstBootLedgerUnknownError {
  readonly code: "FIRST_BOOT_LEDGER_UNKNOWN";
  readonly message: string;
  readonly path: string;
}

/** Why the evidence could not be read; every variant means "treat this home as configured". */
export type FirstBootReadError =
  FirstBootAccountUnknownError | FirstBootPathUnreadableError | FirstBootLedgerUnknownError;

/** Factories for {@link FirstBootReadError}. */
export const FirstBootReadErrors = {
  accountUnknown: ({ cause }: { cause: unknown }): FirstBootAccountUnknownError => ({
    code: "FIRST_BOOT_ACCOUNT_UNKNOWN",
    message: `the account's own home could not be read from the user database: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  ledgerUnknown: ({ path, detail }: { path: string; detail: string }): FirstBootLedgerUnknownError => ({
    code: "FIRST_BOOT_LEDGER_UNKNOWN",
    message: `the profile load ledger at ${path} cannot say whether the owner's profile was ever held: ${detail}`,
    path,
  }),
  pathUnreadable: ({ path, cause }: { path: string; cause: unknown }): FirstBootPathUnreadableError => ({
    code: "FIRST_BOOT_PATH_UNREADABLE",
    message: `whether ${path} exists could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/** Whether a thrown filesystem error is a plain "not there". */
function isMissing({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * Whether `path`'s `ENOENT` is a proven absence: its nearest existing ancestor resolves to a real directory. A
 * dangling link anywhere above it raises the same `ENOENT` while hiding whatever it pointed at, so that is
 * unreadable, never absent.
 */
function absenceProven({ path }: { path: string }): Result<false, FirstBootReadError> {
  const parent = dirname(path);
  if (parent === path) {
    return ok(false);
  }
  try {
    lstatSync(parent);
  } catch (cause: unknown) {
    return isMissing({ cause })
      ? absenceProven({ path: parent })
      : err(FirstBootReadErrors.pathUnreadable({ cause, path: parent }));
  }
  try {
    if (statSync(parent).isDirectory()) {
      return ok(false);
    }
    return err(FirstBootReadErrors.pathUnreadable({ cause: new Error("not a directory"), path: parent }));
  } catch (cause: unknown) {
    return err(FirstBootReadErrors.pathUnreadable({ cause, path: parent }));
  }
}

/** Whether anything at all sits at `path` — a dangling symlink, an empty file and a directory all count. */
function present({ path }: { path: string }): Result<boolean, FirstBootReadError> {
  try {
    lstatSync(path);
    return ok(true);
  } catch (cause: unknown) {
    // `ENOTDIR`: an ancestor is a plain file, so nothing can sit below it — as absent as `ENOENT` over a real directory,
    // and the bash twin reads it so (a stray file at `<home>/secrets` would otherwise wedge a fresh machine).
    if (isNotDirectory({ cause })) {
      return ok(false);
    }
    return isMissing({ cause }) ? absenceProven({ path }) : err(FirstBootReadErrors.pathUnreadable({ cause, path }));
  }
}

/** Whether a thrown filesystem error says an ancestor of the path is not a directory. */
function isNotDirectory({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOTDIR";
}

/** Whether the delivery directory holds any entry: a marker means the owner's profile reached a context on this home. */
function anyDelivery({ dir }: { dir: string }): Result<boolean, FirstBootReadError> {
  const exists = present({ path: dir });
  if (exists.isErr() || !exists.value) {
    return exists;
  }
  try {
    return ok(readdirSync(dir).length > 0);
  } catch (cause: unknown) {
    // A plain file where the directory belongs, or a link resolving to one: no marker can sit in it, so no delivery —
    // the `ENOTDIR` reading `present` makes, and the bash twin's.
    if (isNotDirectory({ cause })) {
      return ok(false);
    }
    return err(FirstBootReadErrors.pathUnreadable({ cause, path: dir }));
  }
}

/**
 * Whether the load ledger records a load that carried the owner's profile, `live` or `cache`. A `none` row does not count, and
 * nor does a live read that found the store holding no owner row: neither is evidence a profile ever existed.
 */
function ledgerLoaded({ home }: { home: string }): Result<boolean, FirstBootReadError> {
  const path = stateHomePaths({ home }).profileLoadsJsonl;
  const exists = present({ path });
  if (exists.isErr() || !exists.value) {
    return exists;
  }
  // `readProfileLoads` answers an empty ledger for anything `existsSync` misses, a dangling link included, so the
  // entry `lstat` found must also resolve before its answer is believed.
  try {
    statSync(path);
  } catch (cause: unknown) {
    return err(FirstBootReadErrors.pathUnreadable({ cause, path }));
  }
  const read = readProfileLoads({ home });
  if (read.isErr()) {
    return err(FirstBootReadErrors.ledgerUnknown({ detail: read.error.join("; "), path }));
  }
  if (read.value.undecodable > 0) {
    const detail = `${String(read.value.undecodable)} line(s) are no row`;
    return err(FirstBootReadErrors.ledgerUnknown({ detail, path }));
  }
  return ok(read.value.rows.some((row) => row.origin !== "none" && row.ownerAbsent !== true));
}

/** One home's evidence. */
function homeEvidence({ home }: { home: string }): Result<FirstBootEvidence, FirstBootReadError> {
  const paths = stateHomePaths({ home });
  const written = present({ path: ownerProfileWrittenPath({ home }) });
  if (written.isErr()) {
    return err(written.error);
  }
  const cacheJson = present({ path: paths.profileContextJson });
  if (cacheJson.isErr()) {
    return err(cacheJson.error);
  }
  const cacheText = present({ path: contextCopyPath({ cachePath: paths.profileContextJson }) });
  if (cacheText.isErr()) {
    return err(cacheText.error);
  }
  const delivered = anyDelivery({ dir: paths.profileDeliveredDir });
  if (delivered.isErr()) {
    return err(delivered.error);
  }
  const ledger = ledgerLoaded({ home });
  if (ledger.isErr()) {
    return err(ledger.error);
  }
  return ok({
    cacheExists: cacheJson.value || cacheText.value,
    everLoaded: delivered.value || ledger.value,
    ownerWritten: written.value,
  });
}

/**
 * The default homes first-boot evidence is read from beside the resolved one: `~/.slopweaver` as `$HOME` names it, and
 * as the user database names it, which no environment variable moves — a session started with `HOME` pointed at an
 * empty directory would otherwise hide the owner's real default home (`accountDefaultHome`).
 *
 * @returns both default homes, or an error when the account has no user-database entry, which the caller holds on
 */
export function machineDefaultHomes(): Result<readonly string[], FirstBootReadError> {
  try {
    return ok([userDefaultHome(), accountDefaultHome()]);
  } catch (cause: unknown) {
    return err(FirstBootReadErrors.accountUnknown({ cause }));
  }
}

/**
 * Read the first-boot evidence across every home named, ORing each signal: any home carrying any trace closes it.
 *
 * @param homes the resolved home and the user's default one; a repeat is read once
 * @returns the combined evidence, or the first read that could not be settled
 */
export function readFirstBootEvidence({
  homes,
}: {
  homes: readonly string[];
}): Result<FirstBootEvidence, FirstBootReadError> {
  let all: FirstBootEvidence = { cacheExists: false, everLoaded: false, ownerWritten: false };
  for (const home of new Set(homes)) {
    const one = homeEvidence({ home });
    if (one.isErr()) {
      return err(one.error);
    }
    all = {
      cacheExists: all.cacheExists || one.value.cacheExists,
      everLoaded: all.everLoaded || one.value.everLoaded,
      ownerWritten: all.ownerWritten || one.value.ownerWritten,
    };
  }
  return ok(all);
}

/**
 * Whether this machine carries no surviving evidence of the owner's profile, read across `home` and both default
 * homes exactly as the `profile-held` hold reads it — the one verdict every load's printed block and the by-hand
 * reload's exit code follow. Any read that cannot be settled is a configured machine.
 *
 * @param home the resolved Slopweaver home
 * @returns true only when every home was read and none carries a trace
 */
export function machineNeverConfigured({ home }: { home: string }): boolean {
  const defaults = machineDefaultHomes();
  if (defaults.isErr()) {
    return false;
  }
  const evidence = readFirstBootEvidence({ homes: [home, ...defaults.value] });
  return evidence.isOk() && neverConfigured({ evidence: evidence.value });
}
