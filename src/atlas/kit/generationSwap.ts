/**
 * The two-phase swap every generation is published through: stage every file beside its own destination,
 * then install the whole set by rename, restoring the previous generation if any of those renames fails.
 *
 * ## What this closes
 *
 * `store.ts`'s publish used to write each kind file straight over its destination and the manifest last.
 * That ordering makes an interrupted publication DETECTABLE — the manifest's digests stop matching the
 * bytes on disk — and it does not make it RECOVERABLE. A failure on the second of two kinds left the first
 * one holding the NEW generation under the OLD manifest, so `readAtlas` graded it `mismatched` and the
 * last-known-good generation was not merely stale, it was unreadable. Nothing rolled back. The falsifier is
 * `src/__tests__/unit/atlas/kit/publishAtomicity.test.ts`, which fails on that shape and passes on this one:
 * make the second kind's destination directory unwritable, attempt the next generation, then require every
 * prior byte — kind files and manifest alike — to still be there.
 *
 * ## Why a sibling and not a staging directory
 *
 * A rename is atomic only within one filesystem, and the only path guaranteed to share a filesystem with a
 * destination is a path in the destination's own directory. A platform is free to nest a kind file
 * (`atlasHomeShared.ts` builds the common layout, but the paths are the platform's), so a single staging
 * root under the atlas directory would be an assumption this module cannot make. `<destination>.publishing`
 * always holds.
 *
 * ## The residue, stated rather than discovered
 *
 * The write phase is where a publish actually fails — a kind file whose size is the tenant's (`atlas/atlasFile.ts`'s
 * header carries that measurement) takes seconds and can exhaust a disk; the commit phase is a handful of
 * directory-entry swaps over bytes that are already fsynced. This makes the write phase leave the published
 * generation byte-identical, and it makes a FAILED commit roll back. What it cannot do is survive a process
 * KILL mid-commit, because no rollback code runs then — closing that needs the whole generation to hang off
 * one renameable pointer, which is a layout change across every atlas rather than a change to this seam.
 * A kill leaves the rollback set on disk under `<destination>.superseding`, so the prior generation is
 * recoverable by hand rather than gone. The next successful publish OF THAT KIND overwrites both suffixes,
 * so stale residue heals rather than accumulating — but only for a kind the next publish includes, since
 * every path here is derived from the set it was passed and a partial publish reaches nothing else. A kind
 * that is killed mid-install and then omitted from every later publish keeps its `.superseding` copy until
 * one includes it again. That is inert rather than dangerous: nothing reads either suffix, because both
 * reads iterate the platform's own kind list rather than the directory.
 */
import { existsSync, unlinkSync } from "node:fs";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { fsyncDirectories, renameStagedFile } from "../../lib/writeAtomic.js";

import { type AtlasPublishError, AtlasPublishErrors } from "./publishErrors.js";

/** Where a file's new bytes wait while the rest of the generation is still being written. */
const STAGED_SUFFIX = ".publishing";

/** What installing a generation answers: the destinations installed, in order, or why none were. */
type SwapResult = Result<readonly string[], AtlasPublishError>;

/** Where a file's PREVIOUS bytes wait while the swap runs, and what a rollback reads them back from. */
const SUPERSEDING_SUFFIX = ".superseding";

/**
 * One file a generation installs: where it belongs, and how to produce its bytes at a path of our choosing.
 *
 * @internal — {@link swapGeneration}'s own input shape.
 */
export interface GenerationFile {
  /** The destination this file is published to. */
  readonly path: string;
  /** Write the file's bytes to `path`, atomically and durably. Called once, against the staged sibling. */
  readonly write: (input: { path: string }) => Result<null>;
}

/** One destination whose previous bytes are parked, so a failed commit can put them back. */
interface Parked {
  readonly path: string;
  /** Where the previous bytes are, or `null` when the destination held nothing to preserve. */
  readonly superseding: string | null;
}

/** Remove a path, reporting nothing when it was never there — a discarded stage is not a second failure. */
function discard({ path }: { path: string }): void {
  try {
    unlinkSync(path);
  } catch {
    // The file may never have been staged, or a rename may already have consumed it. Either way its
    // absence is exactly the state this is trying to reach.
  }
}

/**
 * Put every parked file back, newest first, so a failed commit leaves the previous generation where it was.
 *
 * @param parked what the commit had already moved, in the order it moved it
 * @returns every reason a file could NOT be put back — empty when the previous generation is whole again
 */
function rollback({ parked }: { parked: readonly Parked[] }): readonly string[] {
  const problems: string[] = [];
  const restored: string[] = [];
  for (const entry of parked.toReversed()) {
    if (entry.superseding === null) {
      discard({ path: entry.path });
      continue;
    }
    try {
      renameStagedFile({ flushDirectory: false, from: entry.superseding, to: entry.path });
      restored.push(entry.path);
    } catch (error: unknown) {
      problems.push(
        `the previous ${entry.path} is at ${entry.superseding} and could not be restored: ${errorMessage({ error })}`,
      );
    }
  }
  fsyncDirectories({ paths: restored });
  return problems;
}

