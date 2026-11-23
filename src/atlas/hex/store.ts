/**
 * Where the Hex atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `syncPublish.ts` publishes the `api` and `method` kinds' API channel; `walk.ts` publishes `page` and the browser
 * channel's own method rows. The kit's `publishAtlas` leaves an omitted kind's file untouched, so neither
 * pass can blank what the other wrote — and because both write `method`, the read-and-publish is taken
 * under a lock as well. The corroboration between the two channels on ONE kind is this atlas's whole
 * output, which is the same design decision that makes the race reachable.
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
  readManifest,
} from "../kit/store.js";

import {
  HEX_ATLAS_KINDS,
  HEX_ATLAS_PLATFORM,
  HEX_ATLAS_SCHEMA_VERSION,
  type HexAtlasKind,
  type HexAtlasKindFile,
  type HexAtlasManifest,
  hexAtlasKindFileSchema,
  hexAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const HEX_SUPERSEDE_REMEDY =
  "run: slopweaver atlas hex reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Hex atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type HexAtlasPaths = AtlasStorePaths<HexAtlasKind>;

/**
 * What the Hex atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type HexAtlasSnapshot = AtlasSnapshot<HexAtlasKind, HexAtlasKindFile, HexAtlasManifest>;

/** Everything the kit needs to read, grade and publish a Hex generation. */
export const HEX_STORE_SPEC: AtlasStoreSpec<HexAtlasKind, HexAtlasKindFile, HexAtlasManifest> = {
  // This atlas stamps `lastAttempt` on EVERY kind it writes, success or not — the three kinds no credential
  // and no signed-in console can fill get a file carrying their own cell, which is deliberate (see
  // `sync.ts`). So a kind whose manifest records an attempt and no success is the manifest and the file
  // honestly agreeing on "not yet synced", not the half-written first generation the kit's default grading
  // assumes.
  gradeNeverSucceeded: ({ status }) => (status?.lastAttempt == null ? "unpublished" : "agrees"),
  kinds: HEX_ATLAS_KINDS,
  kindObligations: {
    exceptions: {
      page: {
        rule: "optional",
        why: "declared before anything fills them, because a kind nothing declares is a kind no generation can publish a non-`synced` state for (see `model.ts`)",
      },
      project: {
        rule: "optional",
        why: "declared before anything fills them, because a kind nothing declares is a kind no generation can publish a non-`synced` state for (see `model.ts`)",
      },
      resource: {
        rule: "optional",
        why: "declared before anything fills them, because a kind nothing declares is a kind no generation can publish a non-`synced` state for (see `model.ts`)",
      },
    },
  },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => hexAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => hexAtlasManifestSchema.safeParse(json),
  platform: HEX_ATLAS_PLATFORM,
  schemaVersion: HEX_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: HEX_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Hex atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function hexAtlasPaths({ home }: { home: string }): HexAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.hex;
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
export function readHexManifest({ paths }: { paths: HexAtlasPaths }): Result<HexAtlasManifest | null> {
  return readManifest({ paths, spec: HEX_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readHexAtlas({ paths }: { paths: HexAtlasPaths }): Result<HexAtlasSnapshot> {
  return readAtlas({ paths, spec: HEX_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishHexAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: HexAtlasPaths;
  files: Readonly<Partial<Record<HexAtlasKind, HexAtlasKindFile>>>;
  manifest: HexAtlasManifest;
  derivedFrom: HexAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: HEX_STORE_SPEC });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const HEX_PUBLISH_LOCK_KEY = "atlas:hex:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withHexPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: HexAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: HEX_PUBLISH_LOCK_KEY,
    nowIso,
    platform: HEX_ATLAS_PLATFORM,
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
export function hexAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
