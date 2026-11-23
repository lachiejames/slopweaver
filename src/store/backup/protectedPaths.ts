/**
 * The owner's protected-path registry (`../../protectedPaths/registry.ts`), as a backup applies it.
 *
 * A backup is run BY a session, so it is a session's read and a session's write by proxy: the files leg walking
 * `corpus/bronze` whole read straight through a `no-access` folder under it, and nothing here asked. Three rules,
 * each on top of the pure decision in `../../protectedPaths/decide.ts` rather than a second path comparison:
 *
 * - **A source at or under a `no-access` path is never listed or read.** The walk prunes it before its directory is
 *   opened (`./files.ts`), and the run names it with the owner's reason. A `read-only` path is still carried: the
 *   backup only reads it.
 * - **A place the run writes to — the staging root, each destination — is refused at or under ANY protected path, or
 *   when it holds a `no-access` one**, since a destination's own listing would read into it. A destination refused is
 *   that destination's failed arm, so it reads red; the staging root refused holds the whole run.
 * - **A registry that cannot be read or does not parse HOLDS the run.** The `PreToolUse` guard fails open on it,
 *   deliberately, because a tripwire that failed closed would wedge every tool call. A backup is the opposite case:
 *   one night held is cheap, and a walk over an unknown protection is exactly the read this module exists to stop.
 *
 * Which registries apply: the home in use and the account's default home, the pair every store verb reads through
 * `../../protectedPaths/ownerEntries.ts`'s `protectionHomes` — a `--home` run is still bound by what the owner
 * protected in their own.
 * The registry read and the entry spellings stay here: that module merges an unreadable and a malformed registry
 * into one error, and resolves each entry's own path, where this one resolves only its parent.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { protectionHitAny } from "../../protectedPaths/decide.js";
import { protectionHomes } from "../../protectedPaths/ownerEntries.js";
import { type ProtectedPath, readProtectedPaths } from "../../protectedPaths/registry.js";
import { stateHomePaths } from "../../stateHome.js";

import { type BackupProtectionError, BackupProtectionErrors } from "./protectedPathsErrors.js";
import { stagingRoot } from "./staging.js";

/** Every protected entry that applies to one run, read once before anything is touched. */
export interface BackupProtection {
  readonly entries: readonly ProtectedPath[];
}

/** One source the walk left out because the owner protects it, with the owner's reason. */
export interface SkippedProtectedPath {
  readonly path: string;
  readonly why: string;
}

/** How a run's protection is read, so a test hands in its own and never reads the owner's registry. */
export type ReadBackupProtection = (args: { home: string }) => Result<BackupProtection, BackupProtectionError>;

/** A run that protects nothing: what a fixture passes when protection is not the subject. */
export const NO_PROTECTION: BackupProtection = { entries: [] };

/**
 * Read every registry that applies to a run, failing closed on any one that cannot be read or parsed.
 *
 * @param homes the Slopweaver homes whose registries apply
 * @param readText reads a file's text, `undefined` when there is none, and throws on any other failure
 * @returns the entries, or why the owner's protection is unknown
 */
export function readProtectionFrom({
  homes,
  readText,
}: {
  homes: readonly string[];
  readText: (args: { path: string }) => string | undefined;
}): Result<BackupProtection, BackupProtectionError> {
  const entries: ProtectedPath[] = [];
  for (const home of new Set(homes)) {
    const read = readProtectedPaths({ file: stateHomePaths({ home }).protectedPathsJson, readText });
    if (read.isErr()) {
      const { code, file, message } = read.error;
      return err(
        code === "REGISTRY_MALFORMED"
          ? BackupProtectionErrors.malformed({ file, why: message })
          : BackupProtectionErrors.unreadable({ file, why: message }),
      );
    }
    for (const entry of read.value.paths) {
      entries.push(entry);
    }
  }
  return ok({ entries });
}

