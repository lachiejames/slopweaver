/**
 * The files leg's effectful edge — walking the backed-up roots under one home and digesting each file.
 *
 * Every file is digested every night rather than trusted on size and mtime: a bronze window is written
 * atomically and then never touched, so the honest question is "are these the bytes", and SHA-256 over
 * 8.4 GB is under a minute (measured on this machine).
 *
 * **The roots come from `stateHome.ts` and the paths inside them are RELATIVE to the home.** That is the
 * single-contract rule (`src/__tests__/unit/stateHome.guard.test.ts`) rather than a style choice: nothing
 * outside that file derives a home sub-path, so a layout change lands in one place. A manifest entry's
 * `relativePath` is what makes a backup restorable into a DIFFERENT home, which is the whole point of a
 * disaster copy.
 *
 * **A `no-access` path is pruned before it is opened** (`./protectedPaths.ts`). The walk lists one directory at a
 * time and asks the owner's registry about every entry before descending into it or digesting it, so a protected
 * folder under `corpus/bronze` is never listed, let alone read: a recursive listing of the root would already have
 * read it. Its parent's listing still names it, which is the one thing a walk cannot avoid. A link below a root is
 * neither followed nor carried, exactly as the recursive listing this replaced treated one; a ROOT that is a link is
 * followed, and is judged by both its spelling and where it resolves.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { appendAll } from "#lib/arrays.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";

import type { BackupError } from "./errors.js";
import { fileVanished } from "./fileRace.js";
import { BACKED_UP_FILE_ROOTS, type BackedUpFile, isBackedUpFileEligible } from "./plan.js";
import { type BackupProtection, type SkippedProtectedPath, sourceProtectionHit } from "./protectedPaths.js";
import { digestFile } from "./stack.js";

/**
 * The absolute directory each backed-up root resolves to under one home.
 *
 * Keyed by the root's own name so the manifest and the walk cannot disagree about which is which, and
 * derived from `stateHomePaths` so this module never builds a home sub-path itself.
 *
 * The typed record catches a root the list gained and this map did not — that one will not compile. It
 * cannot catch a key pointed at the WRONG sibling's path, which type-checks perfectly while backing one
 * root up twice and losing the other, so `backupFileRoots.test.ts` asserts each resolved path is its own
 * root's name relative to the home — read off the constant, so a future widening does not redden it.
 * Exported for exactly that test.
 *
 * @param home the Slopweaver home
 * @returns one absolute directory per entry of {@link BACKED_UP_FILE_ROOTS}, in that order
 */
export function backedUpRootPaths({ home }: { home: string }): readonly string[] {
  const paths = stateHomePaths({ home });
  const byName: Record<(typeof BACKED_UP_FILE_ROOTS)[number], string> = {
    atlas: paths.atlas.root,
    "corpus/attachments": paths.corpus.attachments,
    "corpus/bodies": paths.corpus.bodies,
    "corpus/bronze": paths.corpus.bronze,
    "corpus/history": paths.corpus.history,
    "corpus/members": paths.corpus.members,
    knowledge: paths.knowledge,
    pages: paths.pages,
    "published-pages": paths.publishedPages,
  };
  return BACKED_UP_FILE_ROOTS.map((root) => byName[root]);
}

/**
 * Where one manifest entry's bytes live under a home — the only place a relative path is re-joined.
 *
 * @param home the Slopweaver home, which need NOT be the one the backup was taken from
 * @param relativePath the entry's path, as the manifest recorded it
 * @returns the absolute path
 */
export function backedUpFilePath({ home, relativePath }: { home: string; relativePath: string }): string {
  return join(stateHomePaths({ home }).root, relativePath);
}

/** What the walk measured: the files it digested, how many vanished, and what the owner's registry withheld. */
export interface WalkedBackedUpFiles {
  readonly files: readonly BackedUpFile[];
  /** Files removed between the listing and the digest — omitted, never failed (`./fileRace.ts`). */
  readonly vanished: number;
  /** Every protected entry the walk pruned, with the owner's reason, path-sorted — never listed, never read. */
  readonly skippedProtectedPaths: readonly SkippedProtectedPath[];
}

