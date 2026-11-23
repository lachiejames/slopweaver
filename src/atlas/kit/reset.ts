/**
 * Archive the whole current generation, then install a fresh, empty one in its place.
 *
 * No generation is ever deleted. The current directory is renamed whole into a dated folder under the
 * platform's own `_superseded` root, and only then is an empty generation published over it — so a reset
 * that fails halfway leaves the archive recoverable rather than leaving nothing current at all.
 *
 * The restore-on-failure path is the part worth keeping: if publishing the empty generation fails, the
 * archive is moved back. Without it, a full disk between the rename and the write would take the atlas from
 * "has data" to "has nothing, and the data is somewhere you have to know to look".
 *
 * The one thing that IS deleted is the stump a failed publish leaves behind — see {@link restoreArchive}.
 * That directory holds no data by construction, and removing it is what lets the archive go back where it
 * belongs instead of the restore being skipped and reported as though it had happened.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";

import { type AtlasGenerationError, AtlasGenerationErrors, atlasGenerationErrorLines } from "./generationErrors.js";
import { type AtlasMutationLease, withAtlasMutationLock } from "./mutationLock.js";
import { publishAtlas } from "./publish.js";
import { type AtlasKindFileLike, type AtlasManifestLike, type AtlasStorePaths, type AtlasStoreSpec } from "./store.js";

/** What a reset did. */
export interface AtlasResetOutcome {
  /** Where the archived generation now lives. */
  readonly archivedTo: string;
  /**
   * The archive's own id — the last path segment of {@link AtlasResetOutcome.archivedTo}.
   *
   * Carried rather than left for a caller to re-derive by splitting the path, because it is what
   * `atlas <platform> restore --archive` takes, and a reset whose output cannot name its own undo is the
   * shape that turned one confirmed wipe into an unrecoverable one. The kit does not know CLI syntax, so it
   * hands over the id and the CLI composes the command.
   */
  readonly archiveId: string;
}

/**
 * Put the archive back after a failed publish, so a reset never leaves nothing current.
 *
 * `publishAtlas` creates the generation directory BEFORE it writes a single kind file, so a publish that
 * fails leaves an empty directory sitting exactly where the archive has to go back — empty rather than
 * partial since `./generationSwap.ts` landed, and still in the way either way.
 * Treating that directory's existence as "something already restored this" is what made the failure
 * silent: the rename was skipped, `ok` was returned, and the caller then reported that the archive had
 * been restored while the archive was still in `_superseded` and the live path held a stump.
 *
 * Removing that directory is safe HERE and only here. The current generation was renamed to `archive`
 * before publishing, so nothing at `directory` is data — it is only whatever the failed publish managed
 * to write. Every other caller must keep treating an existing generation directory as untouchable.
 */
function restoreArchive({
  archive,
  directory,
}: {
  archive: string;
  directory: string;
}): Result<null, AtlasGenerationError> {
  if (existsSync(directory)) {
    try {
      rmSync(directory, { force: true, recursive: true });
    } catch (error: unknown) {
      return err(AtlasGenerationErrors.restoreStumpUnremovable({ archive, cause: error, directory }));
    }
  }
  try {
    renameSync(archive, directory);
    return ok(null);
  } catch (error: unknown) {
    return err(AtlasGenerationErrors.restoreRenameFailed({ archive, cause: error }));
  }
}

/**
 * Archive the current generation and install a fresh, empty one in its place.
 *
 * @param paths the resolved atlas paths
 * @param spec the platform's own document contract
 * @param emptyFiles an empty file for every kind, so the installed generation is complete rather than partial
 * @param emptyManifest the manifest to install — the platform's own initial shape
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed and the id that restores it, or every reason nothing was reset
 */
export function resetAtlas<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
  emptyFiles,
  emptyManifest,
  at,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
  emptyFiles: Readonly<Record<TKind, TFile>>;
  emptyManifest: TManifest;
  at: string;
}): Result<AtlasResetOutcome> {
  return withAtlasMutationLock({
    home: paths.home,
    mutate: ({ lease }) =>
      resetUnderLease({ at, emptyFiles, emptyManifest, lease, paths, spec }).mapErr((error) =>
        atlasGenerationErrorLines({ error }),
      ),
    nowIso: at,
    platform: spec.platform,
  });
}

