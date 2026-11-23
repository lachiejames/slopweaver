/**
 * Listing what `reset` archived, and putting one back — the half of the hard/soft split that was missing.
 *
 * ## Why this exists
 *
 * Owner ruling: a sync is a SOFT RECONCILE and is never capable of wiping a platform's local atlas, while
 * erasing everything locally and pulling everything from scratch is a HARD sync. `./reset.ts` is the hard verb and it
 * has always been careful — it renames the live generation whole into `atlas/_superseded/<platform>/<iso>/`
 * and deletes nothing. What it never had was a way BACK, and that is what turned one confirmed reset into an
 * empty atlas with no supported recovery.
 *
 * MEASURED on one install: `atlas vanta reset --confirm archive` archived a
 * good generation, every sync after it failed on a 401 or a held token-mint lock, and the
 * store's own guards correctly refused all of them — so the archive was intact and unreachable at the same
 * time. Across the whole home there were **archived generations across platforms and no verb that could
 * read one**. Reproduce the count: `find ~/.slopweaver/atlas/_superseded -maxdepth 2 -mindepth 2 -type d | wc -l`.
 *
 * ## Generic over every atlas, with no platform contract at all
 *
 * A restore is a DIRECTORY transaction, so it needs paths and nothing else — it never parses an entity. That
 * is deliberate rather than lazy: binding this to `AtlasStoreSpec` would have meant 36 registry rows each
 * loading its platform's whole Zod model to move a folder, and `../registry.ts`'s header says why that cost
 * is refused for the cheapest verbs.
 *
 * What replaces the spec is {@link AtlasArchiveSummary}: the manifest is read as a bounded record and
 * judged on the two fields `AtlasManifestLike` guarantees every atlas carries — `schemaVersion` and
 * `updatedAt` — plus the per-kind `digest`, which is verified against the archived bytes before anything
 * moves. So the integrity check is the store's own digest rather than a second opinion about it.
 *
 * ## The version refusal, and the half of it that is NOT here
 *
 * A build that writes schema version 5 cannot read a generation written at 6, and half-reading one is worse
 * than refusing. This module compares the archive against the version the LIVE manifest carries, and refuses
 * when there is no live manifest rather than guessing.
 *
 * That comparison is necessary and NOT sufficient. The live manifest is written by whichever build ran
 * LAST, which is not necessarily the build running now, so it does not say what the running build writes.
 *
 * Example: a home written by a branch that bumps `VANTA_ATLAS_SCHEMA_VERSION` from 5 to 6 carries a
 * schema-6 Vanta manifest while a build from before the bump declares 5. An archive at 6 against a live
 * manifest at 6 passes the comparison and would install a generation the running build cannot parse. A
 * reader who greps a settled install for a live mismatch finds none and might conclude this guard solves
 * nothing; the mismatch only exists while builds disagree.
 *
 * So the other half lives with the caller, which has the platform: `cli/commands/atlas/restoreRun.ts` asks
 * the registry's own `readSnapshot` whether this build can read the INSTALLED generation before it restores
 * anything, and refuses when it cannot. A generic verb has no business holding a second table of per-platform
 * schema versions, and the platform's own reader is the only authority that cannot drift from the schema.
 *
 * ## What it will not do
 *
 * It never deletes either generation. The live one is archived under its own fresh timestamp first, and a
 * failure after that point renames it straight back. The one instant it cannot remove is the gap between the
 * two renames, where neither directory occupies the live name — closing that needs a generation-pointer
 * layout rather than a rename, and both generations remain recoverable by hand throughout.
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";

import { digestDisagreements, type ManifestHeader, readManifestHeader } from "./archiveManifest.js";
import { type AtlasGenerationError, AtlasGenerationErrors } from "./generationErrors.js";

/** The paths a generic archive operation needs — the subset of `AtlasStorePaths` that carries no kind type. */
export interface AtlasArchivePaths {
  readonly directory: string;
  readonly kinds: Readonly<Record<string, string>>;
  readonly manifest: string;
  readonly superseded: string;
}

