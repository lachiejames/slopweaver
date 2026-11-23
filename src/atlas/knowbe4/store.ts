/**
 * Where the KnowBe4 atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`, reached through `kit/storeFacade.ts`.
 * What remains here is genuinely this atlas's: where the files live, the schemas, and the remedy to print
 * when a generation was published by a build that wrote a different schema version.
 */
import type { Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AtlasSnapshot, AtlasStorePaths, AtlasStoreSpec } from "../kit/store.js";
import { createAtlasStore } from "../kit/storeFacade.js";

import {
  KNOWBE4_ATLAS_KINDS,
  KNOWBE4_ATLAS_PLATFORM,
  KNOWBE4_ATLAS_SCHEMA_VERSION,
  type Knowbe4AtlasKind,
  type Knowbe4AtlasKindFile,
  type Knowbe4AtlasManifest,
  knowbe4AtlasKindFileSchema,
  knowbe4AtlasManifestSchema,
} from "./model.js";

/** Every path the KnowBe4 atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract. */
export type Knowbe4AtlasPaths = AtlasStorePaths<Knowbe4AtlasKind>;

/**
 * What the KnowBe4 atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type Knowbe4AtlasSnapshot = AtlasSnapshot<Knowbe4AtlasKind, Knowbe4AtlasKindFile, Knowbe4AtlasManifest>;

/** Everything the kit needs to read, grade and publish a KnowBe4 generation. */
export const KNOWBE4_STORE_SPEC: AtlasStoreSpec<Knowbe4AtlasKind, Knowbe4AtlasKindFile, Knowbe4AtlasManifest> = {
  // The sync stamps every kind on every run it publishes: a read kind records its attempt, a kind the
  // account's subscription refused records its permission block. So a file beside either is the manifest and
  // the file agreeing on "not read", and only a kind the manifest records neither for is a genuine half-write.
  gradeNeverSucceeded: ({ status }) => {
    if (status === null) {
      return "unpublished";
    }
    const recorded = status.lastAttempt !== null || status.permissionBlocked != null;
    return recorded ? "agrees" : "unpublished";
  },
  kinds: KNOWBE4_ATLAS_KINDS,
  // Every kind is OWED: the sync reads each one, so none is exempt from the fail-closed default.
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => knowbe4AtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => knowbe4AtlasManifestSchema.safeParse(json),
  platform: KNOWBE4_ATLAS_PLATFORM,
  schemaVersion: KNOWBE4_ATLAS_SCHEMA_VERSION,
  supersedeRemedy:
    "run: slopweaver atlas knowbe4 reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write",
};

/**
 * Resolve every KnowBe4 atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function knowbe4AtlasPaths({ home }: { home: string }): Knowbe4AtlasPaths {
  const paths = stateHomePaths({ home }).atlas.knowbe4;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    superseded: paths.superseded,
  };
}

/** Every store door this atlas opens, built once from its spec — see `kit/storeFacade.ts`. */
const STORE = createAtlasStore({ spec: KNOWBE4_STORE_SPEC });

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readKnowbe4Atlas({ paths }: { paths: Knowbe4AtlasPaths }): Result<Knowbe4AtlasSnapshot> {
  return STORE.snapshot({ paths });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes
 * written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest this generation was built over, `null` when nothing was published
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishKnowbe4Atlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: Knowbe4AtlasPaths;
  files: Readonly<Partial<Record<Knowbe4AtlasKind, Knowbe4AtlasKindFile>>>;
  manifest: Knowbe4AtlasManifest;
  derivedFrom: Knowbe4AtlasManifest | null;
}): Result<readonly string[]> {
  return STORE.publish({ derivedFrom, files, manifest, paths });
}
