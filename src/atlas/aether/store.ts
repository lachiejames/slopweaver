/**
 * Where the Aether atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol — kind files first, manifest last, a digest per file, every document validated
 * before the first byte is written — is `kit/store.ts`. What is genuinely Aether's is here: where the files
 * live, the schemas, the remedy for a superseded generation, and the publish guard below.
 *
 * ## What the publish guard checks, and why it is not the obvious thing
 *
 * The obvious guard — "does the manifest grade every declared kind" — is already unreachable: the manifest
 * schema keys its `kinds` record by the kind enum, so Zod refuses a manifest missing one before any guard
 * runs. What the schema cannot see is INCOHERENCE between a kind's graded numbers — a kind claiming entities
 * with no file digest, or a successful attempt with no success time to grade freshness against. That is the
 * failure this guard exists for.
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

import { type AetherKindFile, type AetherManifest, aetherKindFileSchema, aetherManifestSchema } from "./entities.js";
import { AETHER_KINDS, AETHER_PLATFORM, AETHER_SCHEMA_VERSION, type AetherKind } from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const AETHER_SUPERSEDE_REMEDY =
  "run: slopweaver atlas aether reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Aether atlas owns. */
export interface AetherAtlasPaths extends AtlasStorePaths<AetherKind> {
  /** Companion files for anything withheld from a kind file. */
  readonly sensitive: string;
}

/**
 * What the Aether atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type AetherAtlasSnapshot = AtlasSnapshot<AetherKind, AetherKindFile, AetherManifest>;

/**
 * Refuse a manifest whose graded numbers contradict each other.
 *
 * Two incoherences are reachable and neither is visible to the schema: a kind graded with entities but no
 * digest was never actually written, and a kind whose latest attempt succeeded but records no success time
 * cannot be graded for freshness.
 *
 * @param next the generation about to be written
 * @returns nothing when the manifest is self-consistent, or every incoherence found
 */
function guardAetherPublish({ next }: { next: AetherManifest }): Result<null> {
  const problems: string[] = [];
  for (const kind of AETHER_KINDS) {
    const status = next.kinds[kind];
    if (status.entityCount > 0 && status.digest === null) {
      problems.push(
        `${kind} is graded with ${String(status.entityCount)} entities but carries no file digest — the count describes a file this generation never wrote`,
      );
    }
    if (status.lastAttempt?.outcome === "ok" && status.lastSuccessAt === null) {
      problems.push(`${kind} records a successful attempt but no success time, so its freshness can never be graded`);
    }
  }
  return problems.length > 0 ? err([...problems, "nothing was written — this generation is not published"]) : ok(null);
}

/** Everything the kit needs to read, grade and publish an Aether generation. */
export const AETHER_STORE_SPEC: AtlasStoreSpec<AetherKind, AetherKindFile, AetherManifest> = {
  guardPublish: ({ next }) => guardAetherPublish({ next }),
  kinds: AETHER_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => aetherKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => aetherManifestSchema.safeParse(json),
  platform: AETHER_PLATFORM,
  schemaVersion: AETHER_SCHEMA_VERSION,
  supersedeRemedy: AETHER_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Aether atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function aetherAtlasPaths({ home }: { home: string }): AetherAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.aether;
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
export function readAetherManifest({ paths }: { paths: AetherAtlasPaths }): Result<AetherManifest | null> {
  return readManifest({ paths, spec: AETHER_STORE_SPEC });
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
export function readAetherKindFile({
  paths,
  kind,
}: {
  paths: AetherAtlasPaths;
  kind: AetherKind;
}): Result<AetherKindFile | null> {
  return readKindFile({ kind, paths, spec: AETHER_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved atlas paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readAetherAtlas({ paths }: { paths: AetherAtlasPaths }): Result<AetherAtlasSnapshot> {
  return readAtlas({ paths, spec: AETHER_STORE_SPEC });
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
export function publishAetherAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: AetherAtlasPaths;
  files: Readonly<Partial<Record<AetherKind, AetherKindFile>>>;
  manifest: AetherManifest;
  derivedFrom: AetherManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: AETHER_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function aetherAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
