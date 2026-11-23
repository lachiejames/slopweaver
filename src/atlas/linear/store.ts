/**
 * Where the Linear atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely Linear's:
 * where the files live, the schemas, the supersede remedy, and one publish guard.
 *
 * ## The guard is about WORKSPACE, and it is not a nicety
 *
 * This store accumulates: an entity absent from a run is staled, never deleted. That is right across two
 * runs of the same workspace and catastrophic across two different ones — every workflow state, label and
 * team of workspace A would sit in the file marked `stale`, which reads as "Linear deleted these" rather
 * than "somebody pointed the credential somewhere else". A Codex review pass named this as the
 * cross-workspace mixing class, and the kit already has the seam for it, so refusing costs one function.
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

import { LinearAtlasErrors, linearAtlasErrorLines } from "./errors.js";
import {
  LINEAR_ATLAS_KINDS,
  LINEAR_ATLAS_PLATFORM,
  LINEAR_ATLAS_SCHEMA_VERSION,
  type LinearAtlasKind,
  type LinearAtlasKindFile,
  type LinearAtlasManifest,
  linearAtlasKindFileSchema,
  linearAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const LINEAR_ATLAS_SUPERSEDE_REMEDY =
  "run: slopweaver atlas linear reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Linear atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type LinearAtlasPaths = AtlasStorePaths<LinearAtlasKind>;

/**
 * What the Linear atlas holds right now, as the reader sees it.
 * @internal
 */
export type LinearAtlasSnapshot = AtlasSnapshot<LinearAtlasKind, LinearAtlasKindFile, LinearAtlasManifest>;

/**
 * Refuse a publish that would accumulate two different workspaces into one store.
 *
 * A generation with no recorded workspace never refuses, and neither does one whose workspace is unknown
 * this run: an absent id is a fact about what was read, not evidence of a mismatch, and refusing on it
 * would block a publish for a reason nobody could act on.
 *
 * @param prior the manifest currently on disk, or `null` when nothing has been published
 * @param next the manifest about to be published
 * @returns nothing when the publish may proceed, or why it is refused
 */
export function guardWorkspace({
  prior,
  next,
}: {
  prior: LinearAtlasManifest | null;
  next: LinearAtlasManifest;
}): Result<null> {
  if (prior === null) {
    // Nothing has been published, so there is no stored workspace this publish could cross.
    return ok(null);
  }
  const before = prior.workspaceId;
  const after = next.workspaceId;
  if (before === null || after === null || before === after) {
    return ok(null);
  }
  return err(
    linearAtlasErrorLines({
      error: LinearAtlasErrors.workspaceCrossed({ after, before, remedy: LINEAR_ATLAS_SUPERSEDE_REMEDY }),
    }),
  );
}

/**
 * Everything the kit needs to read, grade and publish a Linear generation.
 * @internal
 */
export const LINEAR_ATLAS_STORE_SPEC: AtlasStoreSpec<LinearAtlasKind, LinearAtlasKindFile, LinearAtlasManifest> = {
  guardPublish: guardWorkspace,
  kinds: LINEAR_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => linearAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => linearAtlasManifestSchema.safeParse(json),
  platform: LINEAR_ATLAS_PLATFORM,
  schemaVersion: LINEAR_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: LINEAR_ATLAS_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Linear atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function linearAtlasPaths({ home }: { home: string }): LinearAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.linear;
  return {
    directory: paths.root,
    home,
    // Honest assertions rather than a fallback: `stateHome.ts` declares all four keys in the same literal
    // that produces this record, so a missing one is a defect in that literal — and an empty path silently
    // "published" to the working directory would be far worse than a throw naming the real cause.
    kinds: {
      operation: paths.kinds["operation"]!,
      page: paths.kinds["page"]!,
      setting: paths.kinds["setting"]!,
      type: paths.kinds["type"]!,
    },
    manifest: paths.manifest,
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
export function readLinearAtlasManifest({ paths }: { paths: LinearAtlasPaths }): Result<LinearAtlasManifest | null> {
  return readManifest({ paths, spec: LINEAR_ATLAS_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 * @internal
 */
export function readLinearAtlasKindFile({
  paths,
  kind,
}: {
  paths: LinearAtlasPaths;
  kind: LinearAtlasKind;
}): Result<LinearAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: LINEAR_ATLAS_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readLinearAtlas({ paths }: { paths: LinearAtlasPaths }): Result<LinearAtlasSnapshot> {
  return readAtlas({ paths, spec: LINEAR_ATLAS_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest currently on disk, for the workspace guard; `null` when fresh
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishLinearAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: LinearAtlasPaths;
  files: Readonly<Partial<Record<LinearAtlasKind, LinearAtlasKindFile>>>;
  manifest: LinearAtlasManifest;
  derivedFrom: LinearAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: LINEAR_ATLAS_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 * @internal
 */
export function linearAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
