/**
 * JumpCloud's projection into the kit's normalized read view.
 *
 * ## Why the seam landed before the store did
 *
 * A descriptor on disk with no registry row is the 1Password failure `registryCoversEveryAtlas.test.ts` was
 * written to catch: that atlas synced a full generation of entities and stayed unreachable through the read verb while
 * every test passed. So this module shipped with the descriptor, answering an honest refusal, and now that
 * `atlas jumpcloud sync` exists it reads what the sync published. The registration never changed, which was
 * the point of putting it first.
 *
 * ## A refusal is still the answer when nothing has been published
 *
 * An empty snapshot would answer "zero systems" to a question about this organisation's devices, which is
 * false and indistinguishable from a tenancy with none. So a store with no manifest at all is reported as
 * unreadable, naming the one command that changes it — the same reasoning that makes `kit/read.ts` refuse
 * to let a channel that has never looked contribute an observation.
 *
 * Two channels rather than one, so an entity projects to up to two observations, and the judgement about a
 * channel that has never looked lives ONCE in `kit/read.ts` rather than being written a fourth time here.
 *
 * ## The descriptor a reader gets back is this INSTALL's, not the source file's
 *
 * A surface's `status` is a static literal in `descriptor.ts`, which would be `filled` on every install
 * including one where the sync has never run. So the descriptor returned here is projected through
 * `surfaceFill.ts`, which derives each surface's status from the manifest against an exact invariant. See
 * that module for the two atlases where the static form went wrong in production.
 *
 * ## The console generation is read beside the API one, never instead of it
 *
 * `atlas jumpcloud walk` publishes its `page` and `method` kinds into a generation of their own
 * (`consoleModel.ts`). They are appended to the snapshot once a walk has published, so `read --kind page`
 * answers from them, and a console store that cannot be read makes the `admin-console` surface say so rather
 * than failing the whole atlas — the Directory API half is still true.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  type AtlasKindView,
  type AtlasObservationView,
  type AtlasReadError,
  AtlasReadErrors,
  type AtlasReadSnapshot,
  channelObservations,
  coverageCellViews,
  firstChannelDetail,
  gapViews,
} from "../kit/read.js";
import { JUMPCLOUD_CONSOLE_KINDS, type JumpcloudConsoleEntity, type JumpcloudConsoleKindFile } from "./consoleModel.js";
import { type JumpcloudConsoleSnapshot, jumpcloudConsolePaths, readJumpcloudConsole } from "./consoleStore.js";
import type { JumpcloudEntity } from "./entities.js";
import {
  JUMPCLOUD_ATLAS_PLATFORM,
  JUMPCLOUD_KINDS,
  JUMPCLOUD_SCHEMA_VERSION,
  JUMPCLOUD_SURFACE_NAMES,
  type JumpcloudKind,
} from "./model.js";
import { type JumpcloudAtlasSnapshot, jumpcloudAtlasPaths, readJumpcloudAtlas } from "./store.js";
import { type JumpcloudConsoleEvidence, jumpcloudDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per surface that has actually looked
 * @internal
 */
export function jumpcloudObservations({
  entity,
}: {
  entity: JumpcloudEntity | JumpcloudConsoleEntity;
}): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: JUMPCLOUD_SURFACE_NAMES });
}

/**
 * Read the JumpCloud atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why there is nothing to project
 */
