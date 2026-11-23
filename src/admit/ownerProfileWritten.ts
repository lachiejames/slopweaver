/**
 * The mark an owner-profile write leaves on this machine: the durable local evidence that the owner's profile EXISTS, which a
 * selected store is not.
 *
 * The rule: a profile absent on this home means never configured, so every call goes through to onboarding; a
 * profile present and unloaded means hold. A selected store says nothing about a profile — the
 * documented onboarding selects one (`yarn store:start`'s lock writes `store-url`) before its schema exists (`store push`) and long before a
 * profile does (`profile set`), so reading the selection as configuration held `store push` behind a reload that could
 * not succeed until it ran. What the first-boot read counts instead is a profile this home
 * actually held: a cached context (written only by a live read that found the owner's row, `../context/load.ts`), a delivery,
 * a recorded load, or this mark, written by `slopweaver profile set` the moment the row exists. The mark is what holds
 * a session that wrote the profile and then acts without loading it; no read of the store could say so per call.
 *
 * It is `profile/owner-written` under the writer's resolved home and every default home, since the hook judges by its
 * own environment's homes, not the writer's. `hooks/lib/profile-delivered.sh` reads the same file; change both or
 * neither. The mark and the row move together, so neither may claim what the other does not, and
 * `writeUnderOwnerMark` (`./ownerProfileWrite.ts`) is the one way a row is written:
 *
 * - **No row without a mark.** The row is refused when any home cannot take the mark, or cannot take a session's
 *   first-boot mark (`./firstBootSession.ts`) — the one that holds a session admitted on a first boot once the row
 *   exists. A row nothing on this machine knows of reads as a first boot, and a session acts on it unloaded (a full disk,
 *   then an unwritable `profile/first-boot/`).
 * - **No mark without a row.** When the write fails or throws, the marks this write created are retracted only once a
 *   re-read of the store PROVES no row exists: a mark over an empty owner table holds every call while `profile
 *   context` can only load nothing, wedging onboarding, while a row a lost acknowledgement or
 *   another writer committed must keep its mark.
 * - **One writer at a time.** The whole sequence holds a lock in the account's own home, so a second `profile set` is
 *   refused rather than interleaved: a writer that lost the insert to one that found its marks already made retracted
 *   the only evidence of the winner's row.
 * - **A mark the store disproves is taken back.** A mark names, one per line, the fingerprint of every store a row was
 *   written to (`../context/cache.ts`'s `storeFingerprint`, never the URL), and every live load (`profile context`, the SessionStart hook, the prompt-time check) withdraws
 *   the store it just read live and found no owner row in, under the same lock so no write is in flight
 *   (`./ownerProfileWrite.ts`, `settleOwnerMarks`); the file goes only when it names no store left. A `profile set`
 *   killed between its mark and its row — SIGKILL, a host timeout, power loss — runs no retraction of its own, and the
 *   mark it left would hold a fresh machine for a profile no store has; the hold's own recovery
 *   verb clears it. One store per FILE let a killed writer's mark for store A stand in for a later row in store B, and
 *   an empty read of A then deleted B's only evidence.
 *
 * Residue: a profile restored by SQL (`store backup recover`) or written by hand leaves no mark until the next load
 * caches it; a failed write whose re-read also fails keeps its marks until `profile context` reads the store empty.
 * The bash lane reads only that a mark exists, never whose store it names. The directory entry is synced best-effort,
 * since not every filesystem takes a directory `fsync`; the mark's contents always are.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { sessionMarkable } from "./firstBootSession.js";

/**
 * Where the owner-written mark lives under one home.
 *
 * @param home a Slopweaver home
 * @returns the mark's path
 */
export function ownerProfileWrittenPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).profileOwnerWritten;
}

/** A mark's contents: what it says, or that nothing stands there. A read that cannot answer throws. */
type MarkRead = { readonly kind: "absent" } | { readonly kind: "names"; readonly stores: readonly string[] };

/** Read the stores a mark names, one fingerprint per line; a path with nothing at it names none. */
function readMark({ path }: { path: string }): MarkRead {
  try {
    return {
      kind: "names",
      stores: readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.length > 0),
    };
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { kind: "absent" };
    }
    throw cause;
  }
}

