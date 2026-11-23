/**
 * Where this atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Why there is no publish LOCK here, and the exact condition that would change that
 *
 * The sibling Notion atlas holds a lock across read-and-publish because BOTH its writers publish the same
 * kinds, which makes a lost update reachable. Here there is exactly ONE writer: `sync.ts` publishes every
 * kind in a single pass, including `page`. A future walk would be the second writer, and it would write
 * `page` alone, so the two would still be disjoint by kind and `publishAtlas` leaves an omitted kind's file
 * untouched.
 *
 * That is a property of the CURRENT writers, not of the design, so it is written down rather than assumed: a
 * walk that also wrote an operation kind — recording which dashboard page calls which REST endpoint, which is
 * exactly the finding the browser half exists to produce — would make the interleaving reachable, and
 * `kit/publishGuard.ts`'s lock is what to reach for on the day that lands, to stop the loser paying for a
 * provider read it will not keep.
 *
 * Losing an update is not among the things that day would bring: `kit/store.ts`'s `publishAtlas` takes the
 * mutation lock and compare-and-swaps against the whole manifest a candidate was derived from, on every
 * publish, so this atlas is covered before it has a second writer rather than on the day somebody notices.
 */
import { type Result } from "../../lib/result.js";
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
  BRAZE_ATLAS_PLATFORM,
  BRAZE_ATLAS_SCHEMA_VERSION,
  BRAZE_KINDS,
  type BrazeAtlasKindFile,
  type BrazeAtlasManifest,
  type BrazeKind,
  brazeAtlasKindFileSchema,
  brazeAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const BRAZE_SUPERSEDE_REMEDY =
  "run: slopweaver atlas braze reset --confirm archive — this archives the old generation and installs a " +
  "fresh, empty one this build can write";

/** Every path this atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type BrazeAtlasPaths = AtlasStorePaths<BrazeKind>;

/**
 * What this atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type BrazeAtlasSnapshot = AtlasSnapshot<BrazeKind, BrazeAtlasKindFile, BrazeAtlasManifest>;

/** Everything the kit needs to read, grade and publish a generation here. */
export const BRAZE_STORE_SPEC: AtlasStoreSpec<BrazeKind, BrazeAtlasKindFile, BrazeAtlasManifest> = {
  kinds: BRAZE_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => brazeAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => brazeAtlasManifestSchema.safeParse(json),
  platform: BRAZE_ATLAS_PLATFORM,
  schemaVersion: BRAZE_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: BRAZE_SUPERSEDE_REMEDY,
};

/**
 * Resolve every path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function brazeAtlasPaths({ home }: { home: string }): BrazeAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.braze;
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
export function readBrazeManifest({ paths }: { paths: BrazeAtlasPaths }): Result<BrazeAtlasManifest | null> {
  return readManifest({ paths, spec: BRAZE_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 *
 * @internal
 */
export function readBrazeKindFile({
  paths,
  kind,
}: {
  paths: BrazeAtlasPaths;
  kind: BrazeKind;
}): Result<BrazeAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: BRAZE_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readBrazeAtlas({ paths }: { paths: BrazeAtlasPaths }): Result<BrazeAtlasSnapshot> {
  return readAtlas({ paths, spec: BRAZE_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishBrazeAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: BrazeAtlasPaths;
  files: Readonly<Partial<Record<BrazeKind, BrazeAtlasKindFile>>>;
  manifest: BrazeAtlasManifest;
  derivedFrom: BrazeAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: BRAZE_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function brazeAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
