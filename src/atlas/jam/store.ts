/**
 * Where the Jam atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes every kind's `compiled` channel; `webSurface.ts` publishes `page` and the browser
 * channel's own `operation` and `integration` rows. The kit's `publishAtlas` leaves an omitted kind's file
 * untouched, so neither pass can blank what the other wrote — and because both write `operation` and
 * `integration`, the read-and-publish is taken under a lock as well. The corroboration between the two
 * channels on those kinds is the output, which is the same design decision that makes the race reachable.
 */
import { type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
import { withAtlasPublishLock } from "../kit/publishGuard.js";
import {
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  atlasJson,
  readAtlas,
  readKindFile,
  readManifest,
} from "../kit/store.js";

import {
  JAM_ATLAS_KINDS,
  JAM_ATLAS_PLATFORM,
  JAM_ATLAS_SCHEMA_VERSION,
  type JamAtlasKind,
  type JamAtlasKindFile,
  type JamAtlasManifest,
  jamAtlasKindFileSchema,
  jamAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const JAM_SUPERSEDE_REMEDY =
  "run: slopweaver atlas jam reset --confirm archive — this archives the old generation and installs a " +
  "fresh, empty one this build can write";

/** Every path the Jam atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type JamAtlasPaths = AtlasStorePaths<JamAtlasKind>;

/**
 * What the Jam atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type JamAtlasSnapshot = AtlasSnapshot<JamAtlasKind, JamAtlasKindFile, JamAtlasManifest>;

/** Everything the kit needs to read, grade and publish a Jam generation. */
export const JAM_STORE_SPEC: AtlasStoreSpec<JamAtlasKind, JamAtlasKindFile, JamAtlasManifest> = {
  // This atlas stamps `lastAttempt` on EVERY kind it writes, success or not — `page` gets a file carrying
  // its own `not-configured` cell before any walk has run, which is deliberate (see `sync.ts`). So a kind
  // whose manifest records an attempt and no success is the manifest and the file honestly agreeing on "not
  // yet walked", not the half-written first generation the kit's default grading assumes.
  gradeNeverSucceeded: ({ status }) => (status?.lastAttempt == null ? "unpublished" : "agrees"),
  kinds: JAM_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => jamAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => jamAtlasManifestSchema.safeParse(json),
  platform: JAM_ATLAS_PLATFORM,
  schemaVersion: JAM_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: JAM_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Jam atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function jamAtlasPaths({ home }: { home: string }): JamAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.jam;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
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
export function readJamManifest({ paths }: { paths: JamAtlasPaths }): Result<JamAtlasManifest | null> {
  return readManifest({ paths, spec: JAM_STORE_SPEC });
}

/**
 * Read one kind's file, for a reader that needs one rather than the whole generation.
 *
 * @param paths the resolved paths
 * @param kind the kind to read
 * @returns the file, `null` when that kind has never been published, or why it cannot be read
 *
 * @internal
 */
export function readJamKindFile({
  paths,
  kind,
}: {
  paths: JamAtlasPaths;
  kind: JamAtlasKind;
}): Result<JamAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: JAM_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readJamAtlas({ paths }: { paths: JamAtlasPaths }): Result<JamAtlasSnapshot> {
  return readAtlas({ paths, spec: JAM_STORE_SPEC });
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
export function publishJamAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: JamAtlasPaths;
  files: Readonly<Partial<Record<JamAtlasKind, JamAtlasKindFile>>>;
  manifest: JamAtlasManifest;
  derivedFrom: JamAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: JAM_STORE_SPEC });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const JAM_PUBLISH_LOCK_KEY = "atlas:jam:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withJamPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: JamAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: JAM_PUBLISH_LOCK_KEY,
    nowIso,
    platform: JAM_ATLAS_PLATFORM,
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
export function jamAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
