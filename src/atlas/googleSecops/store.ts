/**
 * Where the Google SecOps atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
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
  GOOGLE_SECOPS_ATLAS_KINDS,
  GOOGLE_SECOPS_ATLAS_PLATFORM,
  GOOGLE_SECOPS_ATLAS_SCHEMA_VERSION,
  type GoogleSecopsAtlasKind,
  type GoogleSecopsAtlasKindFile,
  type GoogleSecopsAtlasManifest,
  googleSecopsAtlasKindFileSchema,
  googleSecopsAtlasManifestSchema,
} from "./model.js";

/** Every path the Google SecOps atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract. */
export type GoogleSecopsAtlasPaths = AtlasStorePaths<GoogleSecopsAtlasKind>;

/**
 * What the Google SecOps atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type GoogleSecopsAtlasSnapshot = AtlasSnapshot<
  GoogleSecopsAtlasKind,
  GoogleSecopsAtlasKindFile,
  GoogleSecopsAtlasManifest
>;

/** Everything the kit needs to read, grade and publish a Google SecOps generation. */
export const GOOGLE_SECOPS_STORE_SPEC: AtlasStoreSpec<
  GoogleSecopsAtlasKind,
  GoogleSecopsAtlasKindFile,
  GoogleSecopsAtlasManifest
> = {
  // The fill stamps every kind on every run: a called kind records its attempt, a cloud-platform-only kind its
  // permission block with no attempt. So a file beside either is the manifest and the file agreeing on "not
  // read", and only a kind the manifest records neither for is a genuine half-write.
  gradeNeverSucceeded: ({ status }) => {
    if (status === null) {
      return "unpublished";
    }
    const recorded = status.lastAttempt !== null || status.permissionBlocked != null;
    return recorded ? "agrees" : "unpublished";
  },
  kinds: GOOGLE_SECOPS_ATLAS_KINDS,
  // Every kind is OWED: the fill reads each one, so none is exempt from the fail-closed default.
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => googleSecopsAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => googleSecopsAtlasManifestSchema.safeParse(json),
  platform: GOOGLE_SECOPS_ATLAS_PLATFORM,
  schemaVersion: GOOGLE_SECOPS_ATLAS_SCHEMA_VERSION,
  supersedeRemedy:
    "run: slopweaver atlas google-secops reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write",
};

/**
 * Resolve every Google SecOps atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function googleSecopsAtlasPaths({ home }: { home: string }): GoogleSecopsAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.googleSecops;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    superseded: paths.superseded,
  };
}

/** Every store door this atlas opens, built once from its spec — see `kit/storeFacade.ts`. */
const STORE = createAtlasStore({ spec: GOOGLE_SECOPS_STORE_SPEC });

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readGoogleSecopsAtlas({ paths }: { paths: GoogleSecopsAtlasPaths }): Result<GoogleSecopsAtlasSnapshot> {
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
export function publishGoogleSecopsAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: GoogleSecopsAtlasPaths;
  files: Readonly<Partial<Record<GoogleSecopsAtlasKind, GoogleSecopsAtlasKindFile>>>;
  manifest: GoogleSecopsAtlasManifest;
  derivedFrom: GoogleSecopsAtlasManifest | null;
}): Result<readonly string[]> {
  return STORE.publish({ derivedFrom, files, manifest, paths });
}
