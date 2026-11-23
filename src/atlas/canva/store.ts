/**
 * Where the Canva atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, the remedy for a superseded generation, and one refusal the
 * kit cannot make.
 *
 * ## The publish gate: no compiled generation may claim a live channel
 *
 * `refuseUnearnedLiveChannels` closes over the documents about to be written and refuses the WHOLE
 * generation if any entity carries a `connect-api` or `web-app` channel record. It is a property of
 * PUBLISHING rather than of the sync, following the Nightfall atlas's own gate, and the reason it is worth a
 * gate here is specific to this platform: this installation holds no Canva credential and has run no walk,
 * so a filled live channel could only have come from a bug or a hand-edited file — and a filled channel is
 * precisely the thing a reader trusts most. `docs/atlas-intent/settled-decisions.md`'s coverage property is what it protects:
 * an atlas that overstated what it had reached would be worse than one that had reached nothing.
 *
 * The day a walk or a credentialled sync lands, the code that fills a channel is the code that relaxes this
 * gate to admit its own — not a gate quietly deleted, which is the shape that lets an unearned claim back in.
 *
 * It refuses rather than filtering, deliberately. A gate that silently dropped the offending channel would
 * publish a generation that looked complete and was not, which is the failure mode this whole atlas is built
 * to make impossible.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
import {
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  readAtlas,
  readKindFile,
  readManifest,
} from "../kit/store.js";

import {
  byCanvaKind,
  CANVA_ATLAS_KINDS,
  CANVA_ATLAS_PLATFORM,
  CANVA_ATLAS_SCHEMA_VERSION,
  type CanvaAtlasKind,
  type CanvaAtlasKindFile,
  type CanvaAtlasManifest,
  canvaAtlasKindFileSchema,
  canvaAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const CANVA_SUPERSEDE_REMEDY =
  "run: slopweaver atlas canva reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Canva atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type CanvaAtlasPaths = AtlasStorePaths<CanvaAtlasKind>;

/**
 * What the Canva atlas holds right now, as the reader sees it.
 * @internal
 */
export type CanvaAtlasSnapshot = AtlasSnapshot<CanvaAtlasKind, CanvaAtlasKindFile, CanvaAtlasManifest>;

/**
 * Refuse a generation whose entities claim a channel nothing in this build can fill.
 *
 * The check is on the DOCUMENTS rather than on the manifest, because the manifest only counts entities and a
 * count cannot tell which channel filled one. See this file's header for why the refusal is total rather
 * than a filter, and for what changes it when a live channel actually lands.
 *
 * @param files the kind files about to be written
 * @returns nothing when the generation is publishable, or why it is refused
 */
export function refuseUnearnedLiveChannels({
  files,
}: {
  files: Readonly<Partial<Record<CanvaAtlasKind, CanvaAtlasKindFile>>>;
}): Result<null> {
  const reasons: string[] = [];
  for (const kind of CANVA_ATLAS_KINDS) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    const claimed = file.entities.filter(
      (entity) => entity.channels["connect-api"] !== null || entity.channels["web-app"] !== null,
    );
    if (claimed.length > 0) {
      reasons.push(
        `${kind} carries ${claimed.length} entit(ies) claiming a live channel, and this build fills neither — no Canva credential is configured and no web-app walk exists, so a filled connect-api or web-app record could only come from a defect or a hand-edited file`,
      );
    }
  }
  if (reasons.length > 0) {
    return err(reasons);
  }
  return ok(null);
}

/** Everything the kit needs to read, grade and publish a Canva generation. */
export const CANVA_STORE_SPEC: AtlasStoreSpec<CanvaAtlasKind, CanvaAtlasKindFile, CanvaAtlasManifest> = {
  kinds: CANVA_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => canvaAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => canvaAtlasManifestSchema.safeParse(json),
  platform: CANVA_ATLAS_PLATFORM,
  schemaVersion: CANVA_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: CANVA_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Canva atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function canvaAtlasPaths({ home }: { home: string }): CanvaAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.canva;
  return {
    directory: paths.root,
    home,
    // `!`: `atlasHome.ts` builds this map by iterating CANVA_ATLAS_KINDS, so every declared kind is
    // present. What it cannot express is a key type narrower than `string`, which is what this recovers.
    kinds: byCanvaKind({ build: ({ kind }) => paths.kinds[kind]! }),
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
export function readCanvaManifest({ paths }: { paths: CanvaAtlasPaths }): Result<CanvaAtlasManifest | null> {
  return readManifest({ paths, spec: CANVA_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 * @internal
 */
export function readCanvaKindFile({
  paths,
  kind,
}: {
  paths: CanvaAtlasPaths;
  kind: CanvaAtlasKind;
}): Result<CanvaAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: CANVA_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readCanvaAtlas({ paths }: { paths: CanvaAtlasPaths }): Result<CanvaAtlasSnapshot> {
  return readAtlas({ paths, spec: CANVA_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * The live-channel gate runs BEFORE the kit opens a file, so a refused generation leaves nothing behind.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishCanvaAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: CanvaAtlasPaths;
  files: Readonly<Partial<Record<CanvaAtlasKind, CanvaAtlasKindFile>>>;
  manifest: CanvaAtlasManifest;
  derivedFrom: CanvaAtlasManifest | null;
}): Result<readonly string[]> {
  const gate = refuseUnearnedLiveChannels({ files });
  if (gate.isErr()) {
    return err(gate.error);
  }
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: CANVA_STORE_SPEC });
}