/** One path the walk reached: its spelling under the home, and where it really is. */
interface SpelledPath {
  readonly lexical: string;
  readonly physical: string;
}

/** What the walk prunes into: keyed by the entry's folded path, so a protected folder reached twice is named once. */
type SkippedByPath = Map<string, SkippedProtectedPath>;

/**
 * Whether one spelling pair is protected, recording the entry that withholds it when it is.
 *
 * @param protection the run's entries
 * @param targets every spelling of the path
 * @param skipped where a pruned entry is recorded
 * @returns `true` when the walk must leave it alone
 */
function pruned({
  protection,
  targets,
  skipped,
}: {
  protection: BackupProtection;
  targets: readonly string[];
  skipped: SkippedByPath;
}): boolean {
  const hit = sourceProtectionHit({ protection, targets });
  if (hit === undefined) {
    return false;
  }
  skipped.set(hit.path.toLowerCase(), { path: hit.path, why: hit.why });
  return true;
}

/**
 * Every eligible file under ONE root, digested, in whatever order the walk found them.
 *
 * Its own function rather than an inner loop because the two halves branch for different reasons — which
 * ROOTS exist is one question and which FILES under a root are carried is another.
 *
 * Each directory is listed on its own, and every entry is asked of the registry BEFORE it is descended into or
 * digested, under both its spelling below the home and its physical path below a root that is a link. Then
 * {@link isBackedUpFileEligible} is asked before the digest, so a withheld atlas companion is never read and never
 * appears in the manifest. It is asked on the slash-separated form while the entry keeps `relative`'s own, because
 * the policy reasons about path components and the manifest is a wire format.
 *
 * A file the listing named and the digest found gone (`ARTEFACT_VANISHED`) is counted and left out: a
 * walk's scratch screenshot under `atlas` failed a nightly run that way (`./fileRace.ts`).
 *
 * @param root the directory to walk, as spelled under the home and as resolved
 * @param home the home every entry's path is recorded relative to
 * @param digest the digest effect
 * @param protection the run's entries
 * @param skipped where a pruned entry is recorded
 * @returns the entries and the vanished count, or the first file that could not be read
 */
function digestedFilesUnder({
  root,
  home,
  digest,
  protection,
  skipped,
}: {
  root: SpelledPath;
  home: string;
  digest: typeof digestFile;
  protection: BackupProtection;
  skipped: SkippedByPath;
}): Result<{ files: readonly BackedUpFile[]; vanished: number }, BackupError> {
  const walk: WalkTally = { files: [], vanished: 0 };
  const pending: SpelledPath[] = [root];
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    const listed = visitDirectory({ digest, directory, home, pending, protection, skipped, walk });
    if (listed.isErr()) {
      return err(listed.error);
    }
  }
  return ok({ files: walk.files, vanished: walk.vanished });
}

/** What one root's walk has gathered so far, appended to as each directory is listed. */
interface WalkTally {
  readonly files: BackedUpFile[];
  vanished: number;
}

/**
 * List ONE directory: prune what the registry protects, queue each subdirectory, and digest each eligible file.
 *
 * @param directory the directory, as spelled under the home and as resolved
 * @param home the home every entry's path is recorded relative to
 * @param digest the digest effect
 * @param protection the run's entries
 * @param skipped where a pruned entry is recorded
 * @param pending the directories still to list, which this one's subdirectories join
 * @param walk the root's tally, which this directory's files and vanished count join
 * @returns nothing, or the first file that could not be read
 */
