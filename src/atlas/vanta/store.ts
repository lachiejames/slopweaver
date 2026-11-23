/**
 * Where the Vanta atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`, which this and the Cloudflare atlas had
 * each written out at ~350 lines apiece. What remains here is genuinely Vanta's: where the files live, the
 * extra `_sensitive` companion directory, the schemas, and the remedy to print when a generation was
 * published by a build that wrote a different schema version.
 *
 * Vanta declares no publish guard. The Cloudflare atlas does — it must never republish under a different
 * account than the generation it replaces — and {@link AtlasStoreSpec.guardPublish} is where that lives.
 */
import { join } from "node:path";

import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
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
  emptyVantaKindFile,
  initialVantaManifest,
  VANTA_ATLAS_PLATFORM,
  VANTA_ATLAS_SCHEMA_VERSION,
  VANTA_KINDS,
  type VantaKind,
  type VantaKindFile,
  type VantaManifest,
  vantaKindFileSchema,
  vantaManifestSchema,
} from "./model.js";
import { VANTA_KIND_VOLUMES } from "./volume.js";

/** What to do about a generation published under a schema version this build no longer writes. */
const VANTA_SUPERSEDE_REMEDY =
  "run: slopweaver atlas vanta reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Vanta atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface VantaAtlasPaths extends AtlasStorePaths<VantaKind> {
  /** Companion files for withheld financial values — never folded into a committed kind file. */
  readonly sensitive: string;
  /** `<root>/artifacts/pages` — where a walked page's proof screenshot is written, named by its digest. */
  readonly pageArtifacts: string;
}

/** What the Vanta atlas holds right now, as the reader sees it. */
export type VantaAtlasSnapshot = AtlasSnapshot<VantaKind, VantaKindFile, VantaManifest>;

/** Everything the kit needs to read, grade and publish a Vanta generation. */
export const VANTA_STORE_SPEC: AtlasStoreSpec<VantaKind, VantaKindFile, VantaManifest> = {
  kinds: VANTA_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: VANTA_KIND_VOLUMES,
  parseKindFile: ({ json }) => vantaKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => vantaManifestSchema.safeParse(json),
  platform: VANTA_ATLAS_PLATFORM,
  schemaVersion: VANTA_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: VANTA_SUPERSEDE_REMEDY,
};

/**
 * The path one walked page's screenshot is stored at, relative to the atlas root.
 *
 * Addressed by the digest of its own bytes rather than by the page's name, so the same picture is the same
 * file and a proof cannot be swapped for a different one under the same path — the kit's rule, and the
 * reason `kit/pageWalk.ts` takes this as a function rather than computing a path itself.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 * @internal
 */
export function vantaPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Vanta atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function vantaAtlasPaths({ home }: { home: string }): VantaAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.vanta;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    pageArtifacts: join(paths.root, "artifacts", "pages"),
    sensitive: paths.sensitive,
    superseded: paths.superseded,
  };
}

/**
 * Read the manifest, refusing anything it cannot trust.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 */
export function readVantaManifest({ paths }: { paths: VantaAtlasPaths }): Result<VantaManifest | null> {
  return readManifest({ paths, spec: VANTA_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readVantaKindFile({
  paths,
  kind,
}: {
  paths: VantaAtlasPaths;
  kind: VantaKind;
}): Result<VantaKindFile | null> {
  return readKindFile({ kind, paths, spec: VANTA_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readVantaAtlas({ paths }: { paths: VantaAtlasPaths }): Result<VantaAtlasSnapshot> {
  return readAtlas({ paths, spec: VANTA_STORE_SPEC });
}

/**
 * The kind file a snapshot holds, or the empty one a first run merges onto.
 *
 * Every publisher here needs this and it is the shape `no-silent-fallback` exists to name: a `??` reads as
 * "use the empty one" when what is actually true is "this atlas has never stored this kind", which is a
 * different fact and the one a reader wants. Written once so both browser publishers say it the same way.
 *
 * @param snapshot the atlas as it stands
 * @param kind which kind's file is wanted
 * @param at this run's ISO timestamp, stamped on the empty file when there is nothing stored
 * @returns the stored file, or an empty one of that kind
 */
export function storedVantaKindFile({
  snapshot,
  kind,
  at,
}: {
  snapshot: VantaAtlasSnapshot;
  kind: VantaKind;
  at: string;
}): VantaKindFile {
  const stored = snapshot.files[kind];
  if (stored === null) {
    return emptyVantaKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/**
 * The manifest a snapshot holds, or the initial one a first run builds on.
 *
 * Same reason as {@link storedVantaKindFile}: "there is no generation yet" is a fact worth a named branch.
 *
 * @param snapshot the atlas as it stands
 * @param at this run's ISO timestamp, stamped on the initial manifest
 * @returns the stored manifest, or a fresh one
 */
export function storedVantaManifest({ snapshot, at }: { snapshot: VantaAtlasSnapshot; at: string }): VantaManifest {
  if (snapshot.manifest === null) {
    return initialVantaManifest({ updatedAt: at });
  }
  return snapshot.manifest;
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishVantaAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: VantaAtlasPaths;
  files: Readonly<Partial<Record<VantaKind, VantaKindFile>>>;
  manifest: VantaManifest;
  derivedFrom: VantaManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: VANTA_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 */
export function vantaAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