/** What one archived generation says about itself, without any platform's schema being loaded. */
export interface AtlasArchiveSummary {
  /** The directory name under `_superseded/<platform>/`, which is also what `--archive` names. */
  readonly archiveId: string;
  readonly path: string;
  /** The archive's own schema version, or `null` when its manifest could not be read. */
  readonly schemaVersion: number | null;
  /** The clock the archived manifest carried, or `null` when its manifest could not be read. */
  readonly updatedAt: string | null;
  /** Total entities across every kind the archived manifest vouches for, or `null` when unreadable. */
  readonly entityCount: number | null;
}

/** What a restore did, in the two paths a caller has to be able to name afterwards. */
export interface AtlasRestoreOutcome {
  /** The archive that is now the live generation. */
  readonly restoredFrom: string;
  /** Where the generation this replaced was archived, or `null` when there was no live generation. */
  readonly archivedCurrentTo: string | null;
  /** The archive id that undoes this restore, or `null` when nothing was displaced. */
  readonly undoArchiveId: string | null;
}

/**
 * An archive id is one path segment this module itself listed — never a caller's string joined onto a path.
 *
 * Checked as a WHOLE-STRING pattern rather than by stripping separators, because a rejected traversal is
 * clearer than a silently rewritten one, and the id is also re-confirmed against the directory listing
 * before it is used.
 */
const ARCHIVE_ID = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

/**
 * Every archived generation this platform holds, newest first.
 *
 * Newest first by archive id, which is the reset instant with `:` replaced — an ISO instant in that shape
 * sorts lexicographically in time order, so no date is parsed to rank them.
 *
 * @param paths the platform's resolved atlas paths
 * @returns one summary per archive, or the reason the archive root could not be listed
 */
