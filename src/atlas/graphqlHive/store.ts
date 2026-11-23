/**
 * Where the GraphQL Hive atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Two artifact directories, both content-addressed
 *
 * A console page's PNG is written under `<root>/artifacts/pages/<sha256>.png`, and a target's composed SDL
 * under `<root>/artifacts/schemas/<sha256>.graphql`. Both are addressed by the digest of their own bytes,
 * so the same picture or the same schema is the same artifact and a proof cannot be swapped for a different
 * one under the same path. Both are content of a real organisation's registry, so they live under the
 * private state home and are never committed.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes the API channel across five kinds and omits `page`; `browserSurface.ts` publishes
 * `page` and the browser channel's own rows. The kit's `publishAtlas` leaves an omitted kind's file
 * untouched, so neither pass can blank what the other wrote — and `withHivePublishLock` closes the
 * read-then-publish race that atomicity alone does not, exactly as it does for Notion.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { bindAtlasStore } from "../kit/publish.js";
import { withAtlasPublishLock } from "../kit/publishGuard.js";
import { type AtlasSnapshot, type AtlasStorePaths, type AtlasStoreSpec, atlasJson } from "../kit/store.js";

import {
  HIVE_ATLAS_KINDS,
  HIVE_ATLAS_PLATFORM,
  HIVE_ATLAS_SCHEMA_VERSION,
  type HiveAtlasKind,
  type HiveAtlasKindFile,
  type HiveAtlasManifest,
  hiveAtlasKindFileSchema,
  hiveAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const HIVE_SUPERSEDE_REMEDY =
  "run: slopweaver atlas graphql-hive reset --confirm archive — this archives the old generation and " +
  "installs a fresh, empty one this build can write";

/** Every path the GraphQL Hive atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract. */
export interface HiveAtlasPaths extends AtlasStorePaths<HiveAtlasKind> {
  /** `<root>/artifacts/pages` — where a console page's proof screenshot is written, named by its digest. */
  readonly pageArtifacts: string;
  /** `<root>/artifacts/schemas` — where a target's composed SDL is written, named by its digest. */
  readonly schemaArtifacts: string;
}

/**
 * What the GraphQL Hive atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type HiveAtlasSnapshot = AtlasSnapshot<HiveAtlasKind, HiveAtlasKindFile, HiveAtlasManifest>;

/** Everything the kit needs to read, grade and publish a GraphQL Hive generation. */
export const HIVE_STORE_SPEC: AtlasStoreSpec<HiveAtlasKind, HiveAtlasKindFile, HiveAtlasManifest> = {
  kinds: HIVE_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => hiveAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => hiveAtlasManifestSchema.safeParse(json),
  platform: HIVE_ATLAS_PLATFORM,
  schemaVersion: HIVE_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: HIVE_SUPERSEDE_REMEDY,
};

/**
 * The path a console page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function hivePageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * The path a target's composed SDL is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the SDL's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function hiveSchemaArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/schemas/${sha256}.graphql`;
}

/**
 * Every store read and write with HIVE_STORE_SPEC already applied — see {@link bindAtlasStore} on why the
 * spec is bound once rather than passed at each call site.
 */
const store = bindAtlasStore({ spec: HIVE_STORE_SPEC });

/**
 * Resolve every GraphQL Hive atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function hiveAtlasPaths({ home }: { home: string }): HiveAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.graphqlHive;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    pageArtifacts: join(paths.root, "artifacts", "pages"),
    schemaArtifacts: join(paths.root, "artifacts", "schemas"),
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
export function readHiveManifest({ paths }: { paths: HiveAtlasPaths }): Result<HiveAtlasManifest | null> {
  return store.readManifest({ paths });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readHiveKindFile({
  paths,
  kind,
}: {
  paths: HiveAtlasPaths;
  kind: HiveAtlasKind;
}): Result<HiveAtlasKindFile | null> {
  return store.readKindFile({ kind, paths });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readHiveAtlas({ paths }: { paths: HiveAtlasPaths }): Result<HiveAtlasSnapshot> {
  return store.readAtlas({ paths });
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
export function publishHiveAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: HiveAtlasPaths;
  files: Readonly<Partial<Record<HiveAtlasKind, HiveAtlasKindFile>>>;
  manifest: HiveAtlasManifest;
  derivedFrom: HiveAtlasManifest | null;
}): Result<readonly string[]> {
  return store.publish({ derivedFrom, files, manifest, paths });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const HIVE_PUBLISH_LOCK_KEY = "atlas:graphql-hive:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * Both of this atlas's writers touch the same kinds — the API channel fills `operation`, `type` and the
 * three registry kinds while the browser channel fills `page` — so the race is reachable here for the same
 * structural reason it is in the Notion atlas, and is closed by the same kit lock.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withHivePublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: HiveAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: HIVE_PUBLISH_LOCK_KEY,
    nowIso,
    platform: HIVE_ATLAS_PLATFORM,
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
export function hiveAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
