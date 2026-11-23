/**
 * Where the GitHub atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol — kind files first, manifest last, a digest per file, every document validated
 * before the first byte is written — is `kit/store.ts`. What is genuinely GitHub's is here: where the files
 * live, the schemas, the remedy for a superseded generation, and the publish guard below.
 *
 * ## The publish guard checks two things the schema cannot, and one of them is inherited
 *
 * The first is INCOHERENCE between a kind's graded numbers. `publishAtlas` accepts a partial set of files
 * and leaves an omitted kind's file untouched, so a manifest can claim a kind holds 400 entities while no
 * file carrying them was ever written — the digest stays `null` and every count downstream is confidently
 * wrong.
 *
 * The second is a DUPLICATE ENTITY ID, and it is here because of a defect measured elsewhere rather than
 * one imagined for this atlas. `kit/merge.ts` already refuses a run that produced one id twice, but only
 * flat kinds go through it: a fan-out kind composes its entities itself and hands them straight to the
 * store, and a Cloudflare sync once published more entities than it had distinct ids while
 * every gate passed and the census silently double-counted. This atlas fans out over repositories, which is
 * exactly that shape, so the refusal is placed where nothing can go around it.
 *
 * The guard deliberately does NOT distinguish two byte-identical duplicates from two different records
 * sharing an id. Both are refused. GitHub returns a repository once per listing page and an operation once
 * per route, so a repeat here means the projection is wrong rather than that the provider stuttered — and
 * a refusal that let the harmless case through would need the guard to define which case it was seeing.
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
import { GithubRefusalErrors, githubRefusalErrorLines } from "./errors.js";
import { type GithubKindFile, type GithubManifest, githubKindFileSchema, githubManifestSchema } from "./kindFiles.js";
import { GITHUB_KINDS, GITHUB_PLATFORM, GITHUB_SCHEMA_VERSION, type GithubKind } from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const GITHUB_SUPERSEDE_REMEDY =
  "run: slopweaver atlas github reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the GitHub atlas owns. */
export interface GithubAtlasPaths extends AtlasStorePaths<GithubKind> {
  /** Companion files for anything withheld from a kind file. */
  readonly sensitive: string;
}

/**
 * What the GitHub atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type GithubAtlasSnapshot = AtlasSnapshot<GithubKind, GithubKindFile, GithubManifest>;

/**
 * Refuse a manifest whose graded numbers contradict each other.
 *
 * Called by the KIT, at the point in the publish where digests have been stamped. That timing is the whole
 * reason it is separate from {@link guardGithubEntityIds}: on a fresh generation every digest is legitimately
 * `null` until `publishAtlas` writes the files, so running this check BEFORE the publish reports every kind
 * as ungraded — which is what an earlier version of this file did, and what its own sync test caught.
 *
 * @param next the generation about to be written
 * @returns nothing when the manifest is self-consistent, or every incoherence found
 */
