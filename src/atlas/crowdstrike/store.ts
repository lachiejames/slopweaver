/**
 * Where the CrowdStrike atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
 *
 * The generation protocol — kind files first, manifest last, a digest per file, every document validated
 * before the first byte is written — is `kit/store.ts`. What is genuinely CrowdStrike's is here: where the
 * files live, the schemas, the remedy for a superseded generation, and the publish guard below.
 *
 * ## What is left of the publish guard, and what moved to the kit
 *
 * The obvious guard — "does the manifest grade every declared kind" — is already unreachable: the manifest
 * schema keys its `kinds` record by the kind enum, so Zod refuses a manifest missing one before any guard
 * runs. Writing that check anyway would have been dead code that read like protection.
 *
 * This guard used to carry two checks a schema cannot see. The first — a kind graded with entities but no
 * digest, which `publishAtlas` produces whenever a partial file set leaves an omitted kind's file untouched
 * — was never CrowdStrike's fact: every atlas publishes through that same protocol, and the Cloudflare
 * atlas demonstrated the same hole against the kit, so `kit/store.ts` refuses it for everyone now.
 *
 * The second stayed, and stayed HERE rather than following it, because what a successful `lastAttempt`
 * MEANS is a fact about how this atlas's own sync writes its manifest — the same fact
 * `gradeNeverSucceeded` exists to keep out of the kit. This sync stamps `ok` only for a kind it actually
 * read, so `ok` with no success time is an incoherence; five other atlases here stamp `ok` for a run that
 * completed while never reading the kind at all, and lifting this check broke every one of them.
 */
import { err, ok, type Result } from "../../lib/result.js";
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

import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";
import {
  type CrowdstrikeKindFile,
  type CrowdstrikeManifest,
  crowdstrikeKindFileSchema,
  crowdstrikeManifestSchema,
} from "./entities.js";
import { CROWDSTRIKE_KINDS, CROWDSTRIKE_PLATFORM, CROWDSTRIKE_SCHEMA_VERSION, type CrowdstrikeKind } from "./model.js";
import { CROWDSTRIKE_KIND_VOLUMES } from "./volume.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const CROWDSTRIKE_SUPERSEDE_REMEDY =
  "run: slopweaver crowdstrike reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the CrowdStrike atlas owns. */
export interface CrowdstrikeAtlasPaths extends AtlasStorePaths<CrowdstrikeKind> {
  /** Companion files for anything withheld from a kind file. */
  readonly sensitive: string;
}

/**
 * What the CrowdStrike atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type CrowdstrikeAtlasSnapshot = AtlasSnapshot<CrowdstrikeKind, CrowdstrikeKindFile, CrowdstrikeManifest>;

/**
 * Refuse a manifest whose graded numbers contradict each other in a way only this atlas can see.
 *
 * A kind whose latest attempt succeeded but which records no success time cannot be graded for freshness,
 * so every later "is this current" answer about it is unanswerable rather than merely stale. That is an
 * incoherence HERE because `syncCrowdstrikeApiSurface` stamps `ok` only for a kind it actually read — see
 * this file's header for why it is not the kit's to check.
 *
 * @param next the generation about to be written
 * @returns nothing when the manifest is self-consistent, or every incoherence found
 */
function guardCrowdstrikePublish({ next }: { next: CrowdstrikeManifest }): Result<null> {
  const problems = CROWDSTRIKE_KINDS.filter(
    (kind) => next.kinds[kind].lastAttempt?.outcome === "ok" && next.kinds[kind].lastSuccessAt === null,
  ).map((kind) => `${kind} records a successful attempt but no success time, so its freshness can never be graded`);
  return problems.length > 0
    ? err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.generationUnpublishable({ problems }) }))
    : ok(null);
}

/** Everything the kit needs to read, grade and publish a CrowdStrike generation. */
export const CROWDSTRIKE_STORE_SPEC: AtlasStoreSpec<CrowdstrikeKind, CrowdstrikeKindFile, CrowdstrikeManifest> = {
  guardPublish: ({ next }) => guardCrowdstrikePublish({ next }),
  kinds: CROWDSTRIKE_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: CROWDSTRIKE_KIND_VOLUMES,
  parseKindFile: ({ json }) => crowdstrikeKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => crowdstrikeManifestSchema.safeParse(json),
  platform: CROWDSTRIKE_PLATFORM,
  schemaVersion: CROWDSTRIKE_SCHEMA_VERSION,
  supersedeRemedy: CROWDSTRIKE_SUPERSEDE_REMEDY,
};

/**
 * Resolve every CrowdStrike atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function crowdstrikeAtlasPaths({ home }: { home: string }): CrowdstrikeAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.crowdstrike;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    sensitive: paths.sensitive,
    superseded: paths.superseded,
  };
}

/**
 * Read the manifest — the authority on what this atlas has published.
 *
 * @param paths the resolved atlas paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 *
 * @internal
 */
export function readCrowdstrikeManifest({
  paths,
}: {
  paths: CrowdstrikeAtlasPaths;
}): Result<CrowdstrikeManifest | null> {
  return readManifest({ paths, spec: CROWDSTRIKE_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved atlas paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 *
 * @internal
 */
export function readCrowdstrikeKindFile({
  paths,
  kind,
}: {
  paths: CrowdstrikeAtlasPaths;
  kind: CrowdstrikeKind;
}): Result<CrowdstrikeKindFile | null> {
  return readKindFile({ kind, paths, spec: CROWDSTRIKE_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved atlas paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readCrowdstrikeAtlas({ paths }: { paths: CrowdstrikeAtlasPaths }): Result<CrowdstrikeAtlasSnapshot> {
  return readAtlas({ paths, spec: CROWDSTRIKE_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with the publish guard refusing an
 * incoherent one before the first byte is written.
 *
 * @param paths the resolved atlas paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest currently on disk, or `null` when this is a fresh generation
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishCrowdstrikeAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: CrowdstrikeAtlasPaths;
  files: Readonly<Partial<Record<CrowdstrikeKind, CrowdstrikeKindFile>>>;
  manifest: CrowdstrikeManifest;
  derivedFrom: CrowdstrikeManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: CROWDSTRIKE_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function crowdstrikeAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