/**
 * Stage every file beside its destination. Nothing is installed here, so any failure is total and silent
 * from a reader's point of view.
 *
 * Exported beside {@link commitGeneration} rather than hidden inside {@link swapGeneration} because the two
 * phases are what a test has to be able to separate: the failure the commit phase exists for is a
 * filesystem that changed BETWEEN them, and there is no portable way to make a rename fail while the write
 * that preceded it into the same directory succeeded.
 *
 * @param files the generation's files, in the order they will be installed
 * @returns nothing when every file is staged, or why the generation was not written at all
 */
export function stageGeneration({ files }: { files: readonly GenerationFile[] }): Result<null, AtlasPublishError> {
  const staged: string[] = [];
  for (const entry of files) {
    const path = `${entry.path}${STAGED_SUFFIX}`;
    const written = entry.write({ path });
    if (written.isErr()) {
      for (const done of [...staged, path]) {
        discard({ path: done });
      }
      return err(AtlasPublishErrors.stageFailed({ reasons: written.error }));
    }
    staged.push(path);
  }
  return ok(null);
}

/**
 * Move a destination's current bytes aside, so a failed install can put them back.
 *
 * @param path the destination about to be replaced
 * @returns where the previous bytes were parked (`null` when there were none), or why they could not be
 */
function park({ path }: { path: string }): Result<Parked, AtlasPublishError> {
  if (!existsSync(path)) {
    return ok({ path, superseding: null });
  }
  const superseding = `${path}${SUPERSEDING_SUFFIX}`;
  try {
    renameStagedFile({ flushDirectory: false, from: path, to: superseding });
    return ok({ path, superseding });
  } catch (error: unknown) {
    return err(AtlasPublishErrors.previousNotParked({ cause: error, path }));
  }
}

/**
 * Move one staged file onto its destination, durably.
 *
 * @param path the destination it takes over
 * @returns nothing on success, or why the install failed
 */
function install({ path }: { path: string }): Result<null, AtlasPublishError> {
  try {
    renameStagedFile({ flushDirectory: false, from: `${path}${STAGED_SUFFIX}`, to: path });
    return ok(null);
  } catch (error: unknown) {
    return err(AtlasPublishErrors.installFailed({ cause: error, path }));
  }
}

/**
 * Give up on a half-installed generation: put the previous one back and drop every staged file left over.
 *
 * @param files the whole generation, so no staged sibling survives the abort
 * @param parked what the commit had already moved, in the order it moved it
 * @param reason why the install stopped
 * @returns the refusal, saying whether the previous generation is whole again
 */
function abort({
  files,
  parked,
  reason,
}: {
  files: readonly GenerationFile[];
  parked: readonly Parked[];
  reason: AtlasPublishError;
}): SwapResult {
  const failed = rollback({ parked });
  for (const entry of files) {
    discard({ path: `${entry.path}${STAGED_SUFFIX}` });
  }
  return err(AtlasPublishErrors.installAborted({ cause: reason, rollbackFailures: failed }));
}

/**
 * Install every staged file over its destination, in order, rolling the previous generation back if any
 * one of those renames fails. The second half of {@link stageGeneration}'s protocol.
 *
 * @param files the generation's files, already staged, in the order they are installed
 * @returns the destinations installed, in order, or why the generation was not installed
 */
export function commitGeneration({ files }: { files: readonly GenerationFile[] }): SwapResult {
  const parked: Parked[] = [];
  for (const entry of files) {
    const moved = park({ path: entry.path });
    if (moved.isErr()) {
      return abort({ files, parked, reason: moved.error });
    }
    parked.push(moved.value);
    const installed = install({ path: entry.path });
    if (installed.isErr()) {
      return abort({ files, parked, reason: installed.error });
    }
  }
  const destinations = files.map((entry) => entry.path);
  fsyncDirectories({ paths: destinations });
  for (const entry of parked) {
    discard({ path: `${entry.path}${SUPERSEDING_SUFFIX}` });
  }
  return ok(destinations);
}

/**
 * Publish a whole generation or none of it: stage every file beside its destination, then install the set
 * by rename, restoring the previous generation if an install fails.
 *
 * @param files every file this generation writes, in the order a reader's authority depends on them — the
 *   manifest names the kind files, so it is installed LAST and a half-installed generation still has the
 *   previous manifest vouching for the previous bytes
 * @returns the destinations installed, in order, or every reason the generation was not published
 */
export function swapGeneration({ files }: { files: readonly GenerationFile[] }): SwapResult {
  const staged = stageGeneration({ files });
  if (staged.isErr()) {
    return err(staged.error);
  }
  return commitGeneration({ files });
}