export function readJumpcloudSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const root = stateHomePaths(home === undefined ? {} : { home }).root;
  const paths = jumpcloudAtlasPaths({ home: root });
  const snapshot = readJumpcloudAtlas({ paths });
  const consoleRead = readJumpcloudConsole({ paths: jumpcloudConsolePaths({ home: root }) });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: JUMPCLOUD_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: JUMPCLOUD_ATLAS_PLATFORM,
        remedy: "run `slopweaver atlas jumpcloud sync`",
      }),
    );
  }
  const kinds = apiKindViews({ files, manifest });
  const consoleSnapshot = consoleRead.isOk() ? consoleRead.value : null;
  const evidence = consoleEvidence({ read: consoleRead });
  return ok({
    descriptor: jumpcloudDescriptorFor({ console: evidence, manifest }),
    generation: {
      mismatched: [
        ...mismatched,
        ...consoleNames({ kinds: consoleSnapshot === null ? [] : consoleSnapshot.mismatched }),
      ],
      missing: [...missing, ...consoleNames({ kinds: consoleSnapshot === null ? [] : consoleSnapshot.missing })],
      platform: JUMPCLOUD_ATLAS_PLATFORM,
      schemaVersion: JUMPCLOUD_SCHEMA_VERSION,
      superseded: [
        ...superseded,
        ...consoleNames({ kinds: consoleSnapshot === null ? [] : consoleSnapshot.superseded }),
      ],
      unpublished: [
        ...unpublished,
        ...consoleNames({ kinds: consoleSnapshot === null ? [] : consoleSnapshot.unpublished }),
      ],
      updatedAt: manifest.updatedAt,
    },
    kinds: [...kinds, ...consoleKindViews({ snapshot: consoleSnapshot })],
  });
}

/** The API generation's kinds as read views. */
function apiKindViews({
  files,
  manifest,
}: {
  files: JumpcloudAtlasSnapshot["files"];
  manifest: NonNullable<JumpcloudAtlasSnapshot["manifest"]>;
}): readonly AtlasKindView[] {
  return JUMPCLOUD_KINDS.map((kind: JumpcloudKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: "directory-api" }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: JUMPCLOUD_SURFACE_NAMES }),
              id: entity.id,
              kind: entity.kind,
              observations: jumpcloudObservations({ entity }),
              providerId: entity.providerId,
              scope: JUMPCLOUD_ATLAS_PLATFORM,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
      productAbsent: status.productAbsent === undefined ? null : status.productAbsent,
      publishedCount: status.entityCount,
    };
  });
}

/** What the console generation holds, as the fill check reads it — a read error kept as its reason. */
function consoleEvidence({ read }: { read: Result<JumpcloudConsoleSnapshot> }): JumpcloudConsoleEvidence {
  const snapshot = read.isOk() ? read.value : null;
  return {
    manifest: snapshot === null ? null : snapshot.manifest,
    pageFile: snapshot === null ? null : snapshot.files.page,
    unreadableBecause: read.isErr() ? read.error.join("; ") : null,
  };
}

/** A console kind named as the generation report prints it, so it cannot be mistaken for an API kind. */
function consoleNames({ kinds }: { kinds: readonly string[] }): readonly string[] {
  return kinds.map((kind) => `console/${kind}`);
}

/** One console kind file's entities as read views. */
function consoleEntityViews({ file }: { file: JumpcloudConsoleKindFile | null }): AtlasKindView["entities"] {
  if (file === null) {
    return [];
  }
  return file.entities.map((entity) => ({
    detail: firstChannelDetail({ channels: entity.channels, order: JUMPCLOUD_SURFACE_NAMES }),
    id: entity.id,
    kind: entity.kind,
    observations: jumpcloudObservations({ entity }),
    providerId: entity.providerId,
    scope: JUMPCLOUD_ATLAS_PLATFORM,
  }));
}

/**
 * The console generation's two kinds, once a walk has published them; none before, since a kind no walk
 * has written would read as an empty console rather than an unwalked one.
 */
function consoleKindViews({ snapshot }: { snapshot: JumpcloudConsoleSnapshot | null }): readonly AtlasKindView[] {
  if (snapshot?.manifest == null) {
    return [];
  }
  const { manifest, files } = snapshot;
  return JUMPCLOUD_CONSOLE_KINDS.map((kind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: "admin-console" }),
      entities: consoleEntityViews({ file }),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: null,
      publishedCount: status.entityCount,
    };
  });
}
