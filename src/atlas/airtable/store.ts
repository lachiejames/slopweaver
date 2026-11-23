/**
 * Where the Airtable atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, and the remedy to print when a generation was published by a
 * build that wrote a different schema version.
 *
 * ## Two writers, and neither may truncate the other
 *
 * The API sync publishes the `api` channel; a browser walk publishes the `browser` one. The kit's
 * `publishAtlas` leaves an omitted kind's file untouched, and `merge.ts` keeps the two channels
 * independent, so neither pass can blank what the other wrote. Neither passes a full file map, which is
 * what makes that true.
 *
 * The LOST UPDATE is the kit's to refuse, and it does: `kit/store.ts`'s `publishAtlas` takes the mutation
 * lock and compare-and-swaps against the whole manifest a candidate was derived from, on every publish. Two
 * writers that both read one generation and both derive complete kind files from it would otherwise have
 * one silently discard the other's rows — atomicity prevents a torn file, never that — and a Codex pass
 * found exactly this class on the Notion atlas. This atlas is more exposed to it than Notion, not less: its
 * two writers touch the SAME nineteen kinds rather than a shared two.
 *
 * The publish lock below is a COST control on top of it rather than the correctness boundary: taken across
 * the whole read-and-publish, it makes the writer that would lose the swap wait instead of paying for a
 * provider read it will not keep.
 */
import { join } from "node:path";

import { acquireOperationLock } from "../../admit/operationLock.js";
import { err, type Result } from "../../lib/result.js";
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

import { AIRTABLE_ATLAS_KINDS, type AirtableAtlasKind } from "./kinds.js";
import {
  AIRTABLE_ATLAS_PLATFORM,
  AIRTABLE_ATLAS_SCHEMA_VERSION,
  type AirtableAtlasKindFile,
  type AirtableAtlasManifest,
  airtableAtlasKindFileSchema,
  airtableAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const AIRTABLE_SUPERSEDE_REMEDY =
  "run: slopweaver atlas airtable reset --confirm archive — this archives the old generation and installs a" +
  " fresh, empty one this build can write";

/** Every path the Airtable atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export interface AirtableAtlasPaths extends AtlasStorePaths<AirtableAtlasKind> {
  /** `<root>/artifacts/pages` — where a page's proof screenshot is written, named by its own digest. */
  readonly pageArtifacts: string;
}

/**
 * What the Airtable atlas holds right now, as the reader sees it.
 * @internal
 */
export type AirtableAtlasSnapshot = AtlasSnapshot<AirtableAtlasKind, AirtableAtlasKindFile, AirtableAtlasManifest>;

/** Everything the kit needs to read, grade and publish an Airtable generation. */
export const AIRTABLE_STORE_SPEC: AtlasStoreSpec<AirtableAtlasKind, AirtableAtlasKindFile, AirtableAtlasManifest> = {
  kinds: AIRTABLE_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => airtableAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => airtableAtlasManifestSchema.safeParse(json),
  platform: AIRTABLE_ATLAS_PLATFORM,
  schemaVersion: AIRTABLE_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: AIRTABLE_SUPERSEDE_REMEDY,
};

/**
 * The path a page screenshot is stored at, relative to the atlas root.
 *
 * @param sha256 the digest of the PNG's own bytes
 * @returns the relative path an {@link ../kit/contract.js#AtlasArtifactRef} carries
 * @internal
 */
export function airtablePageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every Airtable atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function airtableAtlasPaths({ home }: { home: string }): AirtableAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.airtable;
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
 * @internal
 */
export function readAirtableManifest({ paths }: { paths: AirtableAtlasPaths }): Result<AirtableAtlasManifest | null> {
  return readManifest({ paths, spec: AIRTABLE_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 * @internal
 */
export function readAirtableKindFile({
  paths,
  kind,
}: {
  paths: AirtableAtlasPaths;
  kind: AirtableAtlasKind;
}): Result<AirtableAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: AIRTABLE_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readAirtableAtlas({ paths }: { paths: AirtableAtlasPaths }): Result<AirtableAtlasSnapshot> {
  return readAtlas({ paths, spec: AIRTABLE_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishAirtableAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: AirtableAtlasPaths;
  files: Readonly<Partial<Record<AirtableAtlasKind, AirtableAtlasKindFile>>>;
  manifest: AirtableAtlasManifest;
  derivedFrom: AirtableAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: AIRTABLE_STORE_SPEC });
}

/**
 * The lock key every publisher takes, so a read-then-publish cannot interleave with another channel's.
 * @internal
 */
export const AIRTABLE_PUBLISH_LOCK_KEY = "atlas:airtable:publish";

/**
 * Hold the publish lock across one read-and-publish, so two channels cannot lose each other's rows.
 *
 * @param paths the resolved paths, whose `home` the lock lives under
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withAirtablePublishLock<T>({
  paths,
  nowIso,
  publish,
}: {
  paths: AirtableAtlasPaths;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  const held = acquireOperationLock({ home: paths.home, key: AIRTABLE_PUBLISH_LOCK_KEY, nowIso });
  if (held.isErr()) {
    return err([
      `another process is publishing the Airtable atlas: ${held.error}`,
      "nothing was written — run the verb again once it has finished",
    ]);
  }
  try {
    return publish();
  } finally {
    held.value.release();
  }
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 * @internal
 */
export function airtableAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
