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
 * The two writers OVERLAP by kind and are disjoint by CHANNEL. `sync.ts` refreshes the `compiled` channel of
 * `operation` and `page`; `walk.ts` refreshes the `browser` channel of `page`, `graphql-operation` and the
 * account's own entity kinds. That overlap on `page` is the design rather than an accident — a route the
 * application's own table declares and a page the browser actually rendered are one thing seen two ways, so
 * they belong on one entity — and `mergeInngestChannel` is what keeps each writer out of the other's half.
 *
 * What that does NOT protect is the file write itself: both writers publish a whole `pages.jsonl`, so a sync
 * landing between a walk's read and its write would be discarded. `kit/store.ts`'s `publishAtlas` is what
 * refuses it, under the mutation lock it takes on every publish, by compare-and-swapping against the WHOLE
 * manifest a candidate was derived from. The whole manifest rather than its `updatedAt`: the kit derives
 * that clock from the kind files a generation vouches for, so two candidates built from the same evidence in
 * the same second legitimately share one, and a token both writers can present is not a token.
 *
 * The day these two verbs are expected to run concurrently on a schedule, `kit/publishGuard.ts`'s lock
 * across the whole read-and-publish is the addition — a cost control, so the loser waits instead of driving
 * a browser for a generation it will not get to keep.
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
  INNGEST_ATLAS_PLATFORM,
  INNGEST_ATLAS_SCHEMA_VERSION,
  INNGEST_KINDS,
  type InngestAtlasKindFile,
  type InngestAtlasManifest,
  type InngestKind,
  inngestAtlasKindFileSchema,
  inngestAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const INNGEST_SUPERSEDE_REMEDY =
  "run: slopweaver atlas inngest reset --confirm archive — this archives the old generation and installs a " +
  "fresh, empty one this build can write";

/** Every path this atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type InngestAtlasPaths = AtlasStorePaths<InngestKind>;

/**
 * What this atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type InngestAtlasSnapshot = AtlasSnapshot<InngestKind, InngestAtlasKindFile, InngestAtlasManifest>;

/** Everything the kit needs to read, grade and publish a generation here. */
export const INNGEST_STORE_SPEC: AtlasStoreSpec<InngestKind, InngestAtlasKindFile, InngestAtlasManifest> = {
  /**
   * A kind this sync has ATTEMPTED and never succeeded at is not a half-write.
   *
   * Eight of the eleven kinds are the account's own entities, and a `sync` writes each of their files — the
   * `not-configured` coverage cell and the credential gap — while deliberately leaving `lastSuccessAt` null,
   * because nothing read the account. The kit's default grades that combination `unpublished`, which is the
   * right default for a platform whose manifest records only successes and exactly wrong here: it would make
   * every read of a complete, honest generation print eight kinds as a half-written first generation. A
   * RECORDED attempt is what tells the two apart.
   */
  gradeNeverSucceeded: ({ status }) => (status?.lastAttempt == null ? "unpublished" : "agrees"),
  kinds: INNGEST_KINDS,
  kindObligations: {
    exceptions: {
      app: {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      environment: {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      "event-key": {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      "event-type": {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      function: {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      "graphql-operation": {
        rule: "optional",
        why: "the browser half, published by `browserSurface.ts` rather than by this sync",
      },
      integration: {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      "signing-key": {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
      webhook: {
        rule: "optional",
        why: "an entity kind this atlas enumerates and declares rather than storing whole (see `model.ts`)",
      },
    },
  },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => inngestAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => inngestAtlasManifestSchema.safeParse(json),
  platform: INNGEST_ATLAS_PLATFORM,
  schemaVersion: INNGEST_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: INNGEST_SUPERSEDE_REMEDY,
};

/**
 * Where one page screenshot lives, relative to this atlas's own directory.
 *
 * Addressed by the digest of its own bytes rather than by page name, so the same bytes are the same artifact
 * and a proof cannot be swapped for a different picture under the same path.
 *
 * @param sha256 the digest of the PNG's bytes
 * @returns the relative path
 */
export function inngestPageArtifactPath({ sha256 }: { sha256: string }): string {
  return `artifacts/pages/${sha256}.png`;
}

/**
 * Resolve every path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function inngestAtlasPaths({ home }: { home: string }): InngestAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.inngest;
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
export function readInngestManifest({ paths }: { paths: InngestAtlasPaths }): Result<InngestAtlasManifest | null> {
  return readManifest({ paths, spec: INNGEST_STORE_SPEC });
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
export function readInngestKindFile({
  paths,
  kind,
}: {
  paths: InngestAtlasPaths;
  kind: InngestKind;
}): Result<InngestAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: INNGEST_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readInngestAtlas({ paths }: { paths: InngestAtlasPaths }): Result<InngestAtlasSnapshot> {
  return readAtlas({ paths, spec: INNGEST_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishInngestAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: InngestAtlasPaths;
  files: Readonly<Partial<Record<InngestKind, InngestAtlasKindFile>>>;
  manifest: InngestAtlasManifest;
  derivedFrom: InngestAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: INNGEST_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function inngestAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
