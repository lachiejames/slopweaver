/**
 * Where the Trelica atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Screenshots are artifacts INSIDE the generation
 *
 * A page's PNG is written under `<root>/artifacts/pages/<sha256>.png`, addressed by the digest of its own
 * bytes, so the same picture is the same artifact and a proof cannot be swapped for a different one under
 * the same path. They are images of a real tenant, so they live under the private state home and are never
 * committed.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes the two API channels; `browserSurface.ts` publishes the walk's. Both write the
 * `method` kind, because the corroboration between the channels IS the output — which is exactly what makes
 * a lost update reachable. The Notion atlas found that class by counterexample in review.
 *
 * Refusing it is the kit's: `kit/store.ts`'s `publishAtlas` takes the mutation lock and compare-and-swaps
 * against the whole manifest a candidate was derived from, on every publish and however a platform is
 * written. What stays here is the publish lock across the WHOLE read-and-publish, which is a cost control —
 * both passes here spend real time with a provider, and the one that would lose the swap should wait rather
 * than pay for a generation it will not keep.
 */
import { join } from "node:path";

import { type Result } from "../../lib/result.js";
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
  TRELICA_ATLAS_KINDS,
  TRELICA_ATLAS_PLATFORM,
  TRELICA_ATLAS_SCHEMA_VERSION,
  type TrelicaAtlasKind,
  type TrelicaAtlasKindFile,
  type TrelicaAtlasManifest,
  trelicaAtlasKindFileSchema,
  trelicaAtlasManifestSchema,
} from "./model.js";
import { TRELICA_KIND_VOLUMES } from "./volume.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const TRELICA_SUPERSEDE_REMEDY =
  "run: slopweaver atlas trelica reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Trelica atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface TrelicaAtlasPaths extends AtlasStorePaths<TrelicaAtlasKind> {
  /** `<root>/artifacts/pages` — where a page's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the Trelica atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type TrelicaAtlasSnapshot = AtlasSnapshot<TrelicaAtlasKind, TrelicaAtlasKindFile, TrelicaAtlasManifest>;

/** Everything the kit needs to read, grade and publish a Trelica generation. */
export const TRELICA_STORE_SPEC: AtlasStoreSpec<TrelicaAtlasKind, TrelicaAtlasKindFile, TrelicaAtlasManifest> = {
  kinds: TRELICA_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: TRELICA_KIND_VOLUMES,
  parseKindFile: ({ json }) => trelicaAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => trelicaAtlasManifestSchema.safeParse(json),
  platform: TRELICA_ATLAS_PLATFORM,
  schemaVersion: TRELICA_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: TRELICA_SUPERSEDE_REMEDY,
};

/**
 * The path a page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function trelicaPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Trelica atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function trelicaAtlasPaths({ home }: { home: string }): TrelicaAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.trelica;
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
export function readTrelicaManifest({ paths }: { paths: TrelicaAtlasPaths }): Result<TrelicaAtlasManifest | null> {
  return readManifest({ paths, spec: TRELICA_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readTrelicaKindFile({
  paths,
  kind,
}: {
  paths: TrelicaAtlasPaths;
  kind: TrelicaAtlasKind;
}): Result<TrelicaAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: TRELICA_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readTrelicaAtlas({ paths }: { paths: TrelicaAtlasPaths }): Result<TrelicaAtlasSnapshot> {
  return readAtlas({ paths, spec: TRELICA_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishTrelicaAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: TrelicaAtlasPaths;
  files: Readonly<Partial<Record<TrelicaAtlasKind, TrelicaAtlasKindFile>>>;
  manifest: TrelicaAtlasManifest;
  derivedFrom: TrelicaAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: TRELICA_STORE_SPEC });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const TRELICA_PUBLISH_LOCK_KEY = "atlas:trelica:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withTrelicaPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: TrelicaAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: TRELICA_PUBLISH_LOCK_KEY,
    nowIso,
    platform: TRELICA_ATLAS_PLATFORM,
    publish,
  });
}