/**
 * Every entry, plus a second spelling of it wherever the folder holding it resolves elsewhere. The walk and the
 * destination check compare a RESOLVED path too, and on this machine the temp directory alone is `/var/…` spelled
 * and `/private/var/…` resolved, so an entry compared only as written would miss the very path it names.
 *
 * Only the entry's PARENT is resolved, never the entry itself: resolving a protected path would stat it, and this
 * module's whole job is to keep a backup off one. The cost is stated: an entry that is itself a link is matched by
 * its own spelling only.
 *
 * @param protection the entries as the registries hold them
 * @param resolveParent where one folder really is, `undefined` when it cannot be resolved
 * @returns the entries with every distinct resolved spelling added beside its original
 */
export function withResolvedSpellings({
  protection,
  resolveParent,
}: {
  protection: BackupProtection;
  resolveParent: (args: { path: string }) => string | undefined;
}): BackupProtection {
  const entries: ProtectedPath[] = [];
  for (const entry of protection.entries) {
    entries.push(entry);
    const parent = resolveParent({ path: dirname(entry.path) });
    if (parent === undefined) {
      continue;
    }
    const resolved = join(parent, basename(entry.path));
    if (resolved !== entry.path) {
      entries.push({ ...entry, path: resolved });
    }
  }
  return { entries };
}

/**
 * Where one folder really is, off the filesystem.
 *
 * @param path the folder
 * @returns its resolved path, or `undefined` when it is absent or cannot be resolved
 */
export function resolvedFolder({ path }: { path: string }): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * The production reader: the homes every store verb honours (`protectionHomes`, the home in use and the account's
 * own default, which no `$HOME` moves), off the filesystem, each entry also under its resolved spelling.
 *
 * @param home the Slopweaver home in use
 * @returns the entries, or why the owner's protection is unknown
 */
export const readBackupProtection: ReadBackupProtection = ({ home }) =>
  protectionHomes({ home })
    .mapErr((error) => BackupProtectionErrors.unreadable({ file: "of the account's default home", why: error.message }))
    .andThen((homes) =>
      readProtectionFrom({
        homes,
        readText: ({ path }) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
      }),
    )
    .map((protection) => withResolvedSpellings({ protection, resolveParent: resolvedFolder }));

/**
 * The `no-access` entry a source path is at or under, if any — the walk's question before it opens a directory or
 * digests a file. A `read-only` entry never answers: a backup only reads.
 *
 * @param protection the run's entries
 * @param targets every spelling of the source, the path as walked and the one it resolves to
 * @returns the entry that withholds it, or `undefined`
 */
export function sourceProtectionHit({
  protection,
  targets,
}: {
  protection: BackupProtection;
  targets: readonly string[];
}): ProtectedPath | undefined {
  return protectionHitAny({ access: "read", entries: protection.entries, targets });
}

/**
 * The entry that refuses a place the run writes to: at or under any protected path, or holding a `no-access` one.
 * An ancestor of a `read-only` path is allowed — writing beside it writes nothing into it.
 *
 * @param protection the run's entries
 * @param targets every spelling of the place, as configured and as resolved
 * @returns the entry that refuses it, or `undefined`
 */
export function writeProtectionHit({
  protection,
  targets,
}: {
  protection: BackupProtection;
  targets: readonly string[];
}): ProtectedPath | undefined {
  const written = protectionHitAny({ access: "write", entries: protection.entries, targets });
  if (written !== undefined) {
    return written;
  }
  return protectionHitAny({ access: "search", entries: protection.entries, targets });
}

/** What a refusal calls the staging root, so a caller can tell a refusal that forbids writing `last.json` there. */
export const STAGING_ROOT_ROLE = "the backup staging root";

/**
 * One place under the home, under the home's given spelling and under where the home resolves: a `--home` reached
 * through a link puts every write and read at the resolved place, which a registry entry may name instead. Only the
 * HOME is resolved, never the place itself, so a protected place is never touched to be judged.
 *
 * @param home the Slopweaver home, as given
 * @param path a place under it, under the given spelling
 * @returns the place's spellings, the given one first
 */
export function spellingsUnderHome({ home, path }: { home: string; path: string }): readonly string[] {
  const physicalHome = resolvedFolder({ path: home });
  if (physicalHome === undefined || physicalHome === home) {
    return [path];
  }
  return [path, join(physicalHome, relative(home, path))];
}

