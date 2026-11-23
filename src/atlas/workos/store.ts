/**
 * Where the WorkOS atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## One artifact directory, content-addressed
 *
 * A dashboard page's PNG is written under `<root>/artifacts/pages/<sha256>.png`, addressed by the digest of
 * its own bytes, so the same picture is the same artifact and a proof cannot be swapped for a different one
 * under the same path. Screenshots of a real tenant's dashboard live under the private state home and are
 * never committed. The API half needs no artifact directory of its own: its evidence is a status code and a
 * classification, both of which fit in the entity.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes the API channel and omits `page`; `browserSurface.ts` publishes `page` and the
 * browser channel's own rows. The kit's `publishAtlas` leaves an omitted kind's file untouched, so neither
 * pass can blank what the other wrote — and `withWorkosPublishLock` closes the read-then-publish race that
 * atomicity alone does not.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
import { withAtlasPublishLock } from "../kit/publishGuard.js";
import {
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  readAtlas,
  readKindFile,
  readManifest,
} from "../kit/store.js";

import {
  WORKOS_ATLAS_KINDS,
  WORKOS_ATLAS_PLATFORM,
  WORKOS_ATLAS_SCHEMA_VERSION,
  type WorkosAtlasKind,
  type WorkosAtlasKindFile,
  type WorkosAtlasManifest,
  workosAtlasKindFileSchema,
  workosAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const WORKOS_SUPERSEDE_REMEDY =
  "run: slopweaver atlas workos reset --confirm archive — this archives the old generation and installs a " +
  "fresh, empty one this build can write";

/** Every path the WorkOS atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract. */
export interface WorkosAtlasPaths extends AtlasStorePaths<WorkosAtlasKind> {
  /** `<root>/artifacts/pages` — where a dashboard page's proof screenshot is written, named by its digest. */
  readonly pageArtifacts: string;
}

/**
 * What the WorkOS atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type WorkosAtlasSnapshot = AtlasSnapshot<WorkosAtlasKind, WorkosAtlasKindFile, WorkosAtlasManifest>;

/** Everything the kit needs to read, grade and publish a WorkOS generation. */
export const WORKOS_STORE_SPEC: AtlasStoreSpec<WorkosAtlasKind, WorkosAtlasKindFile, WorkosAtlasManifest> = {
  kinds: WORKOS_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => workosAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => workosAtlasManifestSchema.safeParse(json),
  platform: WORKOS_ATLAS_PLATFORM,
  schemaVersion: WORKOS_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: WORKOS_SUPERSEDE_REMEDY,
};

/**
 * The path a dashboard page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function workosPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every WorkOS atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function workosAtlasPaths({ home }: { home: string }): WorkosAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.workos;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    pageArtifacts: join(paths.root, "artifacts", "pages"),
    superseded: paths.superseded,
  };
}

/**
 * Read the manifest, refusing anything it cannot trust.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 *
 * @internal
 */
export function readWorkosManifest({ paths }: { paths: WorkosAtlasPaths }): Result<WorkosAtlasManifest | null> {
  return readManifest({ paths, spec: WORKOS_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readWorkosKindFile({
  paths,
  kind,
}: {
  paths: WorkosAtlasPaths;
  kind: WorkosAtlasKind;
}): Result<WorkosAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: WORKOS_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readWorkosAtlas({ paths }: { paths: WorkosAtlasPaths }): Result<WorkosAtlasSnapshot> {
  return readAtlas({ paths, spec: WORKOS_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes
 * written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishWorkosAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: WorkosAtlasPaths;
  files: Readonly<Partial<Record<WorkosAtlasKind, WorkosAtlasKindFile>>>;
  manifest: WorkosAtlasManifest;
  derivedFrom: WorkosAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: WORKOS_STORE_SPEC });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const WORKOS_PUBLISH_LOCK_KEY = "atlas:workos:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withWorkosPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: WorkosAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: WORKOS_PUBLISH_LOCK_KEY,
    nowIso,
    platform: WORKOS_ATLAS_PLATFORM,
    publish,
  });
}