export function listAtlasArchives({
  paths,
}: {
  paths: AtlasArchivePaths;
}): Result<readonly AtlasArchiveSummary[], AtlasGenerationError> {
  if (!existsSync(paths.superseded)) {
    return ok([]);
  }
  let entries: readonly string[];
  try {
    entries = readdirSync(paths.superseded, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error: unknown) {
    return err(AtlasGenerationErrors.archiveRootUnlistable({ cause: error, path: paths.superseded }));
  }
  return ok(
    entries
      .filter((name) => ARCHIVE_ID.test(name))
      .toSorted()
      .toReversed()
      .map((archiveId): AtlasArchiveSummary => {
        const path = join(paths.superseded, archiveId);
        const header = readManifestHeader({ path: join(path, "manifest.json") });
        // An unreadable header is reported as unknown fields; a readable one carries all three, required.
        if (header === null) {
          return { archiveId, entityCount: null, path, schemaVersion: null, updatedAt: null };
        }
        const { entityCount, schemaVersion, updatedAt } = header;
        return { archiveId, entityCount, path, schemaVersion, updatedAt };
      }),
  );
}

/** The refusal for an archive this build must not install, or `null` when it may be restored. */
function refuseIncompatible({
  archive,
  live,
  header,
}: {
  archive: AtlasArchiveSummary;
  live: ManifestHeader | null;
  header: ManifestHeader | null;
}): AtlasGenerationError | null {
  const { archiveId } = archive;
  if (header === null) {
    return AtlasGenerationErrors.archiveManifestUnreadable({ archiveId });
  }
  const archiveVersion = header.schemaVersion;
  if (live?.schemaVersion == null) {
    return AtlasGenerationErrors.liveVersionUnknown({ archiveId, archiveVersion });
  }
  if (archiveVersion !== live.schemaVersion) {
    return AtlasGenerationErrors.schemaVersionMismatch({ archiveId, archiveVersion, liveVersion: live.schemaVersion });
  }
  return null;
}

/** Where the generation being displaced goes, and whether there is one at all. */
interface DisplacePlan {
  readonly hasLive: boolean;
  readonly displacedId: string;
  readonly displaced: string;
}

/**
 * Every refusal that must fire BEFORE a single directory moves, in the order they are cheapest to check.
 *
 * Split from {@link restoreAtlasArchive} so the mutation reads as a sequence of renames rather than as a
 * wall of guards — and because a guard that is easy to read is one a reviewer can check is complete.
 *
 * @param paths the platform's resolved atlas paths
 * @param archive the archive being installed
 * @param plan where the displaced generation would go
 * @returns the refusal, or `null` when the move may proceed
 */
function refuseBeforeMoving({
  paths,
  archive,
  plan,
}: {
  paths: AtlasArchivePaths;
  archive: AtlasArchiveSummary;
  plan: DisplacePlan;
}): AtlasGenerationError | null {
  const header = readManifestHeader({ path: join(archive.path, "manifest.json") });
  const incompatible = refuseIncompatible({ archive, header, live: readManifestHeader({ path: paths.manifest }) });
  if (incompatible !== null) {
    return incompatible;
  }
  // `header` is non-null here: `refuseIncompatible` refuses a null one, and we returned above.
  const corrupt =
    header === null
      ? []
      : digestDisagreements({ directory: paths.directory, header, kinds: paths.kinds, root: archive.path });
  if (corrupt.length > 0) {
    return AtlasGenerationErrors.archiveSelfDisagrees({ archiveId: archive.archiveId, disagreements: corrupt });
  }
  if (plan.hasLive && existsSync(plan.displaced)) {
    return AtlasGenerationErrors.displacedArchiveExists({ displaced: plan.displaced });
  }
  return null;
}

/**
 * Put the displaced generation back after the install failed, so a restore never leaves nothing live.
 *
 * @param plan where the displaced generation was parked
 * @param paths the platform's resolved atlas paths
 * @param archive the archive whose install failed, named so a reader knows both halves survived
 * @returns the lines describing what was and was not put back, which follow the install failure itself
 */
function rollBack({
  plan,
  paths,
  archive,
}: {
  plan: DisplacePlan;
  paths: AtlasArchivePaths;
  archive: AtlasArchiveSummary;
}): readonly string[] {
  if (!plan.hasLive) {
    return ["nothing was moved"];
  }
  try {
    renameSync(plan.displaced, paths.directory);
    return ["the generation that was live has been put back; nothing was restored"];
  } catch (error: unknown) {
    return [
      `and the generation that was live could not be put back: ${errorMessage({ error })}`,
      `it is at ${plan.displaced} and ${archive.path} still holds the archive — neither was deleted`,
    ];
  }
}

/**
 * Install an archived generation as the live one, archiving whatever it replaces.
 *
 * Nothing is deleted in any outcome: the live generation is archived under its own fresh timestamp before
 * the archive is installed, and a failed install renames it straight back.
 *
 * @param paths the platform's resolved atlas paths
 * @param archiveId which archive to install, as {@link listAtlasArchives} named it
 * @param at this run's ISO instant, which names the archive the displaced generation goes to
 * @returns what was restored and how to undo it, or every reason nothing was moved
 */
export function restoreAtlasArchive({
  paths,
  archiveId,
  at,
}: {
  paths: AtlasArchivePaths;
  archiveId: string;
  at: string;
}): Result<AtlasRestoreOutcome, AtlasGenerationError> {
  const listed = listAtlasArchives({ paths });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const archive = listed.value.find((candidate) => candidate.archiveId === archiveId);
  if (archive === undefined) {
    const known = listed.value.map((candidate) => candidate.archiveId);
    return err(AtlasGenerationErrors.archiveUnknown({ archiveId, known, superseded: paths.superseded }));
  }

  const displacedId = at.replaceAll(":", "-");
  const plan: DisplacePlan = {
    displaced: join(paths.superseded, displacedId),
    displacedId,
    hasLive: existsSync(paths.directory),
  };
  const refused = refuseBeforeMoving({ archive, paths, plan });
  if (refused !== null) {
    return err(refused);
  }

  if (plan.hasLive) {
    try {
      mkdirSync(paths.superseded, { recursive: true });
      renameSync(paths.directory, plan.displaced);
    } catch (error: unknown) {
      return err(AtlasGenerationErrors.restoreCurrentNotArchived({ cause: error }));
    }
  }

  try {
    renameSync(archive.path, paths.directory);
  } catch (error: unknown) {
    const rollback = rollBack({ archive, paths, plan });
    return err(AtlasGenerationErrors.archiveInstallFailed({ archiveId, cause: error, rollback }));
  }

  return ok({
    archivedCurrentTo: plan.hasLive ? plan.displaced : null,
    restoredFrom: archive.path,
    undoArchiveId: plan.hasLive ? plan.displacedId : null,
  });
}
