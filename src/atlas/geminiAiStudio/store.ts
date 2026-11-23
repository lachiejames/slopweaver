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
 * The two writers are disjoint by kind: `sync.ts` publishes the thirteen operation kinds and never `page`,
 * and a browser walk would publish `page` and nothing else. `publishAtlas` leaves an omitted kind's file
 * untouched, so neither can blank the other. That is a property of the CURRENT writers rather than of the
 * design, so it is written down rather than assumed — a walk that also recorded which AI Studio page caused
 * which API call would write an operation kind and make the interleaving reachable, and
 * `kit/publishGuard.ts`'s lock is what to reach for on the day that lands, to stop the loser paying for a
 * provider read it will not keep.
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
  GEMINI_AI_STUDIO_ATLAS_PLATFORM,
  GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION,
  GEMINI_AI_STUDIO_KINDS,
  type GeminiAiStudioAtlasKindFile,
  type GeminiAiStudioAtlasManifest,
  type GeminiAiStudioKind,
  geminiAiStudioAtlasKindFileSchema,
  geminiAiStudioAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_SUPERSEDE_REMEDY =
  "run: slopweaver atlas gemini-ai-studio reset --confirm archive — this archives the old generation and " +
  "installs a fresh, empty one this build can write";

/** Every path this atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type GeminiAiStudioAtlasPaths = AtlasStorePaths<GeminiAiStudioKind>;

/**
 * What this atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type GeminiAiStudioAtlasSnapshot = AtlasSnapshot<
  GeminiAiStudioKind,
  GeminiAiStudioAtlasKindFile,
  GeminiAiStudioAtlasManifest
>;

/** Everything the kit needs to read, grade and publish a generation here. */
export const GEMINI_AI_STUDIO_STORE_SPEC: AtlasStoreSpec<
  GeminiAiStudioKind,
  GeminiAiStudioAtlasKindFile,
  GeminiAiStudioAtlasManifest
> = {
  kinds: GEMINI_AI_STUDIO_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => geminiAiStudioAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => geminiAiStudioAtlasManifestSchema.safeParse(json),
  platform: GEMINI_AI_STUDIO_ATLAS_PLATFORM,
  schemaVersion: GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: GEMINI_AI_STUDIO_SUPERSEDE_REMEDY,
};

/**
 * Resolve every path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function geminiAiStudioAtlasPaths({ home }: { home: string }): GeminiAiStudioAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.geminiAiStudio;
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
export function readGeminiAiStudioManifest({
  paths,
}: {
  paths: GeminiAiStudioAtlasPaths;
}): Result<GeminiAiStudioAtlasManifest | null> {
  return readManifest({ paths, spec: GEMINI_AI_STUDIO_STORE_SPEC });
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
export function readGeminiAiStudioKindFile({
  paths,
  kind,
}: {
  paths: GeminiAiStudioAtlasPaths;
  kind: GeminiAiStudioKind;
}): Result<GeminiAiStudioAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: GEMINI_AI_STUDIO_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readGeminiAiStudioAtlas({
  paths,
}: {
  paths: GeminiAiStudioAtlasPaths;
}): Result<GeminiAiStudioAtlasSnapshot> {
  return readAtlas({ paths, spec: GEMINI_AI_STUDIO_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes
 * written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishGeminiAiStudioAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: GeminiAiStudioAtlasPaths;
  files: Readonly<Partial<Record<GeminiAiStudioKind, GeminiAiStudioAtlasKindFile>>>;
  manifest: GeminiAiStudioAtlasManifest;
  derivedFrom: GeminiAiStudioAtlasManifest | null;
}): Result<readonly string[]> {
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: GEMINI_AI_STUDIO_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function geminiAiStudioAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