function guardGithubPublish({ next }: { next: GithubManifest }): Result<null> {
  const problems: string[] = [];
  for (const kind of GITHUB_KINDS) {
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
  return problems.length > 0
    ? err(githubRefusalErrorLines({ error: GithubRefusalErrors.unpublishable({ problems }) }))
    : ok(null);
}

/**
 * Refuse a publish whose kind files carry the same entity id twice.
 *
 * Runs BEFORE the publish, because unlike the manifest coherence check it needs the FILES and the kit hands
 * `guardPublish` only the two manifests. It is here because of a defect measured on a sibling atlas rather
 * than one imagined for this one: a Cloudflare fan-out published more entities than it had
 * distinct ids, every gate passed, and the census silently double-counted. This atlas fans out over
 * repositories, which is that shape.
 *
 * @param files the kind files this publish is writing
 * @returns nothing when every file's ids are distinct, or every collision found
 */
function guardGithubEntityIds({
  files,
}: {
  files: Readonly<Partial<Record<GithubKind, GithubKindFile>>>;
}): Result<null> {
  const problems: string[] = [];
  for (const kind of GITHUB_KINDS) {
    const duplicates = duplicateIdsIn({ file: files[kind] });
    if (duplicates.length > 0) {
      problems.push(
        `${kind} carries the same entity id more than once: ${duplicates.join(", ")} — one thing counted twice is how a census lies`,
      );
    }
  }
  return problems.length > 0
    ? err(githubRefusalErrorLines({ error: GithubRefusalErrors.unpublishable({ problems }) }))
    : ok(null);
}

/**
 * The entity ids one kind file holds more than once.
 *
 * @param file the kind file about to be written, or `undefined` when this publish omits the kind
 * @returns the repeated ids, sorted and de-duplicated
 */
function duplicateIdsIn({ file }: { file: GithubKindFile | undefined }): readonly string[] {
  if (file === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const entity of file.entities) {
    if (seen.has(entity.id)) {
      repeated.add(entity.id);
    }
    seen.add(entity.id);
  }
  return [...repeated].toSorted();
}

/** Everything the kit needs to read, grade and publish a GitHub generation. */
export const GITHUB_STORE_SPEC: AtlasStoreSpec<GithubKind, GithubKindFile, GithubManifest> = {
  guardPublish: ({ next }) => guardGithubPublish({ next }),
  kinds: GITHUB_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => githubKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => githubManifestSchema.safeParse(json),
  platform: GITHUB_PLATFORM,
  schemaVersion: GITHUB_SCHEMA_VERSION,
  supersedeRemedy: GITHUB_SUPERSEDE_REMEDY,
};

/**
 * Resolve every GitHub atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function githubAtlasPaths({ home }: { home: string }): GithubAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.github;
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
export function readGithubManifest({ paths }: { paths: GithubAtlasPaths }): Result<GithubManifest | null> {
  return readManifest({ paths, spec: GITHUB_STORE_SPEC });
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
export function readGithubKindFile({
  paths,
  kind,
}: {
  paths: GithubAtlasPaths;
  kind: GithubKind;
}): Result<GithubKindFile | null> {
  return readKindFile({ kind, paths, spec: GITHUB_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved atlas paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readGithubAtlas({ paths }: { paths: GithubAtlasPaths }): Result<GithubAtlasSnapshot> {
  return readAtlas({ paths, spec: GITHUB_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with the publish guard refusing an
 * incoherent one — or one carrying a duplicate entity id — before the first byte is written.
 *
 * **What "before the first byte" does and does not cover**, stated because a review found the claim
 * overstated. A publish this module REFUSES writes nothing — both guards run ahead of `publishAtlas`, and
 * that is the case a caller controls. A publish that is admitted and then FAILS PART-WAY is different: the
 * kit writes kind files and then the manifest, so a manifest write that fails leaves the kind files on
 * disk, un-vouched-for. That is `kit/store.ts`'s own shape and its own residue — the next read reports
 * those kinds as `unpublished`, which is the state that exists for exactly this — and it is not something
 * this atlas can fix from here without changing the protocol every atlas publishes through.
 *
 * Two guards, at two different moments, and the split is timing rather than taste. The kit hands
 * `guardPublish` only the two MANIFESTS, and calls it after digests are stamped — so manifest coherence
 * lives there. The duplicate-id check needs the FILES and must run before anything is written, so it lives
 * here.
 *
 * @param paths the resolved atlas paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest currently on disk, or `null` when this is a fresh generation
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishGithubAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: GithubAtlasPaths;
  files: Readonly<Partial<Record<GithubKind, GithubKindFile>>>;
  manifest: GithubManifest;
  derivedFrom: GithubManifest | null;
}): Result<readonly string[]> {
  const guarded = guardGithubEntityIds({ files });
  if (guarded.isErr()) {
    return err(guarded.error);
  }
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: GITHUB_STORE_SPEC });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function githubAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