/**
 * The reset itself, with this atlas's mutation lock already held.
 *
 * Holding it across BOTH renames and the publish is the point, not a tidiness: between the archive rename
 * and the empty generation being installed there is an instant where the live path holds nothing, and a
 * concurrent publish landing in it would be archived by nobody and overwritten by the empty generation a
 * moment later. The lease is what lets {@link publishAtlas} run inside that hold — `./mutationLock.ts`
 * carries why the lock is not reentrant and why the lease cannot be forged.
 *
 * `derivedFrom: null` is TRUE here rather than excused: the generation this replaces has been renamed away
 * before the publish, so the compare-and-swap reads an empty live path and the platform's own publish guard
 * has nothing to compare against — which is exactly right for the one operation whose job is to replace
 * whatever a guard would otherwise protect.
 */
function resetUnderLease<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
  emptyFiles,
  emptyManifest,
  at,
  lease,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
  emptyFiles: Readonly<Record<TKind, TFile>>;
  emptyManifest: TManifest;
  at: string;
  lease: AtlasMutationLease;
}): Result<AtlasResetOutcome, AtlasGenerationError> {
  if (!existsSync(paths.directory)) {
    return err(AtlasGenerationErrors.noCurrentGeneration({ directory: paths.directory, platform: spec.platform }));
  }

  const archiveId = at.replaceAll(":", "-");
  const archive = join(paths.superseded, archiveId);
  if (existsSync(archive)) {
    return err(AtlasGenerationErrors.resetArchiveExists({ archive }));
  }

  try {
    mkdirSync(paths.superseded, { recursive: true });
    renameSync(paths.directory, archive);
  } catch (error: unknown) {
    return err(AtlasGenerationErrors.resetCurrentNotArchived({ cause: error }));
  }

  const published = publishAtlas({
    derivedFrom: null,
    files: emptyFiles,
    lease,
    manifest: emptyManifest,
    paths,
    spec,
  });
  if (published.isErr()) {
    const restored = restoreArchive({ archive, directory: paths.directory });
    const restoreFailure = restored.isOk() ? null : restored.error;
    return err(AtlasGenerationErrors.resetPublishFailed({ published: published.error, restoreFailure }));
  }
  return ok({ archiveId, archivedTo: archive });
}

/**
 * One platform's reset, with every generic already resolved.
 *
 * It takes the home and the run's instant rather than resolved paths: the instant both names the archive and
 * stamps the empty generation, and a platform resolves its own paths from the home because the layout is the
 * platform's own to know. Returns what was archived, so the CLI can print the command that restores it.
 */
export type AtlasPlatformReset = (args: { home: string; at: string }) => Result<AtlasResetOutcome>;

/**
 * Bind one platform's four declarations into the reset its registration answers with.
 *
 * This exists because 33 platforms each carried an `atlas/<p>/reset.ts` whose whole body was this call with
 * four names swapped, and a `cli/commands/<p>Atlas/resetRun.ts` whose whole body was the CLI wiring with
 * three. Neither file held a decision. What a platform genuinely owns is the four arguments below, each of
 * which its own `model.ts` and `store.ts` already exported, so the registration now names those four and
 * nothing else.
 *
 * It returns an already-BOUND closure rather than letting a registration hold the four pieces, and that is
 * the reason it is a function at all: `AtlasStoreSpec` and `AtlasStorePaths` are generic in three
 * parameters, so a registration holding them would need existential erasure. Resolving every generic here,
 * inside the platform's own thunk, costs nothing and keeps the type checker's answer exact.
 *
 * @param emptyFiles an empty file for every kind, stamped with the run's instant
 * @param emptyManifest the platform's own initial manifest shape
 * @param paths where this platform's generation resolves under a given home
 * @param spec the platform's own document contract
 * @returns the reset a registration's `readReset` hands back
 */
export function atlasResetFor<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  emptyFiles,
  emptyManifest,
  paths,
  spec,
}: {
  emptyFiles: (args: { at: string }) => Readonly<Record<TKind, TFile>>;
  emptyManifest: (args: { updatedAt: string }) => TManifest;
  paths: (args: { home: string }) => AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): AtlasPlatformReset {
  return ({ home, at }) =>
    resetAtlas({
      at,
      emptyFiles: emptyFiles({ at }),
      emptyManifest: emptyManifest({ updatedAt: at }),
      paths: paths({ home }),
      spec,
    });
}