/**
 * Refuse a new master password whose file the owner protects. `--create-master-password` is the one backup mode
 * that WRITES under `secrets/`; a night only reads that folder, so a `read-only` entry there holds this mode alone.
 *
 * @param path the master password's file, under the home's given spelling
 * @param home the Slopweaver home, as given, so a linked home is judged where it resolves too
 * @param protection the run's entries
 * @returns nothing, or the protected place that holds the write
 */
export function refuseProtectedPassphrase({
  path,
  home,
  protection,
}: {
  path: string;
  home: string;
  protection: BackupProtection;
}): Result<void, BackupProtectionError> {
  const entry = writeProtectionHit({ protection, targets: spellingsUnderHome({ home, path }) });
  if (entry === undefined) {
    return ok(undefined);
  }
  return err(BackupProtectionErrors.protectedPlace({ entry, role: "the master password's file", target: path }));
}

/**
 * The `HELD` line for every configured destination root the owner's paths protect, judged on its spelling and, when
 * it exists, where it resolves — what `--status` prints so a destination a night refuses never reads green there.
 *
 * @param roots every configured destination root
 * @param protection the run's entries
 * @returns one line per protected root, in the order given; empty when none is
 */
export function protectedDestinationLines({
  roots,
  protection,
}: {
  roots: readonly string[];
  protection: BackupProtection;
}): readonly string[] {
  return roots.flatMap((root) => {
    const physical = resolvedFolder({ path: root });
    const targets = physical === undefined ? [root] : [root, physical];
    const entry = writeProtectionHit({ protection, targets });
    if (entry === undefined) {
      return [];
    }
    return [BackupProtectionErrors.protectedPlace({ entry, role: "destination", target: root }).message];
  });
}

/**
 * Read a run's protection and refuse the run when its fixed home places are protected — the one admission every
 * backup mode passes before it reads a list, a pin, a key or a file.
 *
 * @param home the Slopweaver home
 * @param read how the protection is read; a test hands in its own
 * @returns the protection the rest of the run applies, or why the run is held
 */
export function admitBackupRun({
  home,
  read,
}: {
  home: string;
  read: ReadBackupProtection;
}): Result<BackupProtection, BackupProtectionError> {
  return read({ home }).andThen((protection) => refuseProtectedHomePlaces({ home, protection }).map(() => protection));
}

/**
 * Whether a held run may still record itself in `last.json`, which lives in the staging root: only when the refusal
 * was about another place. A staging root the owner protects is never written, and one whose protection is unknown
 * is not either — `--status` passes the same admission, so the hold still reads as held there.
 *
 * @param error why the run was held
 * @returns `true` when the staging root is known to be clear
 */
export function heldRunMayRecord({ error }: { error: BackupProtectionError }): boolean {
  return error.code === "BACKUP_PROTECTED_PLACE" && error.role !== STAGING_ROOT_ROLE;
}

/**
 * Refuse a run whose fixed home places are protected: the staging root it writes every night's copy into, and the
 * `secrets/` folder the credentials leg reads whole.
 *
 * @param home the Slopweaver home
 * @param protection the run's entries
 * @returns nothing when both are clear, else the refusal naming the place, the entry and the owner's reason
 */
function refuseProtectedHomePlaces({
  home,
  protection,
}: {
  home: string;
  protection: BackupProtection;
}): Result<void, BackupProtectionError> {
  const staging = stagingRoot({ home });
  const stagingHit = writeProtectionHit({ protection, targets: spellingsUnderHome({ home, path: staging }) });
  if (stagingHit !== undefined) {
    return err(BackupProtectionErrors.protectedPlace({ entry: stagingHit, role: STAGING_ROOT_ROLE, target: staging }));
  }
  const secrets = stateHomePaths({ home }).secrets;
  const secretsHit = protectionHitAny({
    access: "search",
    entries: protection.entries,
    targets: spellingsUnderHome({ home, path: secrets }),
  });
  if (secretsHit !== undefined) {
    return err(
      BackupProtectionErrors.protectedPlace({
        entry: secretsHit,
        role: "the credentials leg's source",
        target: secrets,
      }),
    );
  }
  return ok(undefined);
}