function visitDirectory({
  directory,
  home,
  digest,
  protection,
  skipped,
  pending,
  walk,
}: {
  directory: SpelledPath;
  home: string;
  digest: typeof digestFile;
  protection: BackupProtection;
  skipped: SkippedByPath;
  pending: SpelledPath[];
  walk: WalkTally;
}): Result<void, BackupError> {
  for (const entry of readdirSync(directory.physical, { withFileTypes: true })) {
    const child = { lexical: join(directory.lexical, entry.name), physical: join(directory.physical, entry.name) };
    if (pruned({ protection, skipped, targets: [child.lexical, child.physical] })) {
      continue;
    }
    if (entry.isDirectory()) {
      pending.push(child);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const carried = carryFile({ digest, home, path: child, walk });
    if (carried.isErr()) {
      return err(carried.error);
    }
  }
  return ok(undefined);
}

/**
 * Digest ONE listed file into the tally, when it is eligible: counted when it vanished first, failed otherwise.
 *
 * The bytes are read at the PHYSICAL path the registry just judged, never back through the spelling: a root link
 * re-pointed mid-walk would otherwise carry the digest somewhere no check looked. The manifest keeps the spelling.
 *
 * @param path the file, as spelled under the home and where the walk found it
 * @param home the home its path is recorded relative to
 * @param digest the digest effect
 * @param walk the root's tally, which the file or its vanishing joins
 * @returns nothing, or why the file could not be read
 */
function carryFile({
  path: { lexical, physical },
  home,
  digest,
  walk,
}: {
  path: SpelledPath;
  home: string;
  digest: typeof digestFile;
  walk: WalkTally;
}): Result<void, BackupError> {
  const relativePath = relative(home, lexical);
  if (!isBackedUpFileEligible({ relativePath: relativePath.split(sep).join("/") })) {
    return ok(undefined);
  }
  const path = physical;
  const digested = digest({ path });
  if (digested.isOk()) {
    walk.files.push({ bytes: digested.value.bytes, relativePath, sha256: digested.value.sha256 });
    return ok(undefined);
  }
  // Re-confirmed here rather than trusted off the code, because `digest` is injectable.
  const vanished = digested.error.code === "ARTEFACT_VANISHED" && fileVanished({ cause: digested.error.cause, path });
  if (!vanished) {
    return err(digested.error);
  }
  walk.vanished += 1;
  return ok(undefined);
}

/**
 * Every file under the backed-up roots of one home, digested, sorted by path, with every `no-access` path pruned.
 *
 * A root that does not exist is skipped rather than refused — a fresh install has no `corpus/history`
 * yet — and the manifest's `roots` field records which were asked for. That check stays before the
 * listing: only a FILE the listing named may vanish, never a whole root. A root is asked of the registry under its
 * spelling BEFORE it is even looked for, and again where it resolves before it is listed.
 *
 * @param home the Slopweaver home
 * @param protection the run's protected entries — required, so no caller can walk without having asked
 * @param digest the digest effect, replaceable by a test
 * @returns the entries, how many listed files were gone before their digest and what the registry withheld, or
 *   the first file that could not be read
 */
export function walkBackedUpFiles({
  home,
  protection,
  digest = digestFile,
}: {
  home: string;
  protection: BackupProtection;
  digest?: typeof digestFile;
}): Result<WalkedBackedUpFiles, BackupError> {
  const entries: BackedUpFile[] = [];
  const skipped: SkippedByPath = new Map();
  let vanished = 0;
  for (const absolute of backedUpRootPaths({ home })) {
    if (pruned({ protection, skipped, targets: [absolute] }) || !existsSync(absolute)) {
      continue;
    }
    const physical = realpathSync(absolute);
    if (pruned({ protection, skipped, targets: [physical] })) {
      continue;
    }
    const walked = digestedFilesUnder({ digest, home, protection, root: { lexical: absolute, physical }, skipped });
    if (walked.isErr()) {
      return err(walked.error);
    }
    // `appendAll`, never a spread: one root's walk is sized by the tree, and `corpus/bronze` alone is
    // past six figures of files on this install.
    appendAll({ from: walked.value.files, into: entries });
    vanished += walked.value.vanished;
  }
  return ok({
    files: entries.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath)),
    skippedProtectedPaths: [...skipped.values()].toSorted((left, right) => left.path.localeCompare(right.path)),
    vanished,
  });
}
