/**
 * Where the Clerk atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Screenshots are artifacts INSIDE the generation, and this platform's are the most sensitive of them
 *
 * A page's PNG is written under `<root>/artifacts/pages/<sha256>.png`, addressed by the digest of its own
 * bytes, so the same picture is the same artifact and a proof cannot be swapped for a different one under
 * the same path. A signed-in Clerk dashboard renders the product's own end users — names and email
 * addresses, on the very first page — so these live under the private state home, are never committed, and
 * are never printed by any verb. `sensitive` is resolved like every other platform's and is expected to
 * stay empty: nothing this atlas stores as a FIELD is a withheld value.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes the `operation` kind's compiled channel and the whole `webhook-event` kind, and omits
 * `page`; `browserSurface.ts` publishes `page` and the `operation` kind's browser channel. The kit's
 * `publishAtlas` leaves an omitted kind's file untouched, so neither pass can blank what the other wrote —
 * and because both touch `operation`, this atlas also takes the publish lock rather than relying on that.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { bindAtlasStore } from "../kit/publish.js";
import { withAtlasPublishLock } from "../kit/publishGuard.js";
import { type AtlasSnapshot, type AtlasStorePaths, type AtlasStoreSpec, atlasJson } from "../kit/store.js";

import {
  CLERK_ATLAS_KINDS,
  CLERK_ATLAS_PLATFORM,
  CLERK_ATLAS_SCHEMA_VERSION,
  type ClerkAtlasKind,
  type ClerkAtlasKindFile,
  type ClerkAtlasManifest,
  clerkAtlasKindFileSchema,
  clerkAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const CLERK_SUPERSEDE_REMEDY =
  "run: slopweaver atlas clerk reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Clerk atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface ClerkAtlasPaths extends AtlasStorePaths<ClerkAtlasKind> {
  /** `<root>/artifacts/pages` — where a page's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the Clerk atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type ClerkAtlasSnapshot = AtlasSnapshot<ClerkAtlasKind, ClerkAtlasKindFile, ClerkAtlasManifest>;

/** Everything the kit needs to read, grade and publish a Clerk generation. */
export const CLERK_STORE_SPEC: AtlasStoreSpec<ClerkAtlasKind, ClerkAtlasKindFile, ClerkAtlasManifest> = {
  kinds: CLERK_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => clerkAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => clerkAtlasManifestSchema.safeParse(json),
  platform: CLERK_ATLAS_PLATFORM,
  schemaVersion: CLERK_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: CLERK_SUPERSEDE_REMEDY,
};

/**
 * Every store read and write with CLERK_STORE_SPEC already applied — see {@link bindAtlasStore} on why the
 * spec is bound once rather than passed at each call site.
 */
const store = bindAtlasStore({ spec: CLERK_STORE_SPEC });

/**
 * The path a page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function clerkPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Clerk atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function clerkAtlasPaths({ home }: { home: string }): ClerkAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.clerk;
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
export function readClerkManifest({ paths }: { paths: ClerkAtlasPaths }): Result<ClerkAtlasManifest | null> {
  return store.readManifest({ paths });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readClerkKindFile({
  paths,
  kind,
}: {
  paths: ClerkAtlasPaths;
  kind: ClerkAtlasKind;
}): Result<ClerkAtlasKindFile | null> {
  return store.readKindFile({ kind, paths });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readClerkAtlas({ paths }: { paths: ClerkAtlasPaths }): Result<ClerkAtlasSnapshot> {
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
export function publishClerkAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: ClerkAtlasPaths;
  files: Readonly<Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile>>>;
  manifest: ClerkAtlasManifest;
  derivedFrom: ClerkAtlasManifest | null;
}): Result<readonly string[]> {
  return store.publish({ derivedFrom, files, manifest, paths });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const CLERK_PUBLISH_LOCK_KEY = "atlas:clerk:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * The lock itself is the kit's ({@link withAtlasPublishLock}). This atlas needs it and some of its siblings
 * do not, for a structural reason worth stating: an atlas whose browser walk gets its OWN kinds never has
 * two writers touching one file, while both of this atlas's writers publish the `operation` kind — because
 * the corroboration between the two channels is the output, which is the same design decision that makes
 * the race reachable.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withClerkPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: ClerkAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: CLERK_PUBLISH_LOCK_KEY,
    nowIso,
    platform: CLERK_ATLAS_PLATFORM,
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
export function clerkAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
