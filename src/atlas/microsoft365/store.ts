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
 * two kinds, which makes a lost update reachable. Here the two writers are disjoint by kind: `sync.ts`
 * publishes the 70 Graph resource kinds and never `page`, and the browser walk will publish `page` and
 * nothing else. `publishAtlas` leaves an omitted kind's file untouched, so neither can blank the other.
 *
 * That is a property of the CURRENT writers, not of the design, so it is written down rather than assumed: a
 * walk that also wrote an operation kind — recording which console page caused which Graph call, say, which
 * is a genuinely likely future finding — would make the interleaving reachable, and `kit/publishGuard.ts`'s
 * lock is what to reach for on the day that lands, to stop the loser paying for a Graph read it will not keep.
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
  MICROSOFT365_ATLAS_PLATFORM,
  MICROSOFT365_ATLAS_SCHEMA_VERSION,
  MICROSOFT365_KINDS,
  type Microsoft365AtlasKindFile,
  type Microsoft365AtlasManifest,
  type Microsoft365Kind,
  microsoft365AtlasKindFileSchema,
  microsoft365AtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const MICROSOFT365_SUPERSEDE_REMEDY =
  "run: slopweaver atlas microsoft365 reset --confirm archive — this archives the old generation and " +
  "installs a fresh, empty one this build can write";

/** Every path this atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type Microsoft365AtlasPaths = AtlasStorePaths<Microsoft365Kind>;

/**
 * What this atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type Microsoft365AtlasSnapshot = AtlasSnapshot<
  Microsoft365Kind,
  Microsoft365AtlasKindFile,
  Microsoft365AtlasManifest
>;

/** Everything the kit needs to read, grade and publish a generation here. */
export const MICROSOFT365_STORE_SPEC: AtlasStoreSpec<
  Microsoft365Kind,
  Microsoft365AtlasKindFile,
  Microsoft365AtlasManifest
> = {
  kinds: MICROSOFT365_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => microsoft365AtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => microsoft365AtlasManifestSchema.safeParse(json),
  platform: MICROSOFT365_ATLAS_PLATFORM,
  schemaVersion: MICROSOFT365_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: MICROSOFT365_SUPERSEDE_REMEDY,
};

/**
 * Resolve every path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function microsoft365AtlasPaths({ home }: { home: string }): Microsoft365AtlasPaths {
  const paths = stateHomePaths({ home }).atlas.microsoft365;
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
export function readMicrosoft365Manifest({
  paths,
}: {
  paths: Microsoft365AtlasPaths;
}): Result<Microsoft365AtlasManifest | null> {
  return readManifest({ paths, spec: MICROSOFT365_STORE_SPEC });
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
export function readMicrosoft365KindFile({
  paths,
  kind,
}: {
  paths: Microsoft365AtlasPaths;
  kind: Microsoft365Kind;
}): Result<Microsoft365AtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: MICROSOFT365_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readMicrosoft365Atlas({ paths }: { paths: Microsoft365AtlasPaths }): Result<Microsoft365AtlasSnapshot> {
  return readAtlas({ paths, spec: MICROSOFT365_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishMicrosoft365Atlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: Microsoft365AtlasPaths;
  files: Readonly<Partial<Record<Microsoft365Kind, Microsoft365AtlasKindFile>>>;
  manifest: Microsoft365AtlasManifest;
  derivedFrom: Microsoft365AtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: MICROSOFT365_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function microsoft365AtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
