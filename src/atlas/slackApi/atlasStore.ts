/**
 * Where the Slack atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely Slack's:
 * where the files live, the schemas, and the remedy to print when a generation was published by a build
 * that wrote a different schema version.
 *
 * This atlas declares a publish guard, and the reason is the visibility scope. Both surfaces are bounded by
 * ONE member's entitlements, so republishing a generation under a different `@slack/web-api` major would
 * silently mix two API vocabularies into one accumulated store — see {@link guardSdkMajor}.
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

import {
  SLACK_ATLAS_KINDS,
  SLACK_ATLAS_PLATFORM,
  SLACK_ATLAS_SCHEMA_VERSION,
  type SlackAtlasKind,
  type SlackAtlasKindFile,
  type SlackAtlasManifest,
  slackAtlasKindFileSchema,
  slackAtlasManifestSchema,
} from "./atlasModel.js";
import { SlackAtlasErrors, slackAtlasErrorLines } from "./errors.js";

/** What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const SLACK_ATLAS_SUPERSEDE_REMEDY =
  "run: slopweaver atlas slack reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Slack atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type SlackAtlasPaths = AtlasStorePaths<SlackAtlasKind>;

/** What the Slack atlas holds right now, as the reader sees it.
 * @internal
 */
export type SlackAtlasSnapshot = AtlasSnapshot<SlackAtlasKind, SlackAtlasKindFile, SlackAtlasManifest>;

/**
 * The major version of an `@slack/web-api` version string, or `null` when it is not one this can read.
 *
 * @param version the version string as the installed package declares it
 * @returns the leading integer, or `null`
 */
function sdkMajor({ version }: { version: string }): string | null {
  const major = /^(\d+)\./.exec(version);
  if (major === null) {
    return null;
  }
  // The pattern's one group is not optional, so a match always carries it.
  return major[1]!;
}

/**
 * Refuse a publish that would accumulate two different SDK majors into one store.
 *
 * The store accumulates: an entity absent from this run is staled, never deleted. That is right when both
 * runs read the same vocabulary and wrong when they do not — a major bump renames and removes methods, so a
 * publish across one would leave the previous major's methods sitting in the file marked `stale`, which
 * reads as "Slack removed these" rather than "we changed libraries". A reset is the honest answer, and it is
 * cheap, because the browser half is one re-drive.
 *
 * A version this cannot parse never refuses: an unreadable version is a fact about the package manifest,
 * not evidence of a mismatch, and refusing on it would block a publish for a reason nobody could act on.
 *
 * @param prior the manifest currently on disk, or `null` when nothing has been published
 * @param next the manifest about to be published
 * @returns nothing when the publish may proceed, or why it is refused
 */
export function guardSdkMajor({
  prior,
  next,
}: {
  prior: SlackAtlasManifest | null;
  next: SlackAtlasManifest;
}): Result<null> {
  if (prior === null) {
    return ok(null);
  }
  const before = sdkMajor({ version: prior.sdkVersion });
  const after = sdkMajor({ version: next.sdkVersion });
  if (before === null || after === null || before === after) {
    return ok(null);
  }
  return err(
    slackAtlasErrorLines({
      error: SlackAtlasErrors.sdkMajorCrossed({
        after: next.sdkVersion,
        before: prior.sdkVersion,
        remedy: SLACK_ATLAS_SUPERSEDE_REMEDY,
      }),
    }),
  );
}

/** Everything the kit needs to read, grade and publish a Slack generation.
 * @internal
 */
export const SLACK_ATLAS_STORE_SPEC: AtlasStoreSpec<SlackAtlasKind, SlackAtlasKindFile, SlackAtlasManifest> = {
  guardPublish: guardSdkMajor,
  kinds: SLACK_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => slackAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => slackAtlasManifestSchema.safeParse(json),
  platform: SLACK_ATLAS_PLATFORM,
  schemaVersion: SLACK_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: SLACK_ATLAS_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Slack atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function slackAtlasPaths({ home }: { home: string }): SlackAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.slack;
  return {
    directory: paths.root,
    home,
    // Honest assertions rather than a fallback: `stateHome.ts` declares both keys in the same literal that
    // produces this record, so a missing one is a defect in that literal — and an empty path silently
    // "published" to the working directory would be far worse than a throw naming the real cause.
    kinds: { method: paths.kinds["method"]!, page: paths.kinds["page"]! },
    manifest: paths.manifest,
    superseded: paths.superseded,
  };
}

/**
 * Read the manifest, refusing anything it cannot trust.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 */
export function readSlackAtlasManifest({ paths }: { paths: SlackAtlasPaths }): Result<SlackAtlasManifest | null> {
  return readManifest({ paths, spec: SLACK_ATLAS_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readSlackAtlasKindFile({
  paths,
  kind,
}: {
  paths: SlackAtlasPaths;
  kind: SlackAtlasKind;
}): Result<SlackAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: SLACK_ATLAS_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readSlackAtlas({ paths }: { paths: SlackAtlasPaths }): Result<SlackAtlasSnapshot> {
  return readAtlas({ paths, spec: SLACK_ATLAS_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest currently on disk, for the SDK-major guard; `null` when fresh
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishSlackAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: SlackAtlasPaths;
  files: Readonly<Partial<Record<SlackAtlasKind, SlackAtlasKindFile>>>;
  manifest: SlackAtlasManifest;
  derivedFrom: SlackAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: SLACK_ATLAS_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 */
export function slackAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