/**
 * Replace a mark whole and durably through the repo's one atomic writer: a synced staging file renamed into place,
 * then the directory synced as far as the filesystem allows. Written in place, a kill mid-write left a truncated mark
 * no store could disprove; unsynced, power loss could keep the rename and lose the
 * contents, or keep the row and lose the mark. The rename replaces, so every caller holds the
 * owner-write lock (`./ownerProfileWrite.ts`) between reading a mark and replacing it. A staging file a kill leaves is
 * no trace: nothing reads its name.
 */
function replaceMark({ path, stores }: { path: string; stores: readonly string[] }): void {
  writeFileAtomic({ contents: stores.join("\n"), path });
}

/** Sync a directory's entries where the filesystem takes a directory `fsync`; where it does not, the rename stands. */
function syncDirectory({ path }: { path: string }): void {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // Not every filesystem syncs a directory; the mark's own contents were synced before the rename.
  } finally {
    closeSync(fd);
  }
}

/**
 * Leave the owner-written mark naming `store` in every home named. A home whose first-boot session directory cannot
 * take a mark fails too.
 *
 * @param homes the writer's resolved home and the default homes; a repeat is written once
 * @param store the fingerprint of the store the row is written to, which the mark is made to name
 * @returns `created`, the marks this call made name `store`, which a failed write withdraws; `failed`, the homes that
 *   could not
 */
export function markOwnerProfileWritten({ homes, store }: { homes: readonly string[]; store: string }): {
  readonly created: readonly string[];
  readonly failed: readonly string[];
} {
  const created: string[] = [];
  const failed: string[] = [];
  for (const home of new Set(homes)) {
    const path = ownerProfileWrittenPath({ home });
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      failed.push(home);
      continue;
    }
    if (!sessionMarkable({ home })) {
      failed.push(home);
      continue;
    }
    try {
      const read = readMark({ path });
      const stores = read.kind === "names" ? read.stores : [];
      if (!stores.includes(store)) {
        replaceMark({ path, stores: [...stores, store] });
        created.push(path);
      }
    } catch {
      // A mark that cannot be read or replaced: the row would stand with no mark naming its store.
      failed.push(home);
    }
  }
  return { created, failed };
}

/**
 * Withdraw `store` from these marks — after the write they announced failed and no row was found, or after a live read
 * of `store` found no owner row. A mark left naming no store is removed; one naming another store stays, naming it.
 *
 * @param paths marks that name `store`
 * @param store the fingerprint to withdraw
 * @returns the paths that could not be withdrawn, empty when every one was
 */
export function retractOwnerProfileWritten({
  paths,
  store,
}: {
  paths: readonly string[];
  store: string;
}): readonly string[] {
  const kept: string[] = [];
  for (const path of paths) {
    try {
      const read = readMark({ path });
      if (read.kind === "absent") {
        continue;
      }
      const rest = read.stores.filter((named) => named !== store);
      if (rest.length === 0) {
        rmSync(path, { force: true });
        syncDirectory({ path: dirname(path) });
      } else if (rest.length < read.stores.length) {
        replaceMark({ path, stores: rest });
      }
    } catch {
      kept.push(path);
    }
  }
  return kept;
}

/**
 * The marks under these homes that name `store`, which a live read of that store finding no owner row disproves. A
 * mark that cannot be read, or names only other stores, is not one.
 *
 * @param homes the resolved home and the default homes
 * @param store the fingerprint of the store the live read answered from
 * @returns the paths of the marks naming that store
 */
export function ownerMarksNaming({ homes, store }: { homes: readonly string[]; store: string }): readonly string[] {
  const naming: string[] = [];
  for (const home of new Set(homes)) {
    const path = ownerProfileWrittenPath({ home });
    try {
      const read = readMark({ path });
      if (read.kind === "names" && read.stores.includes(store)) {
        naming.push(path);
      }
    } catch {
      // Unreadable stays, which holds — the safe side.
    }
  }
  return naming;
}
