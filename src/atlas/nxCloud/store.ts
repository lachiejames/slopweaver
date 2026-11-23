/**
 * Where the Nx Cloud atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Screenshots are artifacts INSIDE the generation
 *
 * A route's PNG is written under `<root>/artifacts/pages/<sha256>.png`, addressed by the digest of its own
 * bytes, so the same picture is the same artifact and a proof cannot be swapped for a different one under
 * the same path. They are images of a real workspace, so they live under the private state home and are
 * never committed.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes the `web-data` channel across `organization`, `workspace`, `endpoint` and `family`;
 * `browserSurface.ts` publishes `route` and the browser channel's own endpoint rows. Both write
 * `endpoint`, because the corroboration between the two channels is the OUTPUT — which is the same design
 * decision that makes a lost update reachable.
 *
 * The lost update itself is the kit's to refuse, and it does: `kit/store.ts`'s `publishAtlas` takes the
 * mutation lock and compare-and-swaps against the whole manifest a candidate was derived from, on every
 * publish, whatever an atlas remembers to call. What stays here is {@link withNxCloudPublishLock}, taken
 * across the WHOLE read-and-publish — a cost control rather than the correctness boundary, so the writer
 * that would lose the swap waits instead of doing its provider work first.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { withAtlasPublishLock } from "../kit/publishGuard.js";
import { type AtlasSnapshot, type AtlasStorePaths, type AtlasStoreSpec, atlasJson } from "../kit/store.js";
import { createAtlasStore } from "../kit/storeFacade.js";

import {
  NX_CLOUD_ATLAS_KINDS,
  NX_CLOUD_ATLAS_PLATFORM,
  NX_CLOUD_ATLAS_SCHEMA_VERSION,
  type NxCloudAtlasKind,
  type NxCloudAtlasKindFile,
  type NxCloudAtlasManifest,
  nxCloudAtlasKindFileSchema,
  nxCloudAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const NX_CLOUD_SUPERSEDE_REMEDY =
  "run: slopweaver atlas nx-cloud reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Nx Cloud atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface NxCloudAtlasPaths extends AtlasStorePaths<NxCloudAtlasKind> {
  /** `<root>/artifacts/pages` — where a route's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the Nx Cloud atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type NxCloudAtlasSnapshot = AtlasSnapshot<NxCloudAtlasKind, NxCloudAtlasKindFile, NxCloudAtlasManifest>;

/** Everything the kit needs to read, grade and publish an Nx Cloud generation. */
export const NX_CLOUD_STORE_SPEC: AtlasStoreSpec<NxCloudAtlasKind, NxCloudAtlasKindFile, NxCloudAtlasManifest> = {
  kinds: NX_CLOUD_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => nxCloudAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => nxCloudAtlasManifestSchema.safeParse(json),
  platform: NX_CLOUD_ATLAS_PLATFORM,
  schemaVersion: NX_CLOUD_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: NX_CLOUD_SUPERSEDE_REMEDY,
};

/**
 * The path a route screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function nxCloudPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Nx Cloud atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function nxCloudAtlasPaths({ home }: { home: string }): NxCloudAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.nxCloud;
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
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const NX_CLOUD_PUBLISH_LOCK_KEY = "atlas:nx-cloud:publish";

/**
 * Every store door this atlas opens, built once from its spec — see `kit/storeFacade.ts`.
 *
 * @internal
 */
const STORE = createAtlasStore({ spec: NX_CLOUD_STORE_SPEC });

/**
 * Read the manifest, refusing anything it cannot trust.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 *
 * @internal
 */
export function readNxCloudManifest({ paths }: { paths: NxCloudAtlasPaths }): Result<NxCloudAtlasManifest | null> {
  return STORE.manifest({ paths });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readNxCloudKindFile({
  paths,
  kind,
}: {
  paths: NxCloudAtlasPaths;
  kind: NxCloudAtlasKind;
}): Result<NxCloudAtlasKindFile | null> {
  return STORE.kindFile({ kind, paths });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readNxCloudAtlas({ paths }: { paths: NxCloudAtlasPaths }): Result<NxCloudAtlasSnapshot> {
  return STORE.snapshot({ paths });
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
export function publishNxCloudAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: NxCloudAtlasPaths;
  files: Readonly<Partial<Record<NxCloudAtlasKind, NxCloudAtlasKindFile>>>;
  manifest: NxCloudAtlasManifest;
  derivedFrom: NxCloudAtlasManifest | null;
}): Result<readonly string[]> {
  return STORE.publish({ derivedFrom, files, manifest, paths });
}

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withNxCloudPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: NxCloudAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: NX_CLOUD_PUBLISH_LOCK_KEY,
    nowIso,
    platform: "Nx Cloud",
    publish,
  });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function nxCloudAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
