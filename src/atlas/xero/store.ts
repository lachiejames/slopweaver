/**
 * Where the Xero atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
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
 * the same path. These are pictures of a real organisation's books, so they live under the private state
 * home and are never committed. `sensitive` is resolved like every other platform's and is expected to stay
 * empty: nothing this atlas stores is a WITHHELD value.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes `method`'s API channel and the whole `family` kind, and omits `page`;
 * `browserSurface.ts` publishes `page` and the `method` kind's browser channel. The kit's `publishAtlas`
 * leaves an omitted kind's file untouched, so neither pass can blank what the other wrote. Neither passes a
 * full file map, which is what makes that true.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { bindAtlasStore } from "../kit/publish.js";
import { withAtlasPublishLock } from "../kit/publishGuard.js";
import { type AtlasSnapshot, type AtlasStorePaths, type AtlasStoreSpec, atlasJson } from "../kit/store.js";

import {
  XERO_ATLAS_KINDS,
  XERO_ATLAS_PLATFORM,
  XERO_ATLAS_SCHEMA_VERSION,
  type XeroAtlasKind,
  type XeroAtlasKindFile,
  type XeroAtlasManifest,
  xeroAtlasKindFileSchema,
  xeroAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const XERO_SUPERSEDE_REMEDY =
  "run: slopweaver atlas xero reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Xero atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface XeroAtlasPaths extends AtlasStorePaths<XeroAtlasKind> {
  /** `<root>/artifacts/pages` — where a page's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the Xero atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type XeroAtlasSnapshot = AtlasSnapshot<XeroAtlasKind, XeroAtlasKindFile, XeroAtlasManifest>;

/** Everything the kit needs to read, grade and publish a Xero generation. */
export const XERO_STORE_SPEC: AtlasStoreSpec<XeroAtlasKind, XeroAtlasKindFile, XeroAtlasManifest> = {
  kinds: XERO_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => xeroAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => xeroAtlasManifestSchema.safeParse(json),
  platform: XERO_ATLAS_PLATFORM,
  schemaVersion: XERO_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: XERO_SUPERSEDE_REMEDY,
};

/**
 * Every store read and write with XERO_STORE_SPEC already applied — see {@link bindAtlasStore} on why the
 * spec is bound once rather than passed at each call site.
 */
const store = bindAtlasStore({ spec: XERO_STORE_SPEC });

/**
 * The path a page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function xeroPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Xero atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function xeroAtlasPaths({ home }: { home: string }): XeroAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.xero;
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
export function readXeroManifest({ paths }: { paths: XeroAtlasPaths }): Result<XeroAtlasManifest | null> {
  return store.readManifest({ paths });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readXeroKindFile({
  paths,
  kind,
}: {
  paths: XeroAtlasPaths;
  kind: XeroAtlasKind;
}): Result<XeroAtlasKindFile | null> {
  return store.readKindFile({ kind, paths });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readXeroAtlas({ paths }: { paths: XeroAtlasPaths }): Result<XeroAtlasSnapshot> {
  return store.readAtlas({ paths });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishXeroAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: XeroAtlasPaths;
  files: Readonly<Partial<Record<XeroAtlasKind, XeroAtlasKindFile>>>;
  manifest: XeroAtlasManifest;
  derivedFrom: XeroAtlasManifest | null;
}): Result<readonly string[]> {
  return store.publish({ derivedFrom, files, manifest, paths });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const XERO_PUBLISH_LOCK_KEY = "atlas:xero:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * The lock itself is the kit's ({@link withAtlasPublishLock}). This atlas needs it and some of its siblings
 * do not, for a structural reason worth stating: an atlas whose browser walk gets its OWN kinds never has two
 * writers touching one file, while both of this atlas's writers publish the `method` kind — because the
 * corroboration between the two channels is the output, which is the same design decision that makes the
 * race reachable.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withXeroPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: XeroAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: XERO_PUBLISH_LOCK_KEY,
    nowIso,
    platform: XERO_ATLAS_PLATFORM,
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
export function xeroAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
