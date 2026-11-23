/**
 * Where the Notion atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
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
 * the same path. They are images of a real workspace, so they live under the private state home and are
 * never committed. `sensitive` is resolved like every other platform's and is expected to stay empty:
 * nothing this atlas stores is a WITHHELD value.
 *
 * ## Two writers, and neither may truncate the other
 *
 * `sync.ts` publishes `method`'s API channel and omits `page`; `browserSurface.ts` publishes `page` and the
 * browser channel's own method rows. The kit's `publishAtlas` leaves an omitted kind's file untouched, so
 * neither pass can blank what the other wrote. Neither passes a full file map, which is what makes that true.
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
  NOTION_ATLAS_KINDS,
  NOTION_ATLAS_PLATFORM,
  NOTION_ATLAS_SCHEMA_VERSION,
  type NotionAtlasKind,
  type NotionAtlasKindFile,
  type NotionAtlasManifest,
  notionAtlasKindFileSchema,
  notionAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const NOTION_SUPERSEDE_REMEDY =
  "run: slopweaver atlas notion reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Notion atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface NotionAtlasPaths extends AtlasStorePaths<NotionAtlasKind> {
  /** `<root>/artifacts/pages` — where a page's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the Notion atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type NotionAtlasSnapshot = AtlasSnapshot<NotionAtlasKind, NotionAtlasKindFile, NotionAtlasManifest>;

/** Everything the kit needs to read, grade and publish a Notion generation. */
export const NOTION_STORE_SPEC: AtlasStoreSpec<NotionAtlasKind, NotionAtlasKindFile, NotionAtlasManifest> = {
  kinds: NOTION_ATLAS_KINDS,
  kindObligations: {
    exceptions: {
      page: { rule: "optional", why: "the browser half, published by `browserSurface.ts` rather than by this sync" },
    },
  },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => notionAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => notionAtlasManifestSchema.safeParse(json),
  platform: NOTION_ATLAS_PLATFORM,
  schemaVersion: NOTION_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: NOTION_SUPERSEDE_REMEDY,
};

/**
 * The path a page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 */
export function notionPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Notion atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function notionAtlasPaths({ home }: { home: string }): NotionAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.notion;
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
export function readNotionManifest({ paths }: { paths: NotionAtlasPaths }): Result<NotionAtlasManifest | null> {
  return readManifest({ paths, spec: NOTION_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readNotionKindFile({
  paths,
  kind,
}: {
  paths: NotionAtlasPaths;
  kind: NotionAtlasKind;
}): Result<NotionAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: NOTION_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readNotionAtlas({ paths }: { paths: NotionAtlasPaths }): Result<NotionAtlasSnapshot> {
  return readAtlas({ paths, spec: NOTION_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishNotionAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: NotionAtlasPaths;
  files: Readonly<Partial<Record<NotionAtlasKind, NotionAtlasKindFile>>>;
  manifest: NotionAtlasManifest;
  derivedFrom: NotionAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: NOTION_STORE_SPEC });
}

/**
 * The lock key both publishers take, so a read-then-publish cannot interleave with the other channel's.
 *
 * @internal
 */
export const NOTION_PUBLISH_LOCK_KEY = "atlas:notion:publish";

/**
 * Hold the publish lock across one read-and-publish, so the two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withNotionPublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: NotionAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  return withAtlasPublishLock({
    home: paths.home,
    key: NOTION_PUBLISH_LOCK_KEY,
    nowIso,
    platform: NOTION_ATLAS_PLATFORM,
    publish,
  });
}
